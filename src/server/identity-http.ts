import type { IncomingMessage,ServerResponse } from 'node:http';
import type { IdentityService } from './identity.js';
import type { OrderedCommandQueue } from './command-queue.js';
import { jsonCommand,onlyKeys } from './http-body.js';
import { AppError } from '../shared/errors.js';

export function assertRequestOrigin(request:IncomingMessage){
  const expected=`127.0.0.1:${request.socket.localPort}`;
  if(request.headers.host!==expected||(request.headers.origin&&request.headers.origin!==`http://${expected}`))throw new AppError('FORBIDDEN');
}
export function identityHttp(identity:IdentityService,queue:OrderedCommandQueue){
  return async(request:IncomingMessage,response:ServerResponse,url:URL,operationId:string)=>{
    const routes:Record<string,string>={'/api/teacher/login':'POST','/api/session':'GET','/api/session/ownership':'GET','/api/session/resume':'POST','/api/session/logout':'POST','/api/session/nickname':'PATCH'};
    const method=routes[url.pathname];if(!method)return false;
    if(request.method!==method)throw new AppError('METHOD_NOT_ALLOWED');
    if([...url.searchParams].length)throw new AppError('INVALID_REQUEST');assertRequestOrigin(request);
    let data:unknown;
    if(method==='GET')data=url.pathname==='/api/session'?identity.current(identity.proof(request)):identity.ownership(identity.proof(request));
    else data=await jsonCommand(request,queue,body=>{
      if(url.pathname==='/api/teacher/login'){onlyKeys(body,['password']);return identity.login(body.password,identity.proof(request,false));}
      if(url.pathname==='/api/session/nickname'){onlyKeys(body,['nickname']);identity.principal(identity.proof(request));throw new AppError('FORBIDDEN');}
      onlyKeys(body,[]);const proof=identity.proof(request);
      if(url.pathname==='/api/session/resume')return identity.resume(proof);
      identity.logout(proof);return{loggedOut:true};
    });
    response.writeHead(200,{'Content-Type':'application/json; charset=utf-8'});response.end(JSON.stringify({ok:true,data,operationId}));return true;
  };
}
