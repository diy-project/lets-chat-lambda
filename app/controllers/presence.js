'use strict';

var util = require('util'),
    Connection = require('./../core/presence').Connection;

function SqsIoConnection(user, queue) {
    Connection.call(this, 'sqs.io', user);
    this.queue = queue;
    queue.conn = this;

    // TODO: no need for the following in SQS?
    // socket.on('disconnect', this.disconnect.bind(this));
}

util.inherits(SqsIoConnection, Connection);

SqsIoConnection.prototype.disconnect = function() {
    this.emit('disconnect');

    this.queue = null;
    queue.conn = null;
};

module.exports = function() {
    var app = this.app,
        sqs = this.sqs,
        core = this.core,
        middlewares = this.middlewares,
        User = this.models.user;

    var postPresenceHandler = function(req, res) {
        var userId = req.user._id;
        User.findById(userId, function(err, user) {
            if (err) {
                console.error(err);
                res.sendStatus(404);
                return;
            }

            // See if the user is connected already
            var connections = core.presence.system.connections.query({user: userId});
            if (!connections) {
                var conn = new SqsIoConnection(user, sqs.queue(userId));
                core.presence.connect(conn);
            }
            res.sendStatus(204);
        });
    };

    var removePresenceHandler = function(req, res) {
        var userId = req.user._id;

        // Remove active connections
        var connections = core.presence.system.connections.query({user: userId});
        connections.forEach(function(conn) {
            core.presence.system.connections.remove(conn);
        });
        res.sendStatus(204);
    };

    app.route('/presence')
        .all(middlewares.requireLogin)
        .post(postPresenceHandler)
        .delete(removePresenceHandler);

};
