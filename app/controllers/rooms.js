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

    // core.on('presence:user_join',
    function onUserJoin(data, cb) {
        User.findById(data.userId, function (err, user) {
            var promise = null;
            if (!err && user) {
                user = user.toJSON();
                user.room = data.roomId;
                if (data.roomHasPassword) {
                    promise = sqs.to(data.roomId).emit('users:join', user);
                } else {
                    promise = sqs.emit('users:join', user);
                }
            }
            sqs.wait(promise, cb);
        });
    }

    // core.on('presence:user_leave',
    function onUserLeave(data, cb) {
        User.findById(data.userId, function (err, user) {
            var promise = null;
            if (!err && user) {
                user = user.toJSON();
                user.room = data.roomId;
                if (data.roomHasPassword) {
                    promise = sqs.to(data.roomId).emit('users:leave', user);
                } else {
                    promise = sqs.emit('users:leave', user);
                }
            }
            sqs.wait(promise, cb);
        });
    }

    var getEmitters = function(room) {
        if (room.private && !room.hasPassword) {
            return room.participants.map(function(user) {
                return {
                    emitter: sqs.queue(user._id),
                    user: user
                };
            });
        }

        return [{
            emitter: sqs
        }];
    };

    function onNew(room, cb) {
        var emitters = getEmitters(room);
        var promises = emitters.map(function(e) {
            return e.emitter.emit('rooms:new', room.toJSON(e.user));
        });
        sqs.wait(promises, cb);
    }

    function onUpdate(room, cb) {
        var emitters = getEmitters(room);
        var promises = emitters.map(function(e) {
            return e.emitter.emit('rooms:update', room.toJSON(e.user));
        });
        sqs.wait(promises, cb);
    }

    function onArchive(room, cb) {
        var emitters = getEmitters(room);
        var promises = emitters.map(function(e) {
            return e.emitter.emit('rooms:archive', room.toJSON(e.user));
        });
        sqs.wait(promises, cb);
    }

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

        if (!settings.rooms.private) {
            options.private = false;
            delete options.password;
        }

        core.rooms.create(options, function(err, room) {
            if (err) {
                console.error(err);
                return res.status(400).json(err);
            }

            onNew(room, function() {
                res.status(201).json(room.toJSON(req.user));
            });
        });
    };

    var updateRoomHandler = function(req, res) {
        var roomId = req.param('room');
        console.log('Update', roomId);

        var options = {
            name: req.param('name'),
            slug: req.param('slug'),
            description: req.param('description'),
            password: req.param('password'),
            participants: req.param('participants'),
            user: req.user
        };

        if (!settings.rooms.private) {
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

            onUpdate(room, function() {
                res.json(room.toJSON(req.user));
            });
        });
    };

    var archiveRoomHandler = function(req, res) {
        var roomId = req.param('room');

        core.rooms.archive(roomId, function(err, room) {
            if (err) {
                console.log(err);
                return res.sendStatus(400);
            }

            if (!room) {
                return res.sendStatus(404);
            }

            onArchive(room, function() {
                res.sendStatus(204);
            });
        });
    };

    var joinRoomHandler = function(req, res) {
        var userId = req.user._id;
        var options = {
            userId: userId,
            saveMembership: true
        };

        if (typeof req.data === 'string') {
            options.id = req.data;
        } else {
            options.id = req.param('room');
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

            core.users.get(userId, function (err, user) {
                if (err) {
                    console.error(err);
                    return res.sendStatus(400);
                }

                if (!user) {
                    return res.sendStatus(404);
                }

                var roomId = room._id.toString();
                core.rooms.get(roomId, function (err, room) {
                    if (err) {
                        console.error(err);
                        return res.sendStatus(400);
                    }

                    if (!room) {
                        return res.sendStatus(404);
                    }

                    // Modify the DB
                    function updateDB(cb) {
                        user.rooms.addToSet({_id: roomId});
                        user.openRooms.addToSet(roomId);
                        room.participants.addToSet({_id: userId});
                        user.save(function() {
                            room.save(function() {
                                cb();
                            });
                        });
                    }

                    updateDB(function() {
                        // Announce that the user has joined
                        onUserJoin(
                            core.presence.leave(user, room),
                            function() {
                                res.json(room.toJSON(req.user));
                            }
                        );
                    });
                });
            });
        });
    };

    var leaveRoomHandler = function(req, res) {
        var roomId = req.param('room');
        var user = req.user.toJSON();
        var userId = user.id;

        core.users.get(userId, function(err, user) {
            if (err) {
                console.error(err);
                return res.sendStatus(400);
            }
            if (!user) {
                return res.sendStatus(404);
            }

            core.rooms.get(roomId, function (err, room) {
                if (err) {
                    console.error(err);
                    return res.sendStatus(400);
                }

                if (!room) {
                    return res.sendStatus(404);
                }

                // Modify the DB
                function updateDB(cb) {
                    user.rooms.pull({_id: roomId});
                    user.openRooms.pull(roomId);
                    room.participants.pull({_id: userId});
                    user.save(function() {
                        room.save(function() {
                            cb();
                        });
                    });
                }

                updateDB(function() {
                    // Announce that the user has left
                    onUserLeave(
                        core.presence.leave(user, room),
                        function() {
                            res.json();
                        }
                    );
                });
            });
        });
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

            var users = room.participants;
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
