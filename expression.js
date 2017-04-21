import db from '../../db/db.js';
import randomstring from 'randomstring';
import intentModel from '../models/intent';
import botModel from '../models/bot';

export default class ExpressionController {

    static List(request, response) {
        const limit = parseInt(request.query.limit) || 30;
        const offset = parseInt(request.query.offset) || 0;
        const match  = {bot_id: request.bot.bot_id};
        var expressions = [];
        var intentsNames = {};
        var entitiesNames = {};
        var result = [];

        if(request.query.matched){
            match.matched = request.query.matched == 'false' ? false : true;
        }
        
        match.status = ['new', 'processed'].indexOf(request.query.status) >= 0 ? request.query.status : 'new';
        db.expressions.find(match).sort({created_at: -1}).skip(offset).limit(limit)
        .then((resources) => {
            expressions = resources;
            let ids = expressions.reduce((ids, expression) => {
                if(expression.intent){
                    ids.push(expression.intent);
                }
                return ids;
            }, []);
            return (ids.length) ? db.intents.find({intent_id: {"$in": ids}}) : []; 
        }).then((resources) => {
            for(let intent of resources){
                intentsNames[intent.intent_id] = intent.name;
            }
            let ids = expressions.reduce((ids, expression) => {
                for(let entity of expression.entities){
                    ids.push(entity.entity_id);
                }
                return ids;
            }, []);
            return (ids.length) ? db.entities.find({entity_id: {"$in": ids}}) : [];
        }).then((resources) => {
            for(let entity of resources){
                entitiesNames[entity.entity_id] = entity.name;
            }             
            for(let expression of expressions){
                let intent = expression.intent ? {intent_id: expression.intent, name: intentsNames[expression.intent] || null, match: expression.confidence} : null;
                let entities = expression.entities.map((entity) => {
                    entity.name = entitiesNames[entity.entity_id];
                    return entity;
                });
                let item = {
                    expression_id: expression.expression_id,
                    text: expression.text,
                    entities: entities,
                    matched: expression.matched,
                    intent: intent                    
                }
                result.push(item);
            }
            response.json({
                status: true,
                expressions: result
            });
        }).catch((error) => {
            response.status(400).json({
                status: false,
                error: error.message
            });
        });
    }

    static Match(request, response) {
        var intent_id,
            expression_id = request.params.expression_id,
            expression    = {};
        db.expressions.findOne({expression_id: expression_id})
        .then((res) => {
            if(!res) {
                throw new Error("Expression not found");
            } else {
                expression = res;
                return botModel.CheckAccess(res.bot_id, request.account.account_id, request.account.role);
            }
        }).then((res) => {
            if(request.body.intent_id){
                intent_id = request.body.intent_id;
                return intent_id;
            } else if(request.body.name){
                intent_id = randomstring.generate({length: 10, charset: 'alphanumeric', capitalization: 'uppercase'});
                let intent = {
                    intent_id: intent_id,
                    bot_id: expression.bot_id,
                    name: request.body.name,
                    scenario_id: null,
                    expressions: [expression]
                };
                return db.intents.create(intent);
            } else {
                throw new Error("Intent not define");
            }
        }).then((res) => {
            return intentModel.InsertExpression(intent_id, expression.text);
        }).then((res) => {
            return db.expressions.update({expression_id: expression_id}, {$set: {status: 'processed', intent: intent_id}});
        }).then((res) => {
            response.json({
                status: true
            });
        }).catch((error) => {
            response.status(error.status || 400).json({
                status: false,
                error: error.message
            });
        });
    }

    static Accept(request, response) {
        var expression_id = request.params.expression_id;
        db.expressions.findOne({expression_id: expression_id})
        .then((res) => {
            if(!res) {
                throw new Error("Expression not found");
            } else {
                return botModel.CheckAccess(res.bot_id, request.account.account_id, request.account.role);
            }
        }).then((res) => {
            return db.expressions.update({expression_id: expression_id}, {$set: {status: 'processed'}});
        }).then((res) => {
            response.json({
                status: true
            });
        }).catch((error) => {
            response.status(error.status || 400).json({
                status: false,
                error: error.message
            });
        });
    }

    static Delete(request, response) {
        var expression_id = request.params.expression_id;
        db.expressions.findOne({expression_id: expression_id})
        .then((res) => {
            if(!res) {
                throw new Error("Expression not found");
            } else {
                return botModel.CheckAccess(res.bot_id, request.account.account_id, request.account.role);
            }
        }).then((res) => {
            return db.expressions.remove({expression_id: expression_id});
        }).then((res) => {
            response.json({
                status: true
            });
        }).catch((error) => {
            response.status(error.status || 400).json({
                status: false,
                error: error.message
            });
        });
    }

}