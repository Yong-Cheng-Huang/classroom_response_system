import type { IncomingMessage,ServerResponse } from 'node:http';
import type { ExportService } from './exports.js';
import type { IdentityService } from './identity.js';
import type { ActivityService } from './activity.js';
import type { OrderedCommandQueue } from './command-queue.js';
import { jsonCommand,onlyKeys } from './http-body.js';
import { assertRequestOrigin } from './identity-http.js';
import { AppError } from '../shared/errors.js';
export function exportHttp(exports:ExportService,identity:IdentityService,activities:ActivityService,commands:OrderedCommandQueue){
 return async(request:IncomingMessage,response:ServerResponse,url:URL,operationId:string)=>{
  const activity=url.pathname.match(/^\/api\/activities\/([^/]+)\/exports$/u),operation=url.pathname.match(/^\/api\/operations\/([^/]+)(?:\/(reconcile|abandon-confirmation|cancel))?$/u);
  if(!activity&&!operation)return false;assertRequestOrigin(request);if(url.search)throw new AppError('INVALID_REQUEST');
  let data:unknown;
  if(request.method==='GET'&&(!operation||!operation[2])){const proof=identity.proof(request);data=activity?exports.list(proof,decodeURIComponent(activity[1]!)):exports.get(proof,decodeURIComponent(operation![1]!));}
  else if(request.method==='POST'){
   if(activity){const work=await jsonCommand(request,commands,body=>{onlyKeys(body,['requestId','mode','paused','expectedVersion','accessMode']);return exports.begin(identity.proof(request),decodeURIComponent(activity[1]!),{requestId:body.requestId,mode:body.mode,paused:body.paused,expectedVersion:body.expectedVersion,accessMode:body.accessMode});});data=await exports.execute(work);}
   else if(operation![2]==='reconcile'){const proof=await jsonCommand(request,commands,body=>{onlyKeys(body,['acknowledgeCredentialChange']);if(body.acknowledgeCredentialChange!==undefined&&typeof body.acknowledgeCredentialChange!=='boolean')throw new AppError('INVALID_REQUEST');const p=identity.proof(request);exports.get(p,operation![1]!);return{p,ack:body.acknowledgeCredentialChange};});data=await exports.reconcile(proof.p,operation![1]!,proof.ack);}
   else if(operation![2]==='cancel')data=await jsonCommand(request,commands,body=>{onlyKeys(body,[]);return exports.cancel(identity.proof(request),operation![1]!);});
   else if(operation![2]==='abandon-confirmation')data=await jsonCommand(request,commands,body=>{onlyKeys(body,['confirmed','expectedVersion']);return activities.confirmAbandonment(identity.proof(request),operation![1]!,body.expectedVersion,body.confirmed);});
   else throw new AppError('METHOD_NOT_ALLOWED');
  }else throw new AppError('METHOD_NOT_ALLOWED');
  if(identity.principal(identity.proof(request)).role!=='TEACHER')throw new AppError('FORBIDDEN');
  response.writeHead(200,{'Content-Type':'application/json; charset=utf-8'});response.end(JSON.stringify({ok:true,data,operationId}));return true;
 };
}
