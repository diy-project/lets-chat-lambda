//
// Emotes / Replacements Controller
//

'use strict';

module.exports = function() {

    var _ = require('lodash'),
        fs = require('fs'),
        path = require('path'),
        yaml = require('js-yaml'),
        express = require('express');

    var app = this.app,
        settings = this.settings,
        middlewares = this.middlewares;

    var getEmotesListHandler = function(req, res) {
        var emotes = [];

        var dir = path.join(process.cwd(), 'extras/emotes');
        fs.readdir(dir, function (err, files) {
            if (err) {
                return res.json(emotes);
            }

            var regex = new RegExp('\\.yml$');

            files = files.filter(function (fileName) {
                return regex.test(fileName);
            });

            files.forEach(function (fileName) {
                var fullpath = path.join(
                    process.cwd(),
                    'extras/emotes',
                    fileName
                );

                var imgDir;
                if (settings.cdn.enabled) {
                    imgDir = settings.cdn.url + '/emotes/' +
                        fileName.replace('.yml', '') + '/';
                } else {
                    imgDir = 'extras/emotes/' +
                        fileName.replace('.yml', '') + '/';
                }

                var file = fs.readFileSync(fullpath, 'utf8');
                var data = yaml.safeLoad(file);
                _.each(data, function (emote) {
                    if (settings.cdn.enabled) {
                        emote.image = imgDir + encodeURIComponent(emote.image);
                    } else {
                        emote.image = imgDir + emote.image;
                    }
                    emotes.push(emote);
                });
            });

            res.json(emotes);
        });
    };

    var getReplacementsListHandler = function(req, res) {
        var replacements = [];
        ['default.yml', 'local.yml'].forEach(function(filename) {
            var fullpath = path.join(process.cwd(), 'extras/replacements/' + filename);
            if (fs.existsSync(fullpath)) {
                replacements = _.merge(replacements, yaml.safeLoad(fs.readFileSync(fullpath, 'utf8')));
            }
        });
        res.json(replacements);
    };

    //
    // Routes
    //
    app.get('/extras/emotes', middlewares.requireLogin, getEmotesListHandler);

    if (!settings.cdn.enabled) {
        app.use('/extras/emotes/',
            express.static(path.join(process.cwd(), 'media/emotes'), {
                maxage: '364d'
            })
        );
    }

    app.get('/extras/replacements', middlewares.requireLogin, getReplacementsListHandler);

};
