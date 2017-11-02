//
// Users Controller
//

'use strict';

module.exports = function() {

    var app = this.app,
        core = this.core,
        middlewares = this.middlewares,
        models = this.models,
        User = models.user;

    var listUsersHandler = function(req, res) {
        var isActive = req.param('isActive') === 'true';

        var options = {
            skip: parseInt(req.param('skip')),
            take: parseInt(req.param('take'))
        };

        core.users.list(options, function(err, users) {
            if (err) {
                console.log(err);
                return res.status(400).json(err);
            }

            if (isActive) {
                var currentTime = new Date().getTime();
                res.json(users.filter(function(user) {
                    if (user.lastPresent) {
                        // Only return users who have been present in the last 2 minutes
                        return 2 * 1000 > currentTime - user.lastPresent.getTime();
                    } else {
                        return false;
                    }
                }))
            } else {
                res.json(users);
            }
        });
    };

    var getUserHandler = function(req, res) {
        var identifier = req.param('id');

        User.findByIdentifier(identifier, function (err, user) {
            if (err) {
                console.error(err);
                return res.status(400).json(err);
            }

            if (!user) {
                return res.sendStatus(404);
            }

            res.json(user);
        });
    };

    //
    // Routes
    //
    app.get('/users', middlewares.requireLogin, listUsersHandler);

    app.get('/users/:id', middlewares.requireLogin, getUserHandler);

};
