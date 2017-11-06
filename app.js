//
// Let's Chat (reimplemented)
//

'use strict';

var appInitTime = new Date().getTime();
function logMillisSinceInit(message) {
    var millisSinceInit = new Date().getTime() - appInitTime;
    console.log(message + ': ' + millisSinceInit + 'ms');
}

process.title = 'letschat';

require('colors');

var _ = require('lodash'),
    path = require('path'),
    fs = require('fs'),
    http = require('http'),
    https = require('https'),
    express = require('express'),
    session = require('express-session'),
    awsServerlessExpress = require('aws-serverless-express'),
    i18n = require('i18n'),
    bodyParser = require('body-parser'),
    cookieParser = require('cookie-parser'),
    compression = require('compression'),
    helmet = require('helmet'),
    nunjucks = require('nunjucks'),
    mongoose = require('mongoose'),
    connectMongo = require('connect-mongo/es5'),
    all = require('require-tree'),
    psjon = require('./package.json'),
    settings = require('./app/config'),
    auth = require('./app/auth/index'),
    core = require('./app/core/index'),
    sqsIo = require('./app/sqs-io');

logMillisSinceInit('Loaded third-party deps');

var MongoStore = connectMongo(session),
    lambdaEnabled = process.env.AWS_LAMBDA && process.env.AWS_LAMBDA === 'TRUE',
    httpEnabled = !lambdaEnabled && settings.http && settings.http.enable,
    httpsEnabled = !lambdaEnabled && settings.https && settings.https.enable,
    filesEnabled = settings.files && settings.files.enable,
    models = all(path.resolve('./app/models')),
    middlewares = all(path.resolve('./app/middlewares')),
    controllers = all(path.resolve('./app/controllers')),
    app, server, sqs;

logMillisSinceInit('Loaded app modules');

// Add these to settings
if (process.env.DATABASE_URI) {
    settings.database.uri = process.env.DATABASE_URI;
}
settings.lambdaEnabled = lambdaEnabled;
settings.httpEnabled = httpEnabled;
settings.httpsEnabled = httpsEnabled;

//
// express and sqs setup
//
app = express();
if (httpsEnabled) {
    var credentials = {
        key: fs.readFileSync(settings.https.key),
        cert: fs.readFileSync(settings.https.cert)
    };
    server = https.createServer(credentials, app);
} else if (httpEnabled) {
    server = http.createServer(app);
} else if (lambdaEnabled) {
    server = awsServerlessExpress.createServer(app);
} else {
    throw new Error('No server enabled');
}
sqs = sqsIo(settings.sqs);

logMillisSinceInit('Loaded express and sqs-io');

if (filesEnabled) {
    if (settings.files.provider !== 's3') {
        throw new Error(settings.files.provider
            + ' is not a supported file provider');
    }
}

if (settings.env === 'production') {
    app.set('env', settings.env);
    app.set('json spaces', undefined);
    app.enable('view cache');
}

// Set compression before any routes
if (!lambdaEnabled) {
    app.use(compression({threshold: 512}));
}

