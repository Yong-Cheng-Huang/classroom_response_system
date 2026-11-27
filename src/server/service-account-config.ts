import {createPrivateKey} from 'node:crypto';
import {existsSync,readFileSync,realpathSync,chmodSync,statSync} from 'node:fs';
import {resolve,sep} from 'node:path';
import {projectRoot} from './config.js';
import {AppError} from '../shared/errors.js';

export type ServiceAccountConfig={email:string;privateKey:string};
export function loadServiceAccount(path:string):ServiceAccountConfig|null{
  if(!existsSync(path))return null;
  try{
    const actual=realpathSync(path);
    for(const area of ['src','dist','node_modules']){const blocked=resolve(projectRoot,area);if(actual===blocked||actual.startsWith(blocked+sep))throw new Error();}
    if(!statSync(actual).isFile())throw new Error();
    const raw:unknown=JSON.parse(readFileSync(actual,'utf8'));
    if(!raw||typeof raw!=='object')throw new Error();
    const type=Reflect.get(raw,'type'),email=Reflect.get(raw,'client_email'),privateKey=Reflect.get(raw,'private_key');
    if(type!=='service_account'||typeof email!=='string'||!/^[a-zA-Z0-9][a-zA-Z0-9._-]*@[a-zA-Z0-9.-]+\.gserviceaccount\.com$/u.test(email)||typeof privateKey!=='string')throw new Error();
    const key=createPrivateKey(privateKey);if(key.asymmetricKeyType!=='rsa'||(key.asymmetricKeyDetails?.modulusLength??0)<2048)throw new Error();
    chmodSync(actual,0o600);return{email,privateKey};
  }catch{throw new AppError('SERVICE_ACCOUNT_INVALID');}
}
