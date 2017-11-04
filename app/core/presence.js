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

function join(data, sqs, cb) {
    var User = mongoose.model('User');
    User.findById(data.userId, function (err, user) {
        var promise = null;
        if (!err && user) {
            user = user.toJSON();
            user.room = data.roomId;
            if (data.roomHasPassword) {
                promise = sqs.to(data.roomId).emit('users:join', user);
            } else {
                promise = sqs.emit('users:join', user);
            }
        }
        sqs.wait(promise, cb);
    });
};

PresenceManager.prototype.join = function(user, room, sqs, cb) {
    var data = {
        userId: user._id,
        username: user.username,
        roomId: room._id,
        roomSlug: room.slug,
        roomHasPassword: typeof room.password !== 'undefined'
    };
    join(data, sqs, cb);
};

function leave(data, sqs, cb) {
    var User = mongoose.model('User');
    User.findById(data.userId, function (err, user) {
        var promise = null;
        if (!err && user) {
            user = user.toJSON();
            user.room = data.roomId;
            if (data.roomHasPassword) {
                promise = sqs.to(data.roomId).emit('users:leave', user);
            } else {
                promise = sqs.emit('users:leave', user);
            }
        }
        sqs.wait(promise, cb);
    });
}

PresenceManager.prototype.leave = function(user, room, sqs, cb) {
    var data = {
        userId: user._id,
        username: user.username,
        roomId: room._id,
        roomSlug: room.slug,
        roomHasPassword: typeof room.password !== 'undefined'
    };
    leave(data, sqs, cb);
};

PresenceManager.prototype.usernameChanged = function(user, data, sqs, cb) {
    var rooms = user.rooms;
    var opsToWaitFor = rooms.length * 2;
    rooms.map(function(room) {
        leave({
            userId: user._id,
            username: data.oldUsername,
            roomId: room._id,
            roomSlug: room.slug,
            roomHasPassword: typeof room.password !== 'undefined'
        }, sqs, function () {
            opsToWaitFor--;
            if (opsToWaitFor <= 0) {
                cb();
            }
        });
        join({
            userId: user._id,
            username: data.username,
            roomId: room._id,
            roomSlug: room.slug,
            roomHasPassword: typeof room.password !== 'undefined'
        }, sqs, function () {
            opsToWaitFor--;
            if (opsToWaitFor <= 0) {
                cb();
            }
        });
    });
};

module.exports = PresenceManager;
