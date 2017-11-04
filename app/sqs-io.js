//
// SQS IO events
//

'use strict';

var AWS = require('aws-sdk');

module.exports = function (settings) {
    return new SqsIo(settings);
};

function SqsIo(settings) {
    this.queuePrefix = settings.queuePrefix;
    this.messageRetentionPeriod = settings.messageRetentionPeriod;
    this.longPollingPeriod = settings.longPollingPeriod;
    this.region = settings.credentials.region;
    this.sqsApi = new AWS.SQS({
        accessKeyId: settings.credentials.accessKeyId,
        secretAccessKey: settings.credentials.secretAccessKey,
        region: settings.credentials.region,
        sslEnabled: true
    });
    this.clientMasterCredentials = new AWS.Credentials(
        settings.credentials.accessKeyId,
        settings.credentials.secretAccessKey
    );
    this.tempClientCredentials = new AWS.TemporaryCredentials(
        {DurationSeconds: 3600},
        this.clientMasterCredentials
    );
}

SqsIo.prototype.listQueues = function(cb) {
    var params = {QueueNamePrefix: this.queuePrefix};
    this.sqsApi.listQueues(params, function(err, data) {
        if (err) {
            console.log(err, err.stack);
        } else {
            cb(data.QueueUrls ? data.QueueUrls : []);
        }
    });
};

SqsIo.prototype.createQueue = function(userId, cb) {
    var params = {
        QueueName: this.queuePrefix + '_' + userId,
        Attributes: {
            'MessageRetentionPeriod': this.messageRetentionPeriod.toString(),
            'ReceiveMessageWaitTimeSeconds': this.longPollingPeriod.toString()
        }
    };
    this.sqsApi.createQueue(params, function (err, data) {
        if (err) {
            if (err.code !== 'AWS.SimpleQueueService.QueueDeletedRecently') {
                console.log('Error', err);
            }
        } else {
            console.log('Created queue:', data.QueueUrl);
        }
        if (cb) {
            cb(err);
        }
    });
};

SqsIo.prototype.deleteQueue = function(userId) {
    var that = this;
    this.getUrl(userId, function(url) {
        var params = {QueueUrl: url};
        that.sqsApi.deleteQueue(params, function (err, data) {
            if (err) {
                console.log('Error', err);
            } else {
                console.log('Deleted queue:', data);
            }
        });
    });
};

SqsIo.prototype.getUrl = function(userId, cb) {
    var params = {
        QueueName: this.queuePrefix + '_' + userId
    };
    this.sqsApi.getQueueUrl(params, function(err, queueData) {
        if (err) {
            console.log('Error', err);
        } else {
            cb(queueData.QueueUrl);
        }
    });
};

SqsIo.prototype.getTemporaryCredentials = function(cb) {
    // Refresh the credentials now that someone has requested them
    var that = this;
    this.tempClientCredentials.refresh(function(err) {
        if (err) {
            console.log('Error', err);
        } else {
            var temp = that.tempClientCredentials;
            cb({
                accessKeyId: temp.accessKeyId,
                secretAccessKey: temp.secretAccessKey,
                sessionToken: temp.sessionToken,
                expireTime: temp.expireTime,
                region: that.region
            });
        }
    });
};

// Unicast to a user's queue
SqsIo.prototype.queue = function(userId) {
    var that = this;
    return {
        emit: function(event, messageData) {
            that.getUrl(userId, function (url) {
                return that._emit({
                    url: url,
                    event: event,
                    data: messageData
                });
            })
        },
        to: function (room) {
            throw new Error('Rooms for unicast are not implemented');
        }
    };
};

// Broadcast to a room
SqsIo.prototype.to = function(room) {
    var that = this;
    var roomName = room.toString();
    return {
        emit: function(event, data) {
            return that._emit({
                room: roomName,
                event: event,
                data: data
            });
        }
    };
};

// Broadcast
SqsIo.prototype.emit = function(event, data) {
    return this._emit({
        event: event,
        data: data
    });
};

// Internal emit method
SqsIo.prototype._emit = function(params) {
    var that = this;
    var promise = {
        _done: false,
        isDone: function () {
            return this._done;
        }
    };
    var messageAttributes = {
        'Event': {
            DataType: 'String',
            StringValue: params.event
        }
    };
    if (params.room) {
        messageAttributes['Room'] = {
            DataType: 'String',
            StringValue: params.room
        };
    }
    var message = {
        MessageAttributes: messageAttributes,
        MessageBody: JSON.stringify(params.data)
    };
    if (params.url) {
        // Unicast
        message.QueueUrl = params.url;
        that.sqsApi.sendMessage(message, function (err, data) {
            if (err) {
                console.error(err);
            } else {
                console.log('Sent', data.MessageId, 'to', url);
            }
            promise.done = true;
        });
    } else {
        // Broadcast
        that.listQueues(function (queueUrls) {
            var numToSend = queueUrls.length;
            queueUrls.forEach(function (url) {
                var messageCopy = Object.assign({}, message);
                messageCopy.QueueUrl = url;
                that.sqsApi.sendMessage(messageCopy, function (err, data) {
                    if (err) {
                        console.error(err);
                    } else {
                        console.log('Sent', data.MessageId, 'to', url);
                    }
                    numToSend -= 1;
                    if (numToSend <= 0) {
                        promise._done = true;
                    }
                });
            })
        });
    }
    return promise;
};

SqsIo.prototype.wait = function(promises, cb) {
    function waitForDone() {
        var isDone;
        if (promises === null) {
            isDone = true;
        } else if (promises instanceof Array) {
            isDone = promises.every(function(promise) {
                return promise.isDone();
            });
        } else {
            isDone = promises.isDone();
        }
        if (isDone) {
            cb();
        } else {
            setTimeout(waitForDone, 50);
        }
    }
    waitForDone();
};
