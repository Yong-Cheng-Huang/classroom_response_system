import type { IncomingMessage } from 'node:http';
import type { OrderedCommandQueue, Receipt } from './command-queue.js';
import { AppError } from '../shared/errors.js';

export function jsonObject(raw:Buffer):Record<string,unknown>{
  let value:unknown;
  try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));}catch{throw new AppError('INVALID_REQUEST');}
  if(!value||typeof value!=='object'||Array.isArray(value))throw new AppError('INVALID_REQUEST');return value as Record<string,unknown>;
}
export function onlyKeys(value:Record<string,unknown>,keys:string[]){if(Object.keys(value).some(key=>!keys.includes(key)))throw new AppError('INVALID_REQUEST');}
export function jsonCommand<T>(request:IncomingMessage,queue:OrderedCommandQueue,work:(body:Record<string,unknown>,receipt:Receipt)=>T|Promise<T>):Promise<T>{
  return new Promise((done,fail)=>{
    const chunks:Buffer[]=[];
    request.on('data',(chunk:Buffer)=>chunks.push(chunk));
    request.once('aborted',()=>fail(new AppError('INVALID_REQUEST')));request.once('error',()=>fail(new AppError('INVALID_REQUEST')));
    request.once('end',()=>{queue.enqueue(receipt=>{
      if(request.headers['content-type']?.split(';')[0]?.trim().toLowerCase()!=='application/json')throw new AppError('UNSUPPORTED_MEDIA');
      return work(jsonObject(Buffer.concat(chunks)),receipt);
    }).then(done,fail);});
  });
}
