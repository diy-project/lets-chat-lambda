//
// Files Controller
//

'use strict';

var multer = require('multer');

module.exports = function() {

    var app = this.app,
        sqs = this.sqs,
        core = this.core,
        middlewares = this.middlewares,
        models = this.models,
        settings = this.settings;

    if (!settings.files.enable) {
        return;
    }

    function onNewFile(file, room, user, cb) {
        var fil = file.toJSON();
        fil.owner = user;
        fil.room = room.toJSON(user);

        var promise = sqs.to(room._id).emit('files:new', fil);
        sqs.wait(promise, cb);
    }

    function onNewMessage(message, room, user, cb) {
        var msg = message.toJSON();
        msg.owner = user;
        msg.room = room.toJSON(user);

        var promise = sqs.to(room.id).emit('messages:new', msg);
        sqs.wait(promise, cb);
    }

    var fileUpload = multer({
        limits: {
            files: 1,
            fileSize: settings.files.maxFileSize
        },
        storage: multer.diskStorage({})
    }).any();

    var listFilesHandler = function(req, res) {
        var options = {
            userId: req.user._id,
            password: req.param('password'),

            room: req.param('room'),
            reverse: req.param('reverse'),
            skip: parseInt(req.param('skip')),
            take: parseInt(req.param('take')),
            expand: req.param('expand')
        };

        core.files.list(options, function(err, files) {
            if (err) {
                return res.sendStatus(400);
            }

            files = files.map(function(file) {
                return file.toJSON(req.user);
            });

            res.json(files);
        });
    };

    var createFileHandler = function(req, res) {
        if (!req.files) {
            return res.sendStatus(400);
        }

        var postInRoom = (req.param('post') === 'true') && true;
        var options = {
            owner: req.user._id,
            room: req.param('room'),
            file: req.files[0],
            post: postInRoom
        };

        core.files.create(options, function(err, file, room, user, message) {
            if (err) {
                console.error(err);
                return res.sendStatus(400);
            }
            onNewFile(file, room, user, function() {
                function cb() {
                    res.status(201).json(file);
                }
                if (message !== null) {
                    onNewMessage(message, room, user, cb);
                } else {
                    cb();
                }
            });
        });
    };

    var getFileHandler = function(req, res) {
        models.file.findById(req.params.id, function(err, file) {
            if (err) {
                // Error
                return res.send(400);
            }

            if (!file) {
                return res.send(404);
            }

            var isImage = [
                'image/jpeg',
                'image/png',
                'image/gif'
            ].indexOf(file.type) > -1;

            var url = core.files.getUrl(file);

            if (settings.files.provider === 'local') {
                res.sendFile(url, {
                    headers: {
                        'Content-Type': file.type,
                        'Content-Disposition': isImage ? 'inline' : 'attachment'
                    }
                });
            } else {
                res.redirect(url);
            }

        });
    };

    //
    // Routes
    //
    app.route('/files')
        .all(middlewares.requireLogin)
        .get(listFilesHandler)
        .post(fileUpload, middlewares.cleanupFiles, createFileHandler);

    app.route('/rooms/:room/files')
        .all(middlewares.requireLogin, middlewares.roomRoute)
        .get(listFilesHandler)
        .post(fileUpload, middlewares.cleanupFiles, createFileHandler);

    app.route('/files/:id/:name')
        .all(middlewares.requireLogin)
        .get(getFileHandler);

};
