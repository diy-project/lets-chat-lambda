'use strict';

var mongoose = require('mongoose');

function PresenceManager(options) {
    this.core = options.core;
    this.getUserCountForRoom = this.getUserCountForRoom.bind(this);
    this.getUsersForRoom = this.getUsersForRoom.bind(this);
}

PresenceManager.prototype.getUserCountForRoom = function(roomId, cb) {
    var Room = mongoose.model('Room');
    Room.findByIdOrSlug(roomId, function(room) {
        cb(room.participants.length);
    });
};

PresenceManager.prototype.getUsersForRoom = function(roomId, cb) {
    var Room = mongoose.model('Room');
    Room.findByIdOrSlug(roomId, function (room) {
        cb(room.participants);
    });
};

PresenceManager.prototype.connect = function(connection) {
    throw new Exception('Not supported');
};

PresenceManager.prototype.disconnect = function(connection) {
    throw new Exception('Not supported');
};

PresenceManager.prototype.join = function(user, room) {
    return {
        userId: user._id,
        username: user.username,
        roomId: room._id,
        roomSlug: room.slug,
        roomHasPassword: typeof room.password !== 'undefined'
    };
};

PresenceManager.prototype.leave = function(user, room) {
    return {
        userId: user._id,
        username: user.username,
        roomId: room._id,
        roomSlug: room.slug,
        roomHasPassword: typeof room.password !== 'undefined'
    };
};

PresenceManager.prototype.usernameChanged = function(rooms, data) {
    var that = this;
    rooms.forEach(function(room) {
        that.onLeave({
            userId: user._id,
            username: data.oldUsername,
            roomId: room._id,
            roomSlug: room.slug,
            roomHasPassword: typeof room.password !== 'undefined'
        });
        that.onJoin({
            userId: user._id,
            username: data.username,
            roomId: room._id,
            roomSlug: room.slug,
            roomHasPassword: typeof room.password !== 'undefined'
        });
    });
};

PresenceManager.prototype.onJoin = function(data) {
    this.core.emit('presence:user_join', data);
};

PresenceManager.prototype.onLeave = function(data) {
    this.core.emit('presence:user_leave', data);
};

module.exports = PresenceManager;
