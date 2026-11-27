import type {IncomingMessage,ServerResponse} from 'node:http';
import type {IdentityService} from './identity.js';
import type {SheetsGateway} from './service-account.js';
import {assertRequestOrigin} from './identity-http.js';
import {AppError} from '../shared/errors.js';
export function sheetsHttp(sheets:SheetsGateway,identity:IdentityService){return async(request:IncomingMessage,response:ServerResponse,url:URL,operationId:string)=>{
 if(url.pathname!=='/api/sheets/status')return false;
 if(request.method!=='GET')throw new AppError('METHOD_NOT_ALLOWED');assertRequestOrigin(request);if(url.search)throw new AppError('INVALID_REQUEST');
 const data=sheets.status(identity.proof(request));response.writeHead(200,{'Content-Type':'application/json; charset=utf-8'});response.end(JSON.stringify({ok:true,data,operationId}));return true;
};}
