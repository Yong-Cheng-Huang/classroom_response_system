import test from 'node:test';
import assert from 'node:assert/strict';

test('CSV06／08 分頁授權下載共用失效處理、重試、取消及過期回覆保護',async t=>{
 const names=['window','sessionStorage','fetch'] as const,originals=names.map(n=>[n,Object.getOwnPropertyDescriptor(globalThis,n)] as const);t.after(()=>{for(const [name,descriptor]of originals){if(descriptor)Object.defineProperty(globalThis,name,descriptor);else Reflect.deleteProperty(globalThis,name);}});
 const saved=new Map<string,string>();Object.defineProperty(globalThis,'window',{configurable:true,value:{name:''}});Object.defineProperty(globalThis,'sessionStorage',{configurable:true,value:{getItem:(k:string)=>saved.get(k)??null,setItem:(k:string,v:string)=>saved.set(k,v),removeItem:(k:string)=>saved.delete(k)}});
 const session={role:'TEACHER',createdAt:1,expiresAt:43200001},token='a'.repeat(64),json=(data:unknown)=>new Response(JSON.stringify({ok:true,data}),{headers:{'Content-Type':'application/json'}});
 let reply=async()=>json({token,generation:1,session});const calls:{path:string;headers:Headers}[]=[];
 Object.defineProperty(globalThis,'fetch',{configurable:true,value:async(input:RequestInfo|URL,init?:RequestInit)=>{calls.push({path:String(input),headers:new Headers(init?.headers)});return reply();}});
 const {TabSession,ApiFailure}=await import('../../src/client/session.js'),tab=new TabSession();await tab.login('fixture');
 reply=async()=>new Response('\uFEFF"題號"\r\n',{headers:{'Content-Type':'text/csv; charset=utf-8'}});assert.match(await (await tab.download('/api/activities/fixture/submissions.csv')).text(),/題號/);
 const last=calls.at(-1)!;assert.equal(last.headers.get('authorization'),'Bearer '+token);assert.equal(last.headers.get('x-tab-proof')?.length,64);assert.equal(last.headers.get('x-document-instance'),tab.instanceId);assert.equal(last.headers.get('x-session-generation'),'1');assert.ok(!last.path.includes(token));assert.ok(!last.path.includes('?'));
 reply=async()=>new Response(JSON.stringify({ok:false,error:{code:'STATE_CONFLICT',message:'活動尚未結束。'}}),{status:409,headers:{'Content-Type':'application/json'}});await assert.rejects(tab.download('/csv'),(e:unknown)=>e instanceof ApiFailure&&e.message==='活動尚未結束。');assert.equal(tab.snapshot().status,'OWNED');
 reply=async()=>json({});await assert.rejects(tab.download('/csv'),/不是 CSV/);
 reply=async()=>{throw new Error('network');};await assert.rejects(tab.download('/csv'),/暫時無法連接/);assert.equal(tab.snapshot().status,'DISCONNECTED');reply=async()=>json({generation:1,session});await tab.restore();assert.equal(tab.snapshot().status,'OWNED');
 const controller=new AbortController();controller.abort();reply=async()=>{throw new Error('cancel');};await assert.rejects(tab.download('/csv',controller.signal));assert.equal(tab.snapshot().status,'OWNED');
 let finish:(response:Response)=>void=()=>{},seen:()=>void=()=>{};const entered=new Promise<void>(r=>seen=r);reply=()=>{seen();return new Promise<Response>(r=>finish=r);};const pending=tab.download('/csv');await entered;reply=async()=>json({});await tab.logout();finish(new Response('舊檔案',{headers:{'Content-Type':'text/csv'}}));await assert.rejects(pending,/下載已取消/);
 reply=async()=>json({token,generation:1,session});await tab.login('fixture');reply=async()=>new Response(JSON.stringify({ok:false,error:{code:'SESSION_EXPIRED',message:'身分已到期。'}}),{status:401,headers:{'Content-Type':'application/json'}});await assert.rejects(tab.download('/csv'),/身分已到期/);assert.equal(tab.snapshot().status,'NEW');
});
