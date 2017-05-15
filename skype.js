import db from '../../db/db.js';
import randomstring from 'randomstring';
import messageModel from '../models/message';
import config from '../../config';
import fs from 'fs';
import promisify  from 'es6-promisify';
import rest from 'request-promise-native';
import {encode, decode} from 'node-base64-image';
import string from 'string';

export default class SkypeProvider {

    static Receive(request, response) {
        let message = request.body;
        let type = message.type;
        let bot_id = request.query.bot_id;
        db.connections.findOne({ bot_id: bot_id, provider: 'skype' })
        .then((connection) => {
            if (!message && !bot_id && !(type === 'message' || type === 'contactRelationUpdate')) {
                throw new Error('Wrong data received');
            } else if (!connection) {
                throw new Error('Connection not exists');
            } else {
                return SkypeProvider.FetchMessage(connection, message);
            }
        }).then(() => {
            response.json({
                status: true
            });
        }).catch((error) => {
            response.json({
                status: false,
                error: error.message
            });
        });
    }

    static Send(client, message) {
        return new Promise((resolve, reject) => {
            db.connections.findOne({bot_id: client.bot_id, provider: client.provider})
            .then((connection) => {
                if (!connection || !connection.provider_data) {
                    reject (new Error ('No connection available to send message'));
                } else {
                    return SkypeProvider.SendMessage(client, message, connection);
                }
            }).then(() => {
                return db.messages.update({ _id: message._id}, { $set: { status: 'sent' } });
            }).then(() => {
                resolve(true);
            }).catch((error) =>{
                reject(new Error('Unable to send message to Skype'));
            });
        });
    }

    static Connect(request, response, connection) {
        db.connections.findOne({ provider: 'skype', 'provider_data.client_id': connection.provider_data.client_id, bot_id: { $ne: connection.bot_id } }, (error, conn) => {
            if (error) {
                response.json({
                    status: false,
                    error: error.message
                });
            } else if (conn) {
                response.json({
                    status: false,
                    error: 'This Skype account already connected to other bot'
                });
            } else {
                db.connections.findOneAndUpdate({ bot_id: connection.bot_id, provider: 'skype' }, connection, { upsert: true }, (error) => {
                    if (error) {
                        response.json({
                            status: false,
                            error: error.message
                        });
                    } else {
                        response.json({
                            status: true
                        });
                    }
                });
            }
        });
    }

    static FetchMessage(connection, message) {
        return new Promise((resolve, reject) => {
            db.clients.findOne({ bot_id: connection.bot_id, provider: connection.provider, 'provider_data.user_id': message.from.id })
            .then((client) => {
                if (!client) {
                    let id = randomstring.generate({
                        length: 15,
                        charset: 'alphanumeric',
                        capitalization: 'uppercase'
                    });
                    let client = {
                        client_id: id,
                        bot_id: connection.bot_id,
                        account_id: connection.account_id,
                        provider: connection.provider,
                        name: message.from.name,
                        provider_data: {
                            user_id: message.from.id,
                            conversation_id: message.conversation.id
                        }
                    };
                    return db.clients.create(client)
                    .then((client) =>{
                        return client;
                    }).catch((error) => {
                        reject(error);
                    });
                } else {
                    return client;
                }
            }).then((client) => {
                return SkypeProvider.SaveMessage(connection, client, message);
            }).then(() => {
                resolve(true);
            }).catch((error) => {
                reject(error);
            });
        });
    }

    static Disconnect(connection) {
        return new Promise((resolve, reject) => {
            resolve(true);
        });
    }

