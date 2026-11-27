import {AppError} from '../shared/errors.js';

/** 只讀公開原表；不使用共用 OAuth 狀態，也不接受任意上游網址。 */
export class PublicSheetsReader {
  constructor(private readonly apiKey:string|undefined,private readonly transport:typeof fetch=fetch){}
  get configured(){return Boolean(this.apiKey);}
  async spreadsheet(id:string,params:Record<string,string>):Promise<unknown>{
    if(!/^[A-Za-z0-9_-]+$/u.test(id))throw new AppError('INVALID_SHEETS_URL');
    if(!this.apiKey)throw new AppError('PUBLIC_SHEETS_NOT_CONFIGURED');
    const url=new URL('https://sheets.googleapis.com/v4/spreadsheets/'+id);
    for(const [name,value]of Object.entries(params)){
      if(name!=='fields'&&name!=='ranges')throw new AppError('INVALID_REQUEST');
      url.searchParams.set(name,value);
    }
    let response:Response;
    try{response=await this.transport(url,{method:'GET',headers:{'X-Goog-Api-Key':this.apiKey},credentials:'omit',redirect:'error',signal:AbortSignal.timeout(20000)});}
    catch{throw new AppError('EXTERNAL_UNAVAILABLE');}
    if(!response.ok){
      // 只識別固定代碼，絕不轉傳 Google 原始訊息或上游網址。
      let payload:unknown;try{payload=await response.json();}catch{}
      const reasons=new Set<string>();
      if(payload&&typeof payload==='object'&&'error'in payload){
        const error=payload.error;
        if(error&&typeof error==='object')for(const name of ['errors','details']){
          const entries=Reflect.get(error,name);
          if(Array.isArray(entries))for(const entry of entries)if(entry&&typeof entry==='object'&&typeof entry.reason==='string')reasons.add(entry.reason);
        }
      }
      if(response.status===401||[...reasons].some(r=>['API_KEY_INVALID','API_KEY_SERVICE_BLOCKED','API_KEY_IP_ADDRESS_BLOCKED','API_KEY_HTTP_REFERRER_BLOCKED','SERVICE_DISABLED','accessNotConfigured','keyInvalid','ipRefererBlocked'].includes(r)))throw new AppError('PUBLIC_SHEETS_KEY_INVALID');
      if(response.status===403)throw new AppError('PUBLIC_SHEETS_FORBIDDEN');
      if(response.status===404)throw new AppError('GOOGLE_DOCUMENT_NOT_FOUND');
      throw new AppError('EXTERNAL_UNAVAILABLE');
    }
    try{return await response.json();}catch{throw new AppError('EXTERNAL_UNAVAILABLE');}
  }
}
