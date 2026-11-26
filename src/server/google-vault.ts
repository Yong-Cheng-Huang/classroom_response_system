import { createCipheriv,createDecipheriv,randomBytes,randomUUID } from 'node:crypto';
import { mkdirSync,readFileSync,writeFileSync,renameSync,unlinkSync,openSync,fsyncSync,closeSync,chmodSync } from 'node:fs';
import { join } from 'node:path';
import { AppError } from '../shared/errors.js';

// 憑證不進 SQLite／前端；檔案及金鑰皆由擁有者讀寫，另以 GCM 驗完整性。
export class GoogleVault {
  private readonly directory:string;
  constructor(dataDir:string){this.directory=join(dataDir,'google-credentials');}
  private key(create=false){
    const path=join(this.directory,'key');
    if(create){
      mkdirSync(this.directory,{recursive:true,mode:0o700});chmodSync(this.directory,0o700);
      try{writeFileSync(path,randomBytes(32),{flag:'wx',mode:0o600});}
      catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;}
    }
    const key=readFileSync(path);if(key.length!==32)throw new AppError('GOOGLE_REAUTHORIZE');chmodSync(path,0o600);return key;
  }
  private path(reference:string){if(!/^[0-9a-f-]{36}$/u.test(reference))throw new AppError('GOOGLE_REAUTHORIZE');return join(this.directory,reference+'.enc');}
  save(value:unknown):string{
    const reference=randomUUID(),target=this.path(reference),temporary=target+'.tmp';
    try{
      const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',this.key(true),iv);
      const body=Buffer.concat([cipher.update(JSON.stringify(value),'utf8'),cipher.final()]);
      const payload=Buffer.concat([iv,cipher.getAuthTag(),body]);
      writeFileSync(temporary,payload,{flag:'wx',mode:0o600});
      const fd=openSync(temporary,'r');try{fsyncSync(fd);}finally{closeSync(fd);}
      renameSync(temporary,target);
      const directory=openSync(this.directory,'r');try{fsyncSync(directory);}finally{closeSync(directory);}
      return reference;
    }catch{try{unlinkSync(temporary);}catch{}throw new AppError('DATABASE_UNAVAILABLE');}
  }
  load<T>(reference:string):T{
    try{
      const payload=readFileSync(this.path(reference));
      const decipher=createDecipheriv('aes-256-gcm',this.key(),payload.subarray(0,12));decipher.setAuthTag(payload.subarray(12,28));
      return JSON.parse(Buffer.concat([decipher.update(payload.subarray(28)),decipher.final()]).toString('utf8')) as T;
    }catch{throw new AppError('GOOGLE_REAUTHORIZE');}
  }
  remove(reference:string){try{unlinkSync(this.path(reference));}catch{/* 本機失聯後殘留檔不可再由服務引用。 */}}
}
