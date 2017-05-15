import db from '../../db/db.js';
import randomstring from 'randomstring';
import sources from '../sources/index.js';
import ResponseError from '../helpers/response-error';
import botModel from '../models/bot';
import collectionModel from '../models/collection';

export default class CollectionController {

    static List(request, response) {
        db.collections.find({bot_id: request.params.bot_id}, function (error, resources) {
            if(error){
                response.status(400).json({
                    status: false,
                    error: error.message
                });
            } else {
                var collections = [];
                for(var index in resources){
                    let collection = resources[index];
                    collections.push({
                        collection_id: collection.collection_id,
                        name: collection.name,
                        source: collection.source,
                        source_data: collection.source_data,
                        fields: collection.fields
                    });
                }
                response.json({
                    status: true,
                    collections: collections
                });
            }
        });
    }

    static View(request, response) {
        var collection;
        db.collections.findOne({collection_id: request.params.collection_id})
        .then((res) => {
            if (res) {
                collection = res;
                //Need to add check bot access method when collections will be protected by account access token
                return true;
            } else {
                throw new ResponseError("Collection not found", 404);
            }
        }).then((res) => {
            response.json({
                status: true,
                collection_id: collection.collection_id,
                bot_id: collection.bot_id,
                name: collection.name,
                source: collection.source,
                source_data: collection.source_data,
                fields: collection.fields
            });
        }).catch((error) => {
            response.status(error.status || 400).json({
                status: false,
                error: error.message
            });
        });
    }

    static Create(request, response) {
        var data = request.body, 
            collection = {};

        db.collections.findOne({name: data.name, bot_id: data.bot_id})
        .then((res) => {
            if(res) {
                throw new Error("Collection with such name already exists");
            } else {
                collection = {
                    bot_id: data.bot_id,
                    name: data.name,
                    source: data.source || 'manual',
                    source_data: data.source_data || {},
                    fields: data.fields
                };
                return collectionModel.Create(collection);
            }
        }).then((result) => {
            response.json({
                status: true,
                collection_id: collection.collection_id
            });
        }).catch((error) => {
            response.status(400).json({
                status: false,
                error: error.message
            });
        });
    }

    static Update(request, response) {
        var data = request.body,
            collection = {},
            collection_id = request.params.collection_id;

        db.collections.findOne({name: data.name, bot_id: data.bot_id, collection_id: {$ne: collection_id}})
        .then((res) => {
            if(res) {
                throw new Error("Collection with such name already exists");
            } else {
                return db.collections.findOne({collection_id: collection_id});
            }
        }).then((current) => {
            if(current){
                collection = {
                    collection_id: collection_id,
                    name: data.name,
                    bot_id: current.bot_id,
                    source: current.source,
                    source_data: data.source_data,
                    fields: data.fields
                }
                return collectionModel.CheckSource(collection);
            } else {
                throw new Error("Channel not found");
            }           
        }).then((result) => {
            return db.collections.update(
                {collection_id: collection_id}, 
                {$set: {
                    name: collection.name,
                    source_data: collection.source_data,
                    fields: collection.fields
                }
            });
        }).then((result) => {
            response.json({
                status: true
            });
        }).catch((error) => {
            response.status(400).json({
                status: false,
                error: error.message
            });
        });        
    }

    static Delete(request, response) {
        var collection_id = request.params.collection_id;
        db.collections.findOne({collection_id: collection_id})
        .then((collection) => {
            if(!collection){
                throw new Error('Collection not found');
            } else {
                if(collection.source != 'manual'){
                    collection.source_data.active = false;
                }     
                return collectionModel.CheckJob(collection);
            }
        }).then((result) => {
            return db.items.remove({collection_id: collection_id});
        }).then((result) => {
            return db.collections.remove({collection_id: collection_id, bot_id: request.params.bot_id});
        }).then((result) => {
            response.json({
                status: true
            });
        }).catch((error) => {
            response.status(400).json({
                status: false,
                error: error.message
            });
        });
    }
}