import type { IncomingMessage,ServerResponse } from 'node:http';
import type { ImportService } from './imports.js';
import type { IdentityService } from './identity.js';
import type { OrderedCommandQueue } from './command-queue.js';
import { jsonCommand,onlyKeys } from './http-body.js';
import { assertRequestOrigin } from './identity-http.js';
import { AppError } from '../shared/errors.js';

export function importHttp(imports:ImportService,identity:IdentityService,commands:OrderedCommandQueue){
  return async(request:IncomingMessage,response:ServerResponse,url:URL,operationId:string)=>{
    const inspect=url.pathname==='/api/imports/inspect',match=url.pathname.match(/^\/api\/imports\/([0-9a-f]{64})\/(select|commit|cancel)$/u);
    if(!inspect&&!match)return false;
    if(request.method!=='POST')throw new AppError('METHOD_NOT_ALLOWED');assertRequestOrigin(request);
    if([...url.searchParams].length)throw new AppError('INVALID_REQUEST');
    let data:unknown;
    if(inspect){
      const work=await jsonCommand(request,commands,body=>{onlyKeys(body,['url','groupCount','abandonmentToken']);if(body.abandonmentToken!==undefined&&typeof body.abandonmentToken!=='string')throw new AppError('INVALID_REQUEST');return imports.begin(identity.proof(request),body.url,body.groupCount,body.abandonmentToken as string|undefined);});
      data=await imports.inspect(work); // 網路讀取在共同命令佇列之外。
    }else if(match![2]==='select'){
      const work=await jsonCommand(request,commands,body=>{onlyKeys(body,['sheetId']);return imports.prepareSelect(identity.proof(request),match![1]!,body.sheetId);});
      data=await imports.select(work);
    }else data=await jsonCommand<unknown>(request,commands,body=>{
      onlyKeys(body,match![2]==='commit'?['confirmed']:[]);const proof=identity.proof(request);
      return match![2]==='commit'?imports.commit(proof,match![1]!,body.confirmed):imports.cancel(proof,match![1]!);
    });
    response.writeHead(200,{'Content-Type':'application/json; charset=utf-8'});response.end(JSON.stringify({ok:true,data,operationId}));return true;
  };
}
