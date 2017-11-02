'use strict';

module.exports = function() {
    var app = this.app,
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

            user.lastPresent = new Date();
            user.save(function(err, user, count) {
                res.sendStatus(204);
            });
        });
    };

    var removePresenceHandler = function(req, res) {
        var userId = req.user._id;
        User.findById(userId, function(err, user) {
            if (err) {
                console.error(err);
                res.sendStatus(404);
                return;
            }

            user.lastPresent = undefined;
            user.save(function (err, user, count) {
                res.sendStatus(204);
            });
        });
    };

    app.route('/presence')
        .all(middlewares.requireLogin)
        .post(postPresenceHandler)
        .delete(removePresenceHandler);

};
