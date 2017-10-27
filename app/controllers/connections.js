//
// Connections Controller
//

'use strict';

module.exports = function() {

    var app = this.app,
        core = this.core,
        middlewares = this.middlewares;

    var listConnectionsHandler = function (req, res) {
        var query = {};

        if (req.param('type')) {
            query.type = req.param('type');
        }

        if (req.param('user')) {
            query.user = req.param('user');
        }

        var connections = core.presence.system.connections.query(query);
        res.json(connections);
    };

    //
    // Routes
    //
    app.get('/connections', middlewares.requireLogin, listConnectionsHandler);

    app.get('/connections/type/:type', middlewares.requireLogin, listConnectionsHandler);

    app.get('/connections/user/:user', middlewares.requireLogin, listConnectionsHandler);

};
