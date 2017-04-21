import db from '../../db/db.js';
import randomstring from 'randomstring';
import config from '../../config';
import path from 'path';
import uploadFile from '../helpers/upload';
import fs from 'fs';
import {Facebook, FacebookApiException} from 'fb';
import pluralize from 'pluralize';
import moment from 'moment';
import string from 'string';

export default class FacebookSource {

    static initFacebook() {
        let access_token = config.fb_app + "|" + config.fb_secret;
        let fb = new Facebook();
        fb.setAccessToken(access_token);
        return fb;
    }

    static GetUrl(data, type) {
        var fields  = {
            posts:  "?fields=message,name,full_picture,description,created_time,id",
            photos: "?fields=name,images,description,created_time,id",
            videos: "?fields=title,picture,description,created_time,id",
            events: "?fields=title,cover,description,start_time,end_time,category,id"
        }
        var request = data.id + '/' + type,
            options = (type != 'events') ? '&type=uploaded' : '';
        options += (data.last_update) ? '&since='+ data.last_update : '&limit=' + (data.initial_fetch || 10);
        return  request + fields[type] + options;
    }

    static Process(data, type, collection_id) {
        return new Promise((resolve, reject) => {
            const file_path = path.join(config.upload_path, 'img/messages/');
            const created = data.created_time ? new Date(data.created_time) : new Date();
            let uri = '';                
            let fields = {
                link: 'https://www.facebook.com/' + data.id,
                type: pluralize.singular(type)
            }
            switch(type){
                case 'posts':
                    fields.description = data.message || data.name || 'Not set';
                    fields.title = data.name || fields.description;
                    uri = data.full_picture;
                    break;
                case 'photos':
                    fields.description = data.name || moment(created).format("dddd, MMMM Do YYYY, HH:mm");
                    fields.title = fields.description;
                    uri = data.images[0].source;
                    break;
                case 'videos':
                    fields.description = data.description || data.title || 'Not set';
                    fields.title = data.title || fields.description;
                    uri = data.picture;
                    break;
                case 'events':
                    fields.title = data.name || data.description;
                    let start = data.start_time ? 'Start time: ' + moment(new Date(data.start_time)).format("dddd, MMMM Do YYYY, HH:mm") + '. ' : '';
                    fields.description = start + data.description;
                    uri = data.cover.source;
                    break;
            }
            uploadFile.Fetch(uri, file_path)
            .then((filename) => {
                if(filename){
                    fields.picture = config.host + config.upload_url + 'img/messages/' + filename;
                    fields.title = string(fields.title).truncate(80).s;
                    var item = {
                        item_id: randomstring.generate({length: 10, charset: 'alphanumeric', capitalization: 'uppercase'}),
                        collection_id: collection_id,
                        created_at: created,
                        published: true,
                        fields: fields
                    };
                    return db.items.create(item);
                } else {
                    return true;
                }
            }).then(() => {
                return db.collections.update({collection_id: collection_id}, {$set: {"source_data.last_update": new Date().toISOString()}});
            }).then((result) => {
                resolve(true);
            }).catch((error)=>{
                reject(error);
            });
        });
    }

    static Fetch(collection) {
        return new Promise((resolve, reject) => {
            const data = collection.source_data;
            const promises = [];
            const batch = [];
            for(let type of data.types){
                batch.push({method: 'get', relative_url: FacebookSource.GetUrl(data, type)});
            }
            let fb = FacebookSource.initFacebook();
            fb.api('', 'post', {batch: batch}, (results) => {
                for(let i = 0; i < results.length; i++){
                    if(!results[i] || results[i].error) {
                        continue;
                    } else { 
                        try {
                            var body = JSON.parse(results[i].body)
                            if(!body.data || !body.data.length){
                                continue;
                            } else {
                                body.data.forEach((item) => {
                                    promises.push(FacebookSource.Process(item, data.types[i], collection.collection_id));
                                });
                            }
                        } catch(e){
                            continue;
                        }
                    }
                }
            });
            Promise.all(promises)
            .then((result) => {
                resolve(true);
            }).catch((error)=>{
                reject(error);
            });
        });
    }

    static ValidateData(data){
        return new Promise( (resolve, reject) => {
            var regexps = [
                /(\d{9,})/,
                /^(?:https:\/\/)?www.facebook.com\/(?:pg\/)?(\S+)(?:\/\S*)?$/,
                /(\S+)/
            ];
            var result = [];
            var url = '';

            for(let regexp of regexps){
                result = regexp.exec(data.url);
                if(result){
                    url = result[1];
                    break;
                }
            }
            if(url){
                let fb = FacebookSource.initFacebook();
                fb.api(url, (res) => {
                    if(!res || res.error) {
                        reject(res.error);
                    } else if(res.id === undefined) {
                        reject(new Error("Bad request"));
                    } else {
                        data.id = res.id;
                        data.url = 'www.facebook.com/' + url;
                        if(!data.types || !data.types.length){
                            data.types = (data.type && data.type !== 'all') ? [data.type] : ['posts', 'photos', 'videos', 'events'];
                        }
                        resolve(true);
                    }
                });
            } else {
                reject(new Error("Bad url"));
            }
        });
    }

    static Fields(type) {
        return [{title: "Type", name : "type", type : "text"}];
    }
}