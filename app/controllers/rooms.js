//
// Rooms Controller
//

'use strict';

module.exports = function() {
    var app = this.app,
        sqs = this.sqs,
        core = this.core,
        middlewares = this.middlewares,
        models = this.models,
        settings = this.settings,
        User = models.user;

    core.on('presence:user_join', function(data) {
        User.findById(data.userId, function (err, user) {
            if (!err && user) {
                user = user.toJSON();
                user.room = data.roomId;
                if (data.roomHasPassword) {
                    sqs.to(data.roomId).emit('users:join', user);
                } else {
                    sqs.emit('users:join', user);
                }
            }
        });
    });

    core.on('presence:user_leave', function(data) {
        User.findById(data.userId, function (err, user) {
            if (!err && user) {
                user = user.toJSON();
                user.room = data.roomId;
                if (data.roomHasPassword) {
                    sqs.to(data.roomId).emit('users:leave', user);
                } else {
                    sqs.emit('users:leave', user);
                }
            }
        });
    });

    var getEmitters = function(room) {
        if (room.private && !room.hasPassword) {
            var connections = core.presence.connections.query({
                type: 'sqs.io'
            }).filter(function(connection) {
                return room.isAuthorized(connection.user);
            });

            return connections.map(function(connection) {
                return {
                    emitter: connection.socket,
                    user: connection.user
                };
            });
        }

        return [{
            emitter: sqs
        }];
    };

    core.on('rooms:new', function(room) {
        var emitters = getEmitters(room);
        emitters.forEach(function(e) {
            e.emitter.emit('rooms:new', room.toJSON(e.user));
        });
    });

    core.on('rooms:update', function(room) {
        var emitters = getEmitters(room);
        emitters.forEach(function(e) {
            e.emitter.emit('rooms:update', room.toJSON(e.user));
        });
    });

    core.on('rooms:archive', function(room) {
        var emitters = getEmitters(room);
        emitters.forEach(function(e) {
            e.emitter.emit('rooms:archive', room.toJSON(e.user));
        });
    });

    var listRoomsHandler = function(req, res) {
        var options = {
            userId: req.user._id,
            users: req.param('users'),

            skip: parseInt(req.param('skip')),
            take: parseInt(req.param('take'))
        };

        core.rooms.list(options, function(err, rooms) {
            if (err) {
                console.error(err);
                return res.status(400).json(err);
            }

            var results = rooms.map(function(room) {
                return room.toJSON(req.user);
            });

            res.json(results);
        });
    };

    var getRoomHandler = function(req, res) {
        var options = {
            userId: req.user._id,
            identifier: req.param('room') || req.param('id')
        };

        core.rooms.get(options, function(err, room) {
            if (err) {
                console.error(err);
                return res.status(400).json(err);
            }

            if (!room) {
                return res.sendStatus(404);
            }

            res.json(room.toJSON(req.user));
        });
    };

    var createRoomHandler = function(req, res) {
        var options = {
            owner: req.user._id,
            name: req.param('name'),
            slug: req.param('slug'),
            description: req.param('description'),
            private: req.param('private'),
            password: req.param('password')
        };

        if (!settings.room.private) {
            options.private = false;
            delete options.password;
        }

        core.rooms.create(options, function(err, room) {
            if (err) {
                console.error(err);
                return res.status(400).json(err);
            }

            if (settings.lambdaEnabled) {
                setTimeout(function() {
                    res.status(201).json(room.toJSON(req.user));
                }, settings.lambda.sqsDelay);
            } else {
                res.status(201).json(room.toJSON(req.user));
            }
        });
    };

    var updateRoomHandler = function(req, res) {
        var roomId = req.param('room') || req.param('id');

        var options = {
            name: req.param('name'),
            slug: req.param('slug'),
            description: req.param('description'),
            password: req.param('password'),
            participants: req.param('participants'),
            user: req.user
        };

        if (!settings.room.private) {
            delete options.password;
            delete options.participants;
        }

        core.rooms.update(roomId, options, function(err, room) {
            if (err) {
                console.error(err);
                return res.status(400).json(err);
            }

            if (!room) {
                return res.sendStatus(404);
            }

            if (settings.lambdaEnabled) {
                setTimeout(function() {
                    res.json(room.toJSON(req.user));
                }, settings.lambda.sqsDelay);
            } else {
                res.json(room.toJSON(req.user));
            }
        });
    };

    var archiveRoomHandler = function(req, res) {
        var roomId = req.param('room') || req.param('id');

        core.rooms.archive(roomId, function(err, room) {
            if (err) {
                console.log(err);
                return res.sendStatus(400);
            }

            if (!room) {
                return res.sendStatus(404);
            }

            if (settings.lambdaEnabled) {
                setTimeout(function() {
                    res.sendStatus(204);
                }, settings.lambda.sqsDelay);
            } else {
                res.sendStatus(204);
            }
        });
    };

    var joinRoomHandler = function(req, res) {
        var options = {
            userId: req.user._id,
            saveMembership: true
        };

        if (typeof req.data === 'string') {
            options.id = req.data;
        } else {
            options.id = req.param('roomId');
            options.password = req.param('password');
        }

        core.rooms.canJoin(options, function(err, room, canJoin) {
            if (err) {
                console.error(err);
                return res.sendStatus(400);
            }

            if (!room) {
                return res.sendStatus(404);
            }

            if(!canJoin && room.password) {
                return res.status(403).json({
                    status: 'error',
                    roomName: room.name,
                    message: 'password required',
                    errors: 'password required'
                });
            }

            if(!canJoin) {
                return res.sendStatus(404);
            }

            var user = req.user.toJSON();
            user.room = room._id;

            // TODO: fix me!
            // core.presence.join(req.socket.conn, room);
            // req.socket.join(room._id);
            if (settings.lambdaEnabled) {
                setTimeout(function() {
                    res.json(room.toJSON(req.user));
                }, settings.lambda.sqsDelay);
            } else {
                res.json(room.toJSON(req.user));
            }
        });
    };

    var leaveRoomHandler = function(req, res) {
        var roomId = req.data;
        var user = req.user.toJSON();
        user.room = roomId;

        // TODO: fix me!
        // core.presence.leave(req.socket.conn, roomId);
        // req.socket.leave(roomId);
        if (settings.lambdaEnabled) {
            setTimeout(function() {res.json();}, settings.lambda.sqsDelay);
        } else {
            res.json();
        }
    };

    var getUsersHandler = function(req, res) {
        var roomId = req.param('room');

        core.rooms.get(roomId, function(err, room) {
            if (err) {
                console.error(err);
                return res.sendStatus(400);
            }

            if (!room) {
                return res.sendStatus(404);
            }

            var users = core.presence.rooms
                .getOrAdd(room)
                .getUsers()
                .map(function(user) {
                    // TODO: Do we need to do this?
                    user.room = room.id;
                    return user;
                });

            res.json(users);
        });
    };

    //
    // Routes
    //
    app.route('/rooms')
        .all(middlewares.requireLogin)
        .get(listRoomsHandler)
        .post(createRoomHandler);

    app.route('/rooms/:room')
        .all(middlewares.requireLogin, middlewares.roomRoute)
        .get(getRoomHandler)
        .put(updateRoomHandler)
        .delete(archiveRoomHandler);

    app.route('/rooms/:room/users')
        .all(middlewares.requireLogin, middlewares.roomRoute)
        .get(getUsersHandler);

    app.route('/rooms/:room/users/me')
        .all(middlewares.requireLogin, middlewares.roomRoute)
        .put(joinRoomHandler)
        .delete(leaveRoomHandler)

};
