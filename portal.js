import db from '../../db/db.js';
import fs from 'fs';
import path from 'path';
import config from '../../config';
import randomstring from 'randomstring';
import uploadFile from '../helpers/upload';
import ResponseError from '../helpers/response-error';

export default class PortalController {

    static List(request, response) {
        db.portals.find()
        .then((resources) => {
            var portals = [];
            for(var portal of resources){
                portals.push(PortalController.FormPortal(portal));
            }
            response.json({
                status: true,
                portals: portals
            });
        }).catch((error) => {
            response.status(error.status || 400).json({
                status: false,
                error: error.message
            });
        });
    }

    static GetDefault() {
        return new Promise((resolve, reject) => {
            db.portals.findOne({default: true})
            .then((portal) => {
                if (!portal) {
                    reject("Default Portal not found");
                } else{
                    resolve(portal);
                }
            }).catch((error) => {
                reject(error.message);
            });
        });
    }

    static View(request, response) {
        var match = {};
        var find_by_id = false;
        if(request.query.portal_id){
            match.portal_id = request.query.portal_id;
            find_by_id = true;
        }
        if(request.query.domain){
            let domain = request.query.domain;
            let regexp = /^www\./;
            let result = regexp.exec(domain);
            let alt_domain = result ? domain.replace(regexp, '') : 'www.' + domain;
            match = {$or:[{domain: domain}, {domain: alt_domain}]};
        }
        if(Object.keys(match).length === 0){
            response.status(400).json({
                status: false,
                error: "Request parameter not found"
            });
        } else {
            db.portals.findOne(match)
            .then((portal) => {
                if (!portal) {
                    if(find_by_id){
                        throw new ResponseError("Portal not found", 404);
                    } else {
                        return PortalController.GetDefault();
                    }
                } else{
                    return portal;
                }
            }).then((portal) => {
                response.json({
                    status: true,
                    portal: PortalController.FormPortal(portal)
                });
            }).catch((error) => {
                response.status(error.status || 400).json({
                    status: false,
                    error: error.message
                });
            });
        }
    }

    static FormPortal(portal){
        const folder          =  'img/portals',
              image_url       =  config.host + config.upload_url + folder,
              default_logo    =  config.host + '/img/default-portal-logo.png',
              default_favicon =  config.host + '/img/default-portal-favicon.ico';
        return {
            portal_id: portal.portal_id,
            name: portal.name,
            domain: portal.domain,
            url: portal.url,
            title: portal.title,
            environment: portal.environment,
            default: portal.default,
            logo: portal.logo ? image_url + '/' + portal.logo : default_logo,
            favicon: portal.favicon ? image_url + '/' + portal.favicon : default_favicon
        }
    }

    static Create(request, response) {
        var data = request.body, 
            portal = {};
        db.portals.findOne({$or:[{'name': data.name}, {'domain': data.domain}, {'url': data.url}]})
        .then((res) => {
            if(res) {
                throw new ResponseError("Portal with such parameters already exists", 400);
            } else {
                portal = {
                    domain: data.domain,
                    name: data.name,
                    url: data.url,
                    title: data.title,
                    environment: data.environment,
                    default: data.default,
                    logo: data.logo,
                    favicon: data.favicon,
                    portal_id: randomstring.generate({length: 10, charset: 'alphanumeric', capitalization: 'uppercase'})
                };
                return db.portals.create(portal);
            }
        }).then((result) => {
            response.json({
                status: true,
                portal_id: portal.portal_id
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
            portal = {},
            portal_id = request.params.portal_id;
        db.portals.findOne({portal_id: portal_id})
        .then((res) => {
            if(!res){
                throw new ResponseError("Portal not found", 404);
            } else {
                portal = {
                    name: data.name,
                    domain: data.domain,
                    url: data.url,
                    title: data.title,
                    environment: data.environment,
                    default: data.default
                }
                for(let field of ['logo', 'favicon']){
                    if(data[field]){
                        portal[field] = data[field];
                    }
                }
                return db.portals.update({portal_id: portal_id}, {$set: portal});
            }
        }).then((result) => {
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
        var portal_id = request.params.portal_id;
        db.portals.findOne({portal_id: portal_id})
        .then((portal) => {
            if(!portal){
                throw new ResponseError("Portal not found", 404);
            } else if(portal.default){
                throw new ResponseError("Can not delete default Portal", 400);
            } else {
                return db.portals.remove({portal_id: portal_id});
            }
        }).then((result) => {
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

    static SetImage(request, response) {
        const allowed_types   =  'jpg|jpeg|png|ico|svg',
              folder          =  'img/portals',
              image_url       =  config.host + config.upload_url + folder;
        try {
            var old_image     = '',
                image         = '',
                storage_path  = path.join(config.upload_path, folder),
                portal_id     = request.params.portal_id,
                image_type    = request.query.type || 'logo';

            db.portals.findOne({portal_id: portal_id})
            .then((portal) => {
                if(!portal){
                    throw new ResponseError("Portal not found", 404);
                } else {
                    old_image = portal[image_type];
                    return uploadFile.Process(request, allowed_types, storage_path, {rename: true, resize: false})
                }
            }).then((file) => {
                image = file;
                if(!image){
                    throw new Error('File upload error');
                } else if(request.query.save && request.query.save.toLowerCase() == 'true'){
                    let set = {};
                    set[image_type] = image;
                    return db.portals.update({portal_id: portal_id}, {$set: set});
                } else {
                    return true;
                }
            }).then((res) => {
                if(old_image){
                    var old_file = path.join(storage_path, old_image);
                    fs.stat(old_file, function(err, stat) {
                        if(err == null) {
                            fs.unlink(old_file);
                        }
                    });
                }
                response.json({
                    status: true,
                    image: image_url + '/' + image,
                    name: image
                });
            }).catch((error) => {
                response.status(400).json({
                    status: false,
                    error: error.message
                });
            });
        } catch(e) {
            response.status(400).json({
                status: false,
                error: e.message
            });
        }
    }

    static RemoveImage(request, response) {
        var image_type = request.query.type || 'logo',
            portal_id  = request.params.portal_id,
            image_file = '';
        db.portals.findOne({portal_id: portal_id})
        .then((portal) => {
            if(!portal){
                throw new ResponseError("Portal not found", 404);
            } else {
                image_file = path.join(config.upload_path, 'img/portals', portal[image_type]);
                var set = {};
                set[image_type] = '';
                return db.portals.update({portal_id: portal_id}, {$set: set})
            }
        }).then((portal) => {
            fs.unlink(image_file, (err, res) => {
                if(err == null) {
                    response.json({
                        status: true
                    });
                } else {
                    response.status(400).json({
                        status: false,
                        error: err.message
                    });
                }
            });
        }).catch((error) => {
            response.status(400).json({
                status: false,
                error: error.message
            });
        });
    }
}