//
// LCB Client
//

(function(window, $, _) {

    //
    // Base
    //
    var Client = function(options) {
        this.options = options;
        this.status = new Backbone.Model();
        this.user = new UserModel();
        this.users = new UsersCollection();
        this.rooms = new RoomsCollection();
        this.events = _.extend({}, Backbone.Events);
        this.sqs = undefined;
        this.sqsUrl = undefined;
        this.sqsExpireTime = undefined;
        return this;
    };
    //
    // Account
    //
    Client.prototype.getUser = function() {
        var that = this;
        $.get('/account', function(user) {
            that.user.set(user);
        });
    };
    Client.prototype.updateProfile = function(profile) {
        var that = this;
        $.post('/account/profile', profile, function(user) {
            that.user.set(user);
        });
    };

    //
    // Rooms
    //
    Client.prototype.createRoom = function(data) {
        var that = this;
        var room = {
            name: data.name,
            slug: data.slug,
            description: data.description,
            password: data.password,
            participants: data.participants,
            private: data.private
        };
        var callback = data.callback;
        $.post('/rooms', room, function(room) {
            if (room && room.errors) {
                swal("Unable to create room",
                    "Room slugs can only contain lower case letters, numbers or underscores!",
                    "error");
            } else if (room && room.id) {
                that.addRoom(room);
                that.switchRoom(room.id);
            }
            callback && callback(room);
        });
    };
    Client.prototype.getRooms = function(cb) {
        var that = this;
        $.get('/rooms', function(rooms) {
            that.rooms.set(rooms);
            // Get users for each room!
            // We do it here for the room browser
            _.each(rooms, function(room) {
                if (room.users) {
                    that.setUsers(room.id, room.users);
                }
            });

            if (cb) {
                cb(rooms);
            }
        });
    };
    Client.prototype.switchRoom = function(id) {
        // Make sure we have a last known room ID
        this.rooms.last.set('id', this.rooms.current.get('id'));
        if (!id || id === 'list') {
            this.rooms.current.set('id', 'list');
            this.router.navigate('!/', {
                replace: true
            });
            return;
        }
        var room = this.rooms.get(id);
        if (room && room.get('joined')) {
            this.rooms.current.set('id', id);
            this.router.navigate('!/room/' + room.id, {
                replace: true
            });
        } else if(room) {
            this.joinRoom(room, true);
        } else {
            this.joinRoom({id: id}, true);
        }
    };
    Client.prototype.updateRoom = function(room) {
        $.ajax({
            url: '/rooms/' + room.id,
            type: 'PUT',
            data: room
        });
    };
    Client.prototype.roomUpdate = function(resRoom) {
        var room = this.rooms.get(resRoom.id);
        if (!room) {
            this.addRoom(resRoom);
            return;
        }
        room.set(resRoom);
    };
    Client.prototype.addRoom = function(room) {
        var r = this.rooms.get(room.id);
        if (r) {
            return r;
        }
        return this.rooms.add(room);
    };
    Client.prototype.archiveRoom = function(options) {
        console.log(options);
        var archiveRoomCB = function(data, text, xhr) {
            if (xhr.status != 204) {
                swal('Unable to Archive!',
                    'Unable to archive this room!',
                    'error');
            }
        };
        var archiveRoomErrorCB = function(xhr, text, err) {
            archiveRoomCB(xhr.status);
        };
        $.ajax({
            url: '/rooms/' + options.room,
            type: 'DELETE',
            success: archiveRoomCB,
            error: archiveRoomErrorCB
        });
    };
    Client.prototype.roomArchive = function(room) {
        this.leaveRoom(room.id);
        this.rooms.remove(room.id);
    };
    Client.prototype.rejoinRoom = function(room) {
        this.joinRoom(room, undefined, true);
    };
    Client.prototype.lockJoin = function(id) {
        if (_.contains(this.joining, id)) {
            return false;
        }

        this.joining = this.joining || [];
        this.joining.push(id);
        return true;
    };
    Client.prototype.unlockJoin = function(id) {
        var that = this;
        _.defer(function() {
            that.joining = _.without(that.joining, id);
        });
    };
    Client.prototype.joinRoom = function(room, switchRoom, rejoin) {
        if (!room || !room.id) {
            return;
        }

        var that = this;
        var id = room.id;
        var password = room.password;

        if (!rejoin) {
            // Must not have already joined
            var room1 = that.rooms.get(id);
            if (room1 && room1.get('joined')) {
                return;
            }
        }

        if (!this.lockJoin(id)) {
            return;
        }

        var passwordCB = function(password) {
            room.password = password;
            that.joinRoom(room, switchRoom, rejoin);
        };

        var joinRoomCB = function(resRoom) {
            // Room was likely archived if this returns
            if (!resRoom) {
                return;
            }

            if (resRoom && resRoom.errors) {
                that.unlockJoin(id);
                return;
            }

            var room = that.addRoom(resRoom);
            room.set('joined', true);

            if (room.get('hasPassword')) {
                that.getRoomUsers(room.id, _.bind(function(users) {
                    this.setUsers(room.id, users);
                }, that));
            }

            // Get room history
            that.getMessages({
                room: room.id,
                since_id: room.lastMessage.get('id'),
                take: 200,
                expand: 'owner, room',
                reverse: true
            }, function(messages) {
                messages.reverse();
                that.addMessages(messages, !rejoin && !room.lastMessage.get('id'));
                !rejoin && room.lastMessage.set(messages[messages.length - 1]);
            });

            if (that.options.filesEnabled) {
                that.getFiles({
                    room: room.id,
                    take: 15
                }, function(files) {
                    files.reverse();
                    that.setFiles(room.id, files);
                });
            }
            // Do we want to switch?
            if (switchRoom) {
                that.switchRoom(id);
            }
            //
            // Add room id to User Open rooms list.
            //
            var orooms = that.user.get('openRooms') || [];
            if ( ! _.contains(orooms,id)) {
                orooms.push(id);
            }

            $.post('/account/profile', {'openRooms': orooms });

            that.unlockJoin(id);
        };

        var joinRoomErrorCB = function(res, text, err) {
            var resRoom = res.responseJSON;
            if (resRoom && resRoom.errors &&
                resRoom.errors === 'password required') {

                that.passwordModal.show({
                    roomName: resRoom.roomName,
                    callback: passwordCB
                });

                that.unlockJoin(id);
                return;
            }

            if (resRoom && resRoom.errors) {
                that.unlockJoin(id);
                return;
            }
        };

        $.ajax({
            url: '/rooms/' + room.id + '/users/me',
            type: 'PUT',
            data: {roomId: id, password: password},
            success: joinRoomCB,
            error: joinRoomErrorCB
        });
    };
    Client.prototype.leaveRoom = function(id) {
        var room = this.rooms.get(id);
        if (room) {
            room.set('joined', false);
            room.lastMessage.clear();
            if (room.get('hasPassword')) {
                room.users.set([]);
            }
        }

        $.ajax({
            url: '/rooms/' + room.id + '/users/me',
            type: 'DELETE'
        });

        if (id === this.rooms.current.get('id')) {
            var room = this.rooms.get(this.rooms.last.get('id'));
            this.switchRoom(room && room.get('joined') ? room.id : '');
        }
        // Remove room id from User open rooms list.
        var orooms = this.user.get('openRooms');
        orooms = _.without(orooms, id);
        $.post('/account/profile', {'openRooms': orooms });
    };
    Client.prototype.getRoomUsers = function(id, callback) {
        $.get('/rooms/' + id + '/users', callback)
    };
    //
    // Messages
    //
    Client.prototype.addMessage = function(message) {
        var room = this.rooms.get(message.room);
        if (!room || !message) {
            // Unknown room, nothing to do!
            return;
        }
        room.set('lastActive', message.posted);
        if (!message.historical) {
            room.lastMessage.set(message);
        }

        room.trigger('messages:new', message);
    };
    Client.prototype.addMessages = function(messages, historical) {
        _.each(messages, function(message) {
            if (historical) {
                message.historical = true;
            }
            this.addMessage(message);
        }, this);
    };
    Client.prototype.sendMessage = function(message) {
        $.post('/messages', message)
    };
    Client.prototype.getMessages = function(query, callback) {
        $.ajax({
            url: '/messages',
            type: 'GET',
            data: query,
            success: callback
        });
    };
    //
    // Files
    //
    Client.prototype.getFiles = function(query, callback) {
        var query = {
            room: query.room || '',
            take: query.take || 40,
            expand: query.expand || 'owner'
        };
        $.ajax({
            url: '/files',
            type: 'GET',
            data: query,
            success: callback
        });
    };
    Client.prototype.setFiles = function(roomId, files) {
        if (!roomId || !files || !files.length) {
            // Nothing to do here...
            return;
        }
        var room = this.rooms.get(roomId);
        if (!room) {
            // No room
            return;
        }
        room.files.set(files);
    };
    Client.prototype.addFile = function(file) {
        var room = this.rooms.get(file.room);
        if (!room) {
            // No room
            return;
        }
        room.files.add(file);
    };
    //
    // Users
    //
    Client.prototype.setUsers = function(roomId, users) {
        if (!roomId || !users || !users.length) {
            // Data is not valid
            return;
        }
        var room = this.rooms.get(roomId);
        if (!room) {
            // No room
            return;
        }
        room.users.set(users);
    };
    Client.prototype.addUser = function(user) {
        var room = this.rooms.get(user.room);
        if (!room) {
            // No room
            return;
        }
        room.users.add(user);
    };
    Client.prototype.removeUser = function(user) {
        var room = this.rooms.get(user.room);
        if (!room) {
            // No room
            return;
        }
        room.users.remove(user.id);
    };
    Client.prototype.updateUser = function(user) {
        // Update if current user
        if (user.id == this.user.id) {
            this.user.set(user);
        }
        // Update all rooms
        this.rooms.each(function(room) {
            var target = room.users.findWhere({
                id: user.id
            });
            target && target.set(user);
        }, this);
    };
    Client.prototype.getUsersSync = function() {
        if (this.users.length) {
            return this.users;
        }

        var that = this;

        function success(users) {
            that.users.set(users);
        }

        $.ajax({url:'./users', async: false, success: success});

        return this.users;
    };
    //
    // Extras
    //
    Client.prototype.getEmotes = function(callback) {
        this.extras = this.extras || {};
        if (!this.extras.emotes) {
            // Use AJAX, so we can take advantage of HTTP caching
            // Also, it's a promise - which ensures we only load emotes once
            this.extras.emotes = $.get('./extras/emotes');
        }
        if (callback) {
            this.extras.emotes.done(callback);
        }
    };
    Client.prototype.getReplacements = function(callback) {
        this.extras = this.extras || {};
        if (!this.extras.replacements) {
            // Use AJAX, so we can take advantage of HTTP caching
            // Also, it's a promise - which ensures we only load emotes once
            this.extras.replacements = $.get('./extras/replacements');
        }
        if (callback) {
            this.extras.replacements.done(callback);
        }
    };
    //
    // SQS
    //
    Client.prototype.getSqsUrl = function() {
        var that = this;
        $.get('/sqs', function(data) {
            console.log('SQS URL:', data.url);
            that.sqsUrl = data.url;
        });
    };
    Client.prototype.refreshSqsClient = function() {
        var that = this;
        // TODO: could be more efficient here if credentials did not change
        $.get('/sqs/credentials', function(data) {
            that.sqsExpireTime = new Date(data.expireTime);
            that.sqs = new AWS.SQS({
                accessKeyId: data.accessKeyId,
                secretAccessKey: data.secretAccessKey,
                sessionToken: data.sessionToken,
                region: data.region,
                sslEnabled: true
            });
        });
    };
    Client.prototype.handleEvent = function(event, data) {
        console.log(event, data);
        if (event === 'messages:new') {
            this.addMessage(data);
        } else if (event === 'rooms:new') {
            this.addRoom(data);
        } else if (event === 'rooms:update') {
            this.roomUpdate(data);
        } else if (event === 'rooms:archive') {
            this.roomArchive(data);
        } else if (event === 'users:join') {
            this.addUser(data);
        } else if (event === 'users:leave') {
            this.removeUser(data);
        } else if (event === 'users:update') {
            this.updateUser(data);
        } else if (event === 'files:new') {
            this.addFile(data);
        } else {
            console.log('unknown event', event, data);
        }
    };
    //
    // Router Setup
    //
    Client.prototype.route = function() {
        var that = this;
        var Router = Backbone.Router.extend({
            routes: {
                '!/room/': 'list',
                '!/room/:id': 'join',
                '*path': 'list'
            },
            join: function(id) {
                that.switchRoom(id);
            },
            list: function() {
                that.switchRoom('list');
            }
        });
        this.router = new Router();
        Backbone.history.start();
    };
    //
    // Listen
    //
    Client.prototype.listen = function() {
        var that = this;

        function joinRooms(rooms) {
            //
            // Join rooms from User's open Rooms List.
            // We need to check each room is available before trying to join
            //
            var roomIds = _.map(rooms, function(room) {
                return room.id;
            });

            var openRooms = that.user.get('openRooms') || [];

            // Let's open some rooms!
            _.defer(function() {
                //slow down because router can start a join with no password
                _.each(openRooms, function(id) {
                    if (_.contains(roomIds, id)) {
                        that.joinRoom({ id: id });
                    }
                });
            }.bind(this));
        }

        // TODO: this is a hack that causes the UI to load
        setTimeout(function () {
            that.getUser();
            that.getRooms(joinRooms);
            that.status.set('connected', true);

            // This announces the client's presence
            setInterval(function() {
                $.post('/presence');
                _.each(that.rooms.where({ joined: true }), function(room) {
                    that.rejoinRoom(room);
                });
            }, 60 * 1000); // Every minute

            that.getSqsUrl();
            that.refreshSqsClient();

            // Poll SQS for new events
            function pollSqs() {
                var currTime = new Date();
                var sqs = that.sqs;
                var sqsUrl = that.sqsUrl;
                var sqsExpireTime = that.sqsExpireTime;
                if (sqsUrl && sqs && sqsExpireTime > currTime) {
                    var receiveParams = {
                        QueueUrl: sqsUrl,
                        MaxNumberOfMessages: 10,
                        MessageAttributeNames: ['Event', 'Room']
                    };
                    sqs.receiveMessage(receiveParams, function(err, data) {
                        if (err) {
                            console.log('SQS receive error', err, err.stack);
                        } else {
                            var entries = Array.from(data.Messages, function (message) {
                                var event = message.MessageAttributes.Event.StringValue;
                                var room;
                                if (message.MessageAttributes.Room) {
                                    room = message.MessageAttributes.Room.StringValue;
                                    console.log('Room:', room);
                                }
                                var data = JSON.parse(message.Body);
                                that.handleEvent(event, data);
                                return {
                                    Id: message.MessageId,
                                    ReceiptHandle: message.ReceiptHandle
                                };
                            });
                            // Delete if non-empty
                            if (entries.length > 0) {
                                var deleteParams = {
                                    Entries: entries,
                                    QueueUrl: sqsUrl
                                };
                                sqs.deleteMessageBatch(deleteParams, function (err, data) {
                                    if (err) {
                                        console.log('SQS delete error', err, err.stack);
                                    }
                                });
                            }
                        }
                        setTimeout(pollSqs, 1000); // 1s
                    });
                } else {
                    setTimeout(pollSqs, 1000); // 1s
                }
            }
            pollSqs();

        }, 1000);

        //
        // GUI
        //
        this.events.on('messages:send', this.sendMessage, this);
        this.events.on('rooms:update', this.updateRoom, this);
        this.events.on('rooms:leave', this.leaveRoom, this);
        this.events.on('rooms:create', this.createRoom, this);
        this.events.on('rooms:switch', this.switchRoom, this);
        this.events.on('rooms:archive', this.archiveRoom, this);
        this.events.on('profile:update', this.updateProfile, this);
        this.events.on('rooms:join', this.joinRoom, this);
    };
    //
    // Start
    //
    Client.prototype.start = function() {
        this.getEmotes();
        this.getReplacements();
        this.listen();
        this.route();
        this.view = new window.LCB.ClientView({
            client: this
        });
        this.passwordModal = new window.LCB.RoomPasswordModalView({
            el: $('#lcb-password')
        });
        return this;
    };
    //
    // Add to window
    //
    window.LCB = window.LCB || {};
    window.LCB.Client = Client;
})(window, $, _);
