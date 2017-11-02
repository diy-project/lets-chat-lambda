//
// Transcript Controller
//

'use strict';

module.exports = function() {
    var app = this.app,
        core = this.core,
        middlewares = this.middlewares,
        settings = this.settings;

    var getTranscriptHandler = function(req, res) {
        var roomId = req.param('room');
        core.rooms.get(roomId, function(err, room) {
            if (err) {
                console.error(err);
                return res.sendStatus(404);
            }

            if (!room) {
                return res.sendStatus(404);
            }

            var assetUrl;
            if (settings.cdn.enabled) {
                assetUrl = settings.cdn.url;
            } else {
                assetUrl = './media';
            }
            res.render('transcript.html', {
                assetUrl: assetUrl,
                room: {
                    id: roomId,
                    name: room.name
                }
            });
        });
    };

    //
    // Routes
    //
    app.get('/transcript', middlewares.requireLogin, getTranscriptHandler);
};
