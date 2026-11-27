import type {IdentityService} from '../../src/server/identity.js';
import {ServiceAccountSheets,ServiceAccountTokens} from '../../src/server/service-account.js';
import {AppError} from '../../src/shared/errors.js';
/** 僅測試用的服務帳戶；不載入真實JSON或任何OAuth資料。 */
export function fixtureSheets(identity:IdentityService,now:()=>number=Date.now,email='robot@fixture.iam.gserviceaccount.com'){
 const config={email,privateKey:'合成傳輸不使用私鑰'};
 const tokens=new ServiceAccountTokens(config,now,async()=>({access_token:'SERVICE_ACCOUNT_FIXTURE_TOKEN',expiry_date:now()+3600000}));
 let transport:typeof fetch=async()=>{throw new AppError('EXTERNAL_UNAVAILABLE');};
 const sheets=new ServiceAccountSheets(identity,tokens,(...args)=>transport(...args));
 return Object.assign(sheets,{setTransport:(next:typeof fetch)=>{transport=next;}});
}