    static SendMessage(client, message, connection) {
        return new Promise((resolve, reject) =>{
            var promise;
            if(message.type === 'text') {
                let bodyContent = {
                    type : 'message/text',
                    text: message.content.text
                };
                promise = SkypeProvider.SendRequest(connection, client, bodyContent);
            } else if (message.type === 'image') {
                let imgEncode = promisify(encode);
                imgEncode(message.content.url, {string: true})
                .then((image)=> {
                    let bodyContent = {
                        type : 'message/image',
                        attachments:[{contentUrl: 'data:image/jpeg;base64,'+ image}]
                    };
                    return SkypeProvider.SendRequest(connection, client, bodyContent);
                }).then(()=>{
                    resolve(true);
                }).catch((error)=>{
                    reject(error);
                });
            } else if (message.type === 'audio' || message.type === 'video') {
                let bodyContent = {
                    type : 'message/card',
                    attachments:[{
                        autoloop: false,
                        contentType: (message.type === 'video') ? 'application/vnd.microsoft.card.video' : 'application/vnd.microsoft.card.audio',
                        content:{
                            image: {
                                url: (message.type === 'video') ? config.host + '/img/default-video-preview.png' : config.host + '/img/default-audio-preview.png'
                            },
                            media:[
                                {
                                    profile: (message.type === 'video') ? 'hd' : 'audio',
                                    url: message.content.url
                                }
                            ]
                        }
                    }]
                };
                promise = SkypeProvider.SendRequest(connection, client, bodyContent);
            } else if (message.type === 'suggest') {
                let buttons =[];
                let content = {};
                let messageButtons = message.content.buttons;
                for (let i = 0; i < messageButtons.length; i++) {
                    let messageButton = messageButtons[i];
                    buttons.push({
                        title: messageButton.title,
                        value: messageButton.content,
                        type: 'imBack'
                    });
                }
                content.buttons = buttons;
                if (messageButtons.length < 6) {
                    content.text = message.content.text;
                } else {
                    content.title = message.content.text;
                }
                let bodyContent = {
                    type : 'message/card',
                    attachments: [
                        {
                            contentType: 'application/vnd.microsoft.card.hero',
                            content: content
                        }
                    ]
                };
                promise = SkypeProvider.SendRequest(connection, client, bodyContent);
            } else if (message.type === 'card') {
                let elements = message.content.elements;
                let attachments = [];
                let limit = (elements.length > 10) ? 10 : elements.length;
                for (let i = 0; i < limit; i++) {
                    let element = elements[i];
                    let buttons =[];
                    let messageButtons = element.buttons;
                    for (let j = 0; j < messageButtons.length; j++) {
                        let messageButton = messageButtons[j];
                        buttons.push({
                            title: messageButton.title,
                            type: (messageButton.type === 'link') ? 'openUrl' : 'imBack',
                            value: (messageButton.type === 'link') ? messageButton.url : messageButton.content
                        });
                    }
                    attachments.push({
                        contentType: 'application/vnd.microsoft.card.hero',
                        content: {
                            title: element.title,
                            subtitle: element.text,
                            images: [{ url: element.image }],
                            buttons: buttons
                        }
                    });
                }
                let bodyContent = {
                    type: 'message/card.carousel',
                    attachments: attachments
                };
                promise = SkypeProvider.SendRequest(connection, client, bodyContent);
            } else {
                resolve(new Error('Unknown message type'));
            }
            if(promise){
                promise.then(() => {
                    resolve(true);
                }).catch((error) => {
                    reject(error);
                });
            }
        });
    }

    static GetAccess(connection) {
        return new Promise ((resolve, reject) =>{
            const options = {
                method: 'POST',
                uri: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
                form:{
                    grant_type: 'client_credentials',
                    client_id: connection.provider_data.client_id,
                    client_secret: connection.provider_data.secret,
                    scope: 'https://graph.microsoft.com/.default'
                },
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Host': 'login.microsoftonline.com'
                },
                json: true
            };
            rest(options).then((token)=>{
                resolve(token.access_token);
            }).catch((error) =>{
                reject(error);
            });
        });
    }

    static SendRequest(connection, client, bodyContent){
        return new Promise((resolve, reject) => {
            SkypeProvider.GetAccess(connection)
            .then((token) => {
                let conversation_id = client.provider_data.conversation_id;
                let url = 'https://apis.skype.com/v3/conversations/' + conversation_id + '/activities';
                return rest({
                    method: 'POST',
                    uri: url,
                    headers: {
                        'Authorization': 'Bearer ' + token
                    },
                    body: bodyContent,
                    json: true
                });
            }).then(() => {
                resolve(true);
            }).catch((error) => { 
                reject(error);
            });
        });
    }

    static SaveMessage(connection, client, message) {
        return new Promise((resolve, reject) => {
            let content;
            let attachments = message.attachments;
            if (message.text || (message.type === 'contactRelationUpdate' && message.action === 'add')) {
                let text = (message.text) ? string(message.text).stripTags().s : null;
                content = {
                    text: text || 'start'
                };
                messageModel.Save(client, 'text', content, 'client')
                 .then(() => {
                    resolve(true);
                }).catch((error) => {
                    reject(error);
                });
            } else if (message.attachments) {
                var rows = [];
                for (let i = 0; i < attachments.length; i++) {
                    let attachment = attachments[i];
                    rows.push(SkypeProvider.GetContent(client, attachment, message, connection));
                }
                Promise.all(rows).then(() => {
                    resolve(true);
                }).catch((error) => {
                    reject(error);
                });
            } else {
                reject(new Error('Unknown message type'));
            }
        });
    }

    static GetContent(client, attachment, message, connection) {
        return new Promise((resolve, reject) => {
            if (attachment.contentType === 'image') {
                let imgType = attachment.contentType;
                SkypeProvider.GetAccess(connection)
                .then((token) =>{
                    let contentUrl = attachment.contentUrl;
                    return rest({
                        url: contentUrl,
                        headers: {
                            'Authorization': 'Bearer ' + token,
                            'Content-Type': imgType,
                        },
                        encoding: null
                    });
                }).then((body) => {
                    let ext = (imgType === 'image') ? '.jpeg' : '';
                    let path_part = (imgType === 'image') ? 'img/messages' : '';
                    let attachment_url = config.host + config.upload_url + path_part;
                    let dir_path = config.upload_path + '/' + path_part + '/' + message.id + ext;
                    let writeStream = fs.createWriteStream(dir_path);
                    writeStream.write(body);
                    writeStream.end(() => {
                        return messageModel.Save(client,'image', {url: attachment_url + '/' + message.id + ext}, 'client');
                    });
                    writeStream.on('error', (error) =>{
                        resolve(true);
                    });
                }).then(() => {
                    resolve(true);
                }).catch((error) => { 
                    reject(error); 
                });
            } else {
                resolve(true);
            }
        });
    }
}