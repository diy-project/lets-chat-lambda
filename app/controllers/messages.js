//
// Messages Controller
//

'use strict';

module.exports = function() {

    var app = this.app,
        sqs = this.sqs,
        core = this.core,
        middlewares = this.middlewares;

    function onNew(message, room, user, cb) {
        var msg = message.toJSON();
        msg.owner = user;
        msg.room = room.toJSON(user);

        var promise = sqs.to(room.id).emit('messages:new', msg);
        sqs.wait(promise, cb);
    }

    var listMessagesHandler = function(req, res) {
        var options = {
            userId: req.user._id,
            password: req.param('password'),

            room: req.param('room'),
            since_id: req.param('since_id'),
            from: req.param('from'),
            to: req.param('to'),
            query: req.param('query'),
            reverse: req.param('reverse'),
            skip: parseInt(req.param('skip')),
            take: parseInt(req.param('take')),
            expand: req.param('expand')
        };

        core.messages.list(options, function(err, messages) {
            if (err) {
                return res.sendStatus(400);
            }

            messages = messages.map(function(message) {
                return message.toJSON(req.user);
            });

            res.json(messages);
        });
    };

    var createMessageHandler = function(req, res) {
        var options = {
            owner: req.user._id,
            room: req.param('room'),
            text: req.param('text')
        };

        core.messages.create(options, function(err, message, room, user) {
            if (err) {
                return res.sendStatus(400);
            }
            onNew(message, room, user, function() {
                res.status(201).json(message);
            });
        });
    };

    //
    // Routes
    //
    app.route('/messages')
        .all(middlewares.requireLogin)
        .get(listMessagesHandler)
        .post(createMessageHandler);

    app.route('/rooms/:room/messages')
        .all(middlewares.requireLogin, middlewares.roomRoute)
        .get(listMessagesHandler)
        .post(createMessageHandler);

};
