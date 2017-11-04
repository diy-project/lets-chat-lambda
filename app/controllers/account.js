//
// Account Controller
//

'use strict';

var _ = require('lodash'),
    fs = require('fs'),
    psjon = require('./../../package.json'),
    auth = require('./../auth/index'),
    path = require('path');

module.exports = function() {

    var app = this.app,
        sqs = this.sqs,
        core = this.core,
        middlewares = this.middlewares,
        settings = this.settings;

    function onUpdate(data, cb) {
        function cb2() {
            var promise = sqs.emit('users:update', data.user);
            sqs.wait(promise, cb);
        }
        var userId = data.user.id.toString();
        core.users.get(userId, function (err, user) {
            if (err) {
                console.error(err);
                cb2();
                return;
            }

            if (!user) {
                cb2();
                return;
            }

            var new_data = {
                userId: userId,
                oldUsername: user.username,
                username: data.user.username
            };

            if (user) {
                _.assign(user, data.user, { id: userId });
            }

            if (data.usernameChanged) {
                // Emit to all rooms, that this user has changed their username
                core.presence.usernameChanged(user, new_data, sqs, cb2);
            }
        });
    }

    // Hack since API gateway mauls binary data
    var assetUrl;
    if (settings.cdn.enabled) {
        assetUrl = settings.cdn.url;
    } else {
        assetUrl = './media';
    }
    var getRootHandler = function(req, res) {
        res.render('chat.html', {
            account: req.user,
            assetUrl: assetUrl,
            settings: settings,
            version: psjon.version
        });
    };

    var getLoginHandler = function(req, res) {
        var imagePath = path.resolve('media/img/photos');
        var images = fs.readdirSync(imagePath);
        var image = _.chain(images).filter(function(file) {
            return /\.(gif|jpg|jpeg|png)$/i.test(file);
        }).sample().value();
        // Hack since API gateway mauls binary data
        var assetUrl;
        if (settings.cdn.enabled) {
            assetUrl = settings.cdn.url;
        } else {
            assetUrl = './media';
        }
        res.render('login.html', {
            assetUrl: assetUrl,
            photo: image,
            auth: auth.providers
        });
    };

    var getLogoutHandler = function(req, res) {
        // Destroy the user's queue
        var userId = req.user._id;
        sqs.deleteQueue(userId);

        req.session.destroy();
        res.redirect('/login');
    };

    var getAccountHandler = function(req, res) {
        res.json(req.user);
    };

    var postAccountLoginHandler = function(req, res) {
        auth.authenticate(req, function(err, user, info) {
            if (err) {
                return res.status(400).json({
                    status: 'error',
                    message: 'There were problems logging you in.',
                    errors: err
                });
            }

            if (!user && info && info.locked) {
                return res.status(403).json({
                    status: 'error',
                    message: info.message || 'Account is locked.'
                });
            }

            if (!user) {
                return res.status(401).json({
                    status: 'error',
                    message: info && info.message ||
                    'Incorrect login credentials.'
                });
            }

            // Make a queue for the user
            var userId = user._id;
            sqs.createQueue(userId, function(err) {
                if (err) {
                    var message;
                    if (err.code === 'AWS.SimpleQueueService.QueueDeletedRecently') {
                        message = 'You must wait 60 seconds after logging out to log in again.'
                    } else {
                        message = 'There were problems logging you in.'
                    }
                    return res.status(400).json({
                        status: 'error',
                        message: message,
                        errors: err
                    });
                } else {
                    req.login(user, function (err) {
                        if (err) {
                            return res.status(400).json({
                                status: 'error',
                                message: 'There were problems logging you in.',
                                errors: err
                            });
                        }
                        var temp = req.session.passport;
                        req.session.regenerate(function (err) {
                            if (err) {
                                return res.status(400).json({
                                    status: 'error',
                                    message: 'There were problems logging you in.',
                                    errors: err
                                });
                            }
                            req.session.passport = temp;

                            res.json({
                                status: 'success',
                                message: 'Logging you in...'
                            });
                        });
                    });
                }
            });
        });
    };

    var postAccountRegisterHandler = function(req, res) {
        if (req.user ||
            !auth.providers.local ||
            !auth.providers.local.enableRegistration) {

            return res.status(403).json({
                status: 'error',
                message: 'Permission denied'
            });
        }

        var fields = req.body || req.data;

        // Sanity check the password
        var passwordConfirm = fields.passwordConfirm || fields.passwordconfirm || fields['password-confirm'];

        if (fields.password !== passwordConfirm) {
            return res.status(400).json({
                status: 'error',
                message: 'Password not confirmed'
            });
        }

        var data = {
            provider: 'local',
            username: fields.username,
            email: fields.email,
            password: fields.password,
            firstName: fields.firstName || fields.firstname || fields['first-name'],
            lastName: fields.lastName || fields.lastname || fields['last-name'],
            displayName: fields.displayName || fields.displayname || fields['display-name']
        };

        core.account.create('local', data, function(err) {
            if (err) {
                var message = 'Sorry, we could not process your request';
                // User already exists
                if (err.code === 11000) {
                    message = 'Email has already been taken';
                }
                // Invalid username
                if (err.errors) {
                    message = _.map(err.errors, function(error) {
                        return error.message;
                    }).join(' ');
                    // If all else fails...
                } else {
                    console.error(err);
                }
                // Notify
                return res.status(400).json({
                    status: 'error',
                    message: message
                });
            }
            res.status(201).json({
                status: 'success',
                message: 'You\'ve been registered, ' +
                'please try logging in now!'
            });
        });
    };

    var postAccountProfileHandler = function(req, res) {
        var form = req.body || req.data,
            data = {
                displayName: form.displayName || form['display-name'],
                firstName: form.firstName || form['first-name'],
                lastName: form.lastName || form['last-name'],
                openRooms: form.openRooms,
            };

        core.account.update(req.user._id, data, function (err, user, update) {
            if (err) {
                return res.json({
                    status: 'error',
                    message: 'Unable to update your profile.',
                    errors: err
                });
            }

            if (!user) {
                return res.sendStatus(404);
            }

            if (update !== null) {
                onUpdate(update, function() {
                    res.json(user);
                });
            } else {
                res.json(user);
            }
        });
    };

    var postAccountSettingsHandler = function(req, res) {
        if (req.user.usingToken) {
            return res.status(403).json({
                status: 'error',
                message: 'Cannot change account settings ' +
                'when using token authentication.'
            });
        }

        var form = req.body || req.data,
            data = {
                username: form.username,
                email: form.email,
                currentPassword: form.password ||
                form['current-password'] || form.currentPassword,
                newPassword: form['new-password'] || form.newPassword,
                confirmPassowrd: form['confirm-password'] ||
                form.confirmPassword
            };

        auth.authenticate(req, req.user.uid || req.user.username,
            data.currentPassword, function(err, user) {
                if (err) {
                    return res.status(400).json({
                        status: 'error',
                        message: 'There were problems authenticating you.',
                        errors: err
                    });
                }

                if (!user) {
                    return res.status(401).json({
                        status: 'error',
                        message: 'Incorrect login credentials.'
                    });
                }

                core.account.update(req.user._id, data, function (err, user, update) {
                    if (err || !user) {
                        return res.status(400).json({
                            status: 'error',
                            message: 'Unable to update your account.',
                            reason: 'Unknow reason',
                            errors: err
                        });
                    }

                    if (update !== null) {
                        onUpdate(update, function() {
                            res.json(user);
                        });
                    } else {
                        res.json(user);
                    }
                });
            });
    };

    var postGenerateApiTokenHandler = function(req, res) {
        if (req.user.usingToken) {
            return res.status(403).json({
                status: 'error',
                message: 'Cannot generate a new token ' +
                'when using token authentication.'
            });
        }

        core.account.generateToken(req.user._id, function (err, token) {
            if (err) {
                return res.json({
                    status: 'error',
                    message: 'Unable to generate a token.',
                    errors: err
                });
            }

            res.json({
                status: 'success',
                message: 'Token generated.',
                token: token
            });
        });
    };

    var postRevokeApiTokenHandler = function(req, res) {
        if (req.user.usingToken) {
            return res.status(403).json({
                status: 'error',
                message: 'Cannot revoke token ' +
                'when using token authentication.'
            });
        }

        core.account.revokeToken(req.user._id, function (err) {
            if (err) {
                return res.json({
                    status: 'error',
                    message: 'Unable to revoke token.',
                    errors: err
                });
            }

            res.json({
                status: 'success',
                message: 'Token revoked.'
            });
        });
    };

    //
    // Routes
    //
    app.get('/', middlewares.requireLogin.redirect, getRootHandler);

    app.get('/login', getLoginHandler);

    // TODO: using get for logout is sketchy... why do they do this?
    app.get('/logout', getLogoutHandler);

    app.post('/account/login', postAccountLoginHandler);

    app.post('/account/register', postAccountRegisterHandler);

    app.get('/account', middlewares.requireLogin, getAccountHandler);

    app.post('/account/profile', middlewares.requireLogin, postAccountProfileHandler);

    app.post('/account/settings', middlewares.requireLogin, postAccountSettingsHandler);

    app.post('/account/token/generate', middlewares.requireLogin, postGenerateApiTokenHandler);

    app.post('/account/token/revoke', middlewares.requireLogin, postRevokeApiTokenHandler);

};
