'use strict';

var EventEmitter = require('events').EventEmitter,
    util = require('util'),
    _ = require('lodash'),
    AccountManager = require('./account'),
    AvatarCache = require('./avatar-cache'),
    FileManager = require('./files'),
    MessageManager = require('./messages'),
    PresenceManager = require('./presence'),
    RoomManager = require('./rooms'),
    UserManager = require('./users'),
    UserMessageManager = require('./usermessages');

function Core() {
    EventEmitter.call(this);

    this.account = new AccountManager({
        core: this
    });

    this.files = new FileManager({
        core: this
    });

    this.messages = new MessageManager({
        core: this
    });

    this.presence = new PresenceManager({
        core: this
    });

    this.rooms = new RoomManager({
        core: this
    });

    this.users = new UserManager({
        core: this
    });

    this.usermessages = new UserMessageManager({
        core: this
    });

    this.avatars = new AvatarCache({
        core: this
    });
}

util.inherits(Core, EventEmitter);

module.exports = new Core();