//
// Called after Mongoose connects
//
function postMongooseSetup() {
    // Session
    var sessionStore = new MongoStore({
        mongooseConnection: mongoose.connection
    });
    app.use(session({
        key: 'connect.sid',
        secret: settings.secrets.cookie,
        store: sessionStore,
        cookie: {secure: httpsEnabled},
        resave: false,
        saveUninitialized: true
    }));
    logMillisSinceInit('Session setup done');

    app.use(cookieParser());

    auth.setup(app, core);
    logMillisSinceInit('Auth setup done');

    // Security protections
    app.use(helmet.frameguard());
    app.use(helmet.hidePoweredBy());
    app.use(helmet.ieNoOpen());
    app.use(helmet.noSniff());
    app.use(helmet.xssFilter());
    app.use(helmet.hsts({
        maxAge: 31536000,
        includeSubdomains: true,
        force: httpsEnabled,
        preload: true
    }));
    app.use(helmet.contentSecurityPolicy({
        defaultSrc: ['\'none\''],
        connectSrc: ['*'],
        scriptSrc: ['\'self\'', '\'unsafe-eval\''],
        styleSrc: ['\'self\'', 'fonts.googleapis.com', '\'unsafe-inline\''],
        fontSrc: ['\'self\'', 'fonts.gstatic.com'],
        mediaSrc: ['\'self\''],
        objectSrc: ['\'self\''],
        imgSrc: ['* data:']
    }));
    logMillisSinceInit('Helmet (security) setup done');

    var bundles = {};
    var connectAssetsOptions = {
        paths: [
            'media/js',
            'media/less'
        ],
        helperContext: bundles,
        build: true,
        bundle: true,
        compile: true,
        fingerprinting: true
    };
    if (settings.cdn.enabled) {
        connectAssetsOptions.servePath = settings.cdn.url + '/dist';
    } else {
        connectAssetsOptions.servePath = 'media/dist';
    }
    app.use(require('connect-assets')(connectAssetsOptions));
    logMillisSinceInit('Static assets setup done');

    // Public
    app.use('/media', express.static(__dirname + '/media', {
        maxAge: '364d'
    }));
    logMillisSinceInit('Static dir /media setup done');

    // Templates
    var nun = nunjucks.configure('templates', {
        autoescape: true,
        express: app,
        tags: {
            blockStart: '<%',
            blockEnd: '%>',
            variableStart: '<$',
            variableEnd: '$>',
            commentStart: '<#',
            commentEnd: '#>'
        }
    });

    function wrapBundler(func) {
        // This method ensures all assets paths start with "./"
        // Making them relative, and not absolute
        return function() {
            return func.apply(func, arguments)
                .replace(/href="\//g, 'href="./')
                .replace(/src="\//g, 'src="./');
        };
    }

    nun.addFilter('js', wrapBundler(bundles.js));
    nun.addFilter('css', wrapBundler(bundles.css));
    nun.addGlobal('text_search', false);
    logMillisSinceInit('Template setup done');

    // i18n
    i18n.configure({
        directory: path.resolve(__dirname, './locales'),
        locales: settings.i18n.locales || settings.i18n.locale,
        defaultLocale: settings.i18n.locale
    });
    app.use(i18n.init);

    // HTTP Middlewares
    app.use(bodyParser.json());
    app.use(bodyParser.urlencoded({
        extended: true
    }));

    // IE header
    app.use(function(req, res, next) {
        res.setHeader('X-UA-Compatible', 'IE=Edge,chrome=1');
        next();
    });

    logMillisSinceInit('i18n, HTTP middleware, IE header setup done');

    //
    // Controllers
    //
    _.each(controllers, function(controller) {
        controller.apply({
            app: app,
            sqs: sqs,
            core: core,
            settings: settings,
            middlewares: middlewares,
            models: models,
            controllers: controllers
        });
    });
    logMillisSinceInit('App controllers setup done');

    //
    // Mongoose
    //
    function checkForMongoTextSearch() {
        if (!mongoose.mongo || !mongoose.mongo.Admin) {
            // MongoDB API has changed, assume text search is enabled
            nun.addGlobal('text_search', true);
            return;
        }

        var admin = new mongoose.mongo.Admin(mongoose.connection.db);
        admin.buildInfo(function (err, info) {
            if (err || !info) {
                return;
            }

            var version = info.version.split('.');
            if (version.length < 2) {
                return;
            }

            if(version[0] < 2) {
                return;
            }

            if(version[0] === '2' && version[1] < 6) {
                return;
            }

            nun.addGlobal('text_search', true);
        });
    }
    checkForMongoTextSearch();
    logMillisSinceInit('Mongo text-search check complete');
}

//
// Run server locally
//
function runLocalApp() {
    var port = httpsEnabled && settings.https.port ||
        httpEnabled && settings.http.port;

    var host = httpsEnabled && settings.https.host ||
        httpEnabled && settings.http.host || '0.0.0.0';

    if (httpsEnabled && httpEnabled) {
        // Create an HTTP -> HTTPS redirect server
        var redirectServer = express();
        redirectServer.get('*', function(req, res) {
            var urlPort = port === 80 ? '' : ':' + port;
            res.redirect('https://' + req.hostname + urlPort + req.path);
        });
        http.createServer(redirectServer)
            .listen(settings.http.port || 5000, host);
    }

    console.log('Listening on', host, port);
    server.listen(port, host);

    // This just prints to the console
    var art = fs.readFileSync('./app/misc/art.txt', 'utf8');
    console.log('\n' + art + '\n\n' + 'Release ' + psjon.version.yellow + '\n');
}

//
// Mongo
//
function connectCB(err) {
        if (err) {
            throw err;
        }

        logMillisSinceInit('Connected to MongoDB');

        // Finish setting up the app
        postMongooseSetup();
        appIsReady = true;

        logMillisSinceInit('App ready');

        // Start listening if running locally
        if (httpEnabled || httpsEnabled) {
            runLocalApp();
        }
}
var appIsReady = false;
var isConnectedBefore = false;
var mongooseOptions = {
    useMongoClient: true,
    autoIndex: false,
    poolSize: 2
};
mongoose.connection.on('error', function() {
    console.log('Could not connect to MongoDB');
});
mongoose.connection.on('disconnected', function(){
    console.log('Lost MongoDB connection...');
    if (!isConnectedBefore) {
        mongoose.connect(settings.database.uri, mongooseOptions, connectCB);
    }
});
mongoose.connection.on('connected', function() {
    isConnectedBefore = true;
    console.log('Connection established to MongoDB');
});

mongoose.connection.on('reconnected', function() {
    console.log('Reconnected to MongoDB');
});

var tryConnectMongoTime = new Date().getTime() - appInitTime;
console.log('trying to connect to MongoDB at ' + tryConnectMongoTime + 'ms');

mongoose.connect(settings.database.uri, mongooseOptions, connectCB);

//
// Run on AWS lambda
//
if (lambdaEnabled) {
    exports.handler = function (event, context) {
        function handleLambdaRequest() {
            if (appIsReady) {
                logMillisSinceInit('Serving request');
                awsServerlessExpress.proxy(server, event, context);
            } else {
                console.log('app not ready, trying again in 100ms');
                setTimeout(handleLambdaRequest, 100);
            }
        }
        handleLambdaRequest();
    };
}
