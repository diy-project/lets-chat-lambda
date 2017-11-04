//
// UserMessages Controller
//

'use strict';

var _ = require('lodash');

module.exports = function() {

    var app = this.app,
        core = this.core,
        middlewares = this.middlewares,
        settings = this.settings;


    if (!settings.private.enable) {
        return;
    }

    function onNew(message, user, owner, cb) {
        _.each(message.users, function(userId) {
            // TODO: this is not used

            // var connections = core.presence.system.connections.query({
            //     type: 'sqs.io', userId: userId.toString()
            // });

            // _.each(connections, function(connection) {
            //     connection.queue.emit('user-messages:new', message);
            // });
        });
        cb();
    }

    var createUserMessageHandler = function(req, res) {
        var options = {
            owner: req.user._id,
            user: req.param('user'),
            text: req.param('text')
        };

        core.usermessages.create(options, function(err, message, user, owner) {
            if (err) {
                return res.sendStatus(400);
            }

            onNew(message, user, owner, function() {
                res.status(201).json(message);
            });
        });
    };

    var listUserMessagesHandler = function(req, res) {
        var options = {
            currentUser: req.user._id,
            user: req.param('user'),
            since_id: req.param('since_id'),
            from: req.param('from'),
            to: req.param('to'),
            reverse: req.param('reverse'),
            skip: parseInt(req.param('skip')),
            take: parseInt(req.param('take')),
            expand: req.param('expand')
        };

        core.usermessages.list(options, function(err, messages) {
            if (err) {
                return res.sendStatus(400);
            }
            res.json(messages);
        });
    };

    //
    // Routes
    //

    app.route('/users/:user/messages')
        .all(middlewares.requireLogin)
        .get(listUserMessagesHandler)
        .post(createUserMessageHandler);

};
