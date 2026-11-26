import type { IncomingMessage,ServerResponse } from 'node:http';
import type { IdentityService } from './identity.js';
import type { OrderedCommandQueue } from './command-queue.js';
import type { GoogleService } from './google.js';
import { jsonCommand,onlyKeys } from './http-body.js';
import { assertRequestOrigin } from './identity-http.js';
import { AppError,publicError } from '../shared/errors.js';
import type { Logger } from './logger.js';

export function googleHttp(google:GoogleService,identity:IdentityService,commands:OrderedCommandQueue,logger:Logger){
  return async(request:IncomingMessage,response:ServerResponse,url:URL,operationId:string)=>{
    const routes:Record<string,string>={'/api/google/connect':'POST','/api/google/status':'GET','/api/google/connection':'DELETE','/api/google/callback':'GET'};
    if(!routes[url.pathname])return false;
    if(request.method!==routes[url.pathname])throw new AppError('METHOD_NOT_ALLOWED');
    if(url.pathname==='/api/google/callback'){
      response.setHeader('Referrer-Policy','no-referrer');
      response.setHeader('Content-Security-Policy',"default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'");
      let status=200,message='Google 已連結。請關閉此頁，返回原老師分頁。';
      try{
        if(request.headers.host!==`127.0.0.1:${request.socket.localPort}`)throw new AppError('FORBIDDEN');
        const allowed=['code','state','error','error_description','error_uri','scope','authuser','prompt','hd','iss'];
        for(const key of url.searchParams.keys())if(!allowed.includes(key)||url.searchParams.getAll(key).length!==1)throw new AppError('INVALID_REQUEST');
        if(url.searchParams.has('iss')&&url.searchParams.get('iss')!=='https://accounts.google.com')throw new AppError('OAUTH_STATE_INVALID');
        await google.complete(url.searchParams.get('state')??'',url.searchParams.get('code'),url.searchParams.has('error'),work=>commands.enqueue(()=>work()));
      }catch(error){const safe=publicError(error,operationId);status=safe.status;message=safe.body.error.message;logger({level:'error',event:'操作失敗',operationId,code:safe.body.error.code});}
      response.writeHead(status,{'Content-Type':'text/html; charset=utf-8'});
      response.end(`<!doctype html><html lang="zh-Hant"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Google 連結結果</title><style>body{font:18px system-ui;color:#193b34;background:#f5f1e8;max-width:560px;margin:15vh auto;padding:24px;line-height:1.8}a{color:inherit}</style><h1>Google 連結結果</h1><p>${message}</p><p>原老師分頁會顯示目前連結狀態。</p></html>`);return true;
    }
    assertRequestOrigin(request);if([...url.searchParams].length)throw new AppError('INVALID_REQUEST');
    const data=request.method==='GET'?google.status(identity.proof(request)):await jsonCommand(request,commands,body=>{
      onlyKeys(body,[]);const proof=identity.proof(request);
      return request.method==='POST'?google.begin(proof):google.disconnect(proof);
    });
    response.writeHead(200,{'Content-Type':'application/json; charset=utf-8'});response.end(JSON.stringify({ok:true,data,operationId}));return true;
  };
}
