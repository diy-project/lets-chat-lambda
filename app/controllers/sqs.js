'use strict';

module.exports = function() {
    var app = this.app,
        sqs = this.sqs,
        middlewares = this.middlewares;

    var getSqsUrlHandler = function(req, res) {
        var userId = req.user._id;
        sqs.getUrl(userId, function (url) {
            res.json({url: url});
        });
    };

    var getSqsCredentialsHandler = function(req, res) {
        sqs.getTemporaryCredentials(function(credentials) {
            res.json(credentials);
        });
    };

    //
    // Routes
    //
    app.get('/sqs', middlewares.requireLogin, getSqsUrlHandler);

    app.get('/sqs/credentials', middlewares.requireLogin, getSqsCredentialsHandler);

};
