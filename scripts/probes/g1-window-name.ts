// G1 候選的隔離驗證；不是正式老師登入、參與或恢復服務。
import { chromium, type BrowserContext, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir, arch, release } from 'node:os';
import { join, resolve } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { CandidateAuthority } from './g1-candidate-server.js';

type Identity = { id: string; role: string; group: number | null; generation: number };
type Snapshot = { state:string; identity:Identity|null; instanceId:string; hasCapability:boolean; hasCredential:boolean;
  draft:string|null; transitions:{from:string;to:string}[] };
type DriverApi = {tabs:{query(query:object):Promise<{id:number;url:string}[]>;duplicate(id:number):Promise<{id:number}>};
  sessions:{getRecentlyClosed():Promise<{tab?:{sessionId:string;url:string}}[]>;restore(id:string):Promise<unknown>}};
type CaseResult = {name:string;outcome:'PASS'|'FAIL';durationMs:number;details?:unknown;error?:string};

const root=mkdtempSync(join(tmpdir(),'classroom-g1-name-'));
const authority=new CandidateAuthority(join(root,'leases.sqlite'));
const headless=!process.argv.includes('--headed');
const rounds=Number(process.argv.find(arg=>arg.startsWith('--rounds='))?.split('=')[1]??'3');
assert.ok(Number.isInteger(rounds)&&rounds>=1&&rounds<=20,'測試輪數須為1到20，這不是產品上限');
let context:BrowserContext|undefined, control:Page, base:string;
const tabIds=new WeakMap<Page,number>();
const cases:CaseResult[]=[];
const snapshot=(page:Page)=>page.evaluate<Snapshot>('window.candidate.snapshot()');
const ready=async(page:Page)=>{await page.waitForFunction('!!window.candidate');await page.evaluate('window.candidate.ready');return snapshot(page);};
const sourceUrl=()=>base+'/?probe='+randomUUID();

async function seed(role:'TEACHER'|'STUDENT',group:number|null){
  const page=await context!.newPage();await page.goto(sourceUrl());await ready(page);
  const secret=await page.evaluate<string>('window.name.slice(7)');
  const fixture=authority.seed(secret,role,group);
  await page.evaluate(async token=>{
    await (window as unknown as {candidate:{seed(token:string):Promise<void>}}).candidate.seed(token);
  },fixture.token);
  await page.evaluate('window.candidate.setDraft("合成未提交草稿")');
  const state=await snapshot(page);assert.equal(state.state,'OWNED');
  return {page,secret,...fixture};
}
async function duplicate(page:Page,waitForLoad=true){
  let id=tabIds.get(page);
  if(id===undefined){id=await control.evaluate(async url=>{
    const api=(globalThis as unknown as {chrome:DriverApi}).chrome;
    const found=(await api.tabs.query({})).find(tab=>tab.url===url);
    if(!found)throw new Error('找不到合成測試分頁');return found.id;
  },page.url());tabIds.set(page,id);}
  const created=context!.waitForEvent('page');
  const duplicateId=await control.evaluate(async id=>{
    const api=(globalThis as unknown as {chrome:DriverApi}).chrome;return(await api.tabs.duplicate(id)).id;
  },id);
  const copy=await created;tabIds.set(copy,duplicateId);
  if(waitForLoad){await copy.waitForLoadState();await ready(copy);}
  return copy;
}
async function post(path:string,input:unknown){const response=await fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input),signal:AbortSignal.timeout(5000)});return{status:response.status,body:await response.json() as Record<string,unknown>};}
async function check(name:string,work:()=>Promise<unknown>){
  const started=performance.now();
  try{const details=await work();cases.push({name,outcome:'PASS',durationMs:performance.now()-started,details});console.log('通過：'+name);}
  catch(error){const message=error instanceof Error?error.message:'探針失敗';cases.push({name,outcome:'FAIL',durationMs:performance.now()-started,error:message});console.log('未通過：'+name+'；'+message);}
  finally{authority.phase='READY';authority.isolateOpener=true;for(const page of context!.pages())if(page!==control)await page.close().catch(()=>{});}
}
try{
  base=await authority.start();
  const extension=join(root,'driver');mkdirSync(extension);
  writeFileSync(join(extension,'manifest.json'),JSON.stringify({manifest_version:3,name:'G1原生分頁操作工具',version:'1.0',permissions:['tabs','sessions']}));
  writeFileSync(join(extension,'control.html'),'<title>G1隔離控制器</title>');
  context=await chromium.launchPersistentContext(join(root,'profile'),{channel:'chrome',headless,
    ignoreDefaultArgs:['--disable-extensions','--disable-back-forward-cache','--disable-background-timer-throttling','--disable-backgrounding-occluded-windows','--disable-renderer-backgrounding'],
    args:['--enable-unsafe-extension-debugging']});
  context.setDefaultTimeout(10000);
  const browser=context.browser()!;const cdp=await browser.newBrowserCDPSession();
  const{id}=await cdp.send('Extensions.loadUnpacked',{path:extension});
  control=await context.newPage();await control.goto(`chrome-extension://${id}/control.html`);
  for(let round=1;round<=rounds;round++){
    await check(`第${round}輪：IA03同Chrome兩老師與不同組隔離、連續重整`,async()=>{
      const fixtures=await Promise.all([seed('TEACHER',null),seed('TEACHER',null),seed('STUDENT',1),seed('STUDENT',2)]);
      for(const fixture of fixtures){const first=await snapshot(fixture.page);for(let i=0;i<3;i++){await fixture.page.reload();const state=await ready(fixture.page);assert.equal(state.state,'OWNED');assert.equal(state.identity!.id,fixture.id);assert.equal(state.identity!.role,first.identity!.role);assert.equal(state.identity!.group,first.identity!.group);assert.equal(state.draft,'合成未提交草稿');} }
      assert.equal(new Set(fixtures.map(f=>f.secret)).size,4);return{tabs:4,reloadsPerTab:3};
    });
    for(const role of ['TEACHER','STUDENT'] as const){
      await check(`第${round}輪：${role}原生副本拒絕、原頁保持有效`,async()=>{
        const original=await seed(role,role==='STUDENT'?1:null);authority.phase='RUNNING';
        const before=authority.inspect(original.id),copy=await duplicate(original.page),state=await snapshot(copy);
        assert.equal(state.state,'NEW');assert.equal(state.hasCredential,false);assert.equal(state.draft,null);
        assert.notEqual(await copy.evaluate('window.name.slice(7)'),original.secret);
        assert.deepEqual(authority.inspect(original.id),before);
        assert.equal((await original.page.evaluate<{status:number}>('window.candidate.action()')).status,200);
        assert.equal((await copy.evaluate<{status:number}>('window.candidate.join()')).status,403);
        const forged=await post('/resume',{token:original.token,secret:randomBytes(32).toString('hex'),generation:before.generation,instanceId:randomUUID()});
        assert.equal(forged.status,403);assert.deepEqual(authority.inspect(original.id),before);
        await original.page.close();await copy.reload();const afterClose=await ready(copy);
        assert.equal(afterClose.state,'NEW');assert.equal(afterClose.hasCredential,false);assert.equal(afterClose.draft,null);
        assert.deepEqual(authority.inspect(original.id),before);
        return{copy:state,forgedStatus:forged.status,afterOriginalClosed:afterClose};
      });
      await check(`第${round}輪：${role}原頁重整交接時副本先完成`,async()=>{
        const original=await seed(role,role==='STUDENT'?1:null),before=authority.inspect(original.id);
        const held=authority.holdNextDocument();
        const reload=original.page.reload({waitUntil:'commit'});await held.committed;await reload;
        const copy=await duplicate(original.page);assert.equal((await snapshot(copy)).state,'NEW');
        assert.deepEqual(authority.inspect(original.id),before);
        held.release();await original.page.waitForLoadState();const restored=await ready(original.page);
        assert.equal(restored.identity!.id,original.id);assert.equal(restored.identity!.generation,before.generation+1);
        assert.equal(restored.draft,'合成未提交草稿');return{restored,copy:await snapshot(copy)};
      });
      await check(`第${round}輪：${role}副本首次腳本前重整、原頁關閉`,async()=>{
        const original=await seed(role,role==='STUDENT'?1:null),before=authority.inspect(original.id);
        const held=authority.holdNextDocument();const created=duplicate(original.page,false);
        await held.committed;const copy=await created;await copy.waitForURL(original.page.url(),{waitUntil:'commit'});
        assert.equal(await copy.evaluate('typeof window.candidate'),'undefined');
        const copied=await copy.evaluate<string>('sessionStorage.getItem("g1-credential")');assert.ok(copied);
        await original.page.close();await copy.reload();const state=await ready(copy);
        assert.equal(state.state,'NEW');assert.equal(state.hasCredential,false);assert.equal(state.draft,null);
        assert.deepEqual(authority.inspect(original.id),before);return{firstScriptDidNotRun:true,afterReload:state};
      });
    }
    await check(`第${round}輪：同源opener新頁不可取得原分頁憑證`,async()=>{
      const original=await seed('TEACHER',null),before=authority.inspect(original.id);
      const created=context!.waitForEvent('page');await original.page.evaluate(url=>{window.open(url,'_blank');},sourceUrl());
      const child=await created;await child.waitForLoadState();const state=await ready(child);
      assert.equal(await child.evaluate('window.opener===null'),true);
      assert.equal(state.state,'NEW');assert.equal(state.hasCredential,false);assert.equal(state.draft,null);
      assert.deepEqual(authority.inspect(original.id),before);return{openerNull:true,state};
    });
    await check(`第${round}輪：負對照，未設COOP時同源opener可破壞第二憑證隔離`,async()=>{
      authority.isolateOpener=false;
      const original=await seed('TEACHER',null);
      const created=context!.waitForEvent('page');await original.page.evaluate(url=>{window.open(url,'_blank');},sourceUrl());
      const child=await created;await child.waitForLoadState();await ready(child);
      const attack=await child.evaluate(async()=>{
        const source=window.opener as Window;
        const credential=JSON.parse(source.sessionStorage.getItem('g1-credential')!);
        const response=await fetch('/resume',{method:'POST',headers:{'Content-Type':'application/json'},
          body:JSON.stringify({...credential,secret:source.name.slice(7),instanceId:crypto.randomUUID()})});
        return{status:response.status};
      });
      assert.equal(attack.status,200);
      assert.equal((await original.page.evaluate<{status:number}>('window.candidate.action()')).status,403);
      return{control:'無COOP的故意不安全原型',openerProofAccepted:attack.status,originalInstanceRejected:403};
    });
    await check(`第${round}輪：原頁關閉後還原不恢復身分或草稿`,async()=>{
      const original=await seed('STUDENT',1),url=original.page.url(),before=authority.inspect(original.id);
      await original.page.close();const created=context!.waitForEvent('page');
      await control.evaluate(async url=>{const api=(globalThis as unknown as {chrome:DriverApi}).chrome;const entry=(await api.sessions.getRecentlyClosed()).find(entry=>entry.tab?.url===url);if(!entry?.tab)throw new Error('找不到剛關閉的測試頁');await api.sessions.restore(entry.tab.sessionId);},url);
      const restored=await created;await restored.waitForLoadState();const state=await ready(restored);
      assert.equal(state.state,'NEW');assert.equal(state.hasCredential,false);assert.equal(state.draft,null);
      assert.deepEqual(authority.inspect(original.id),before);return{restored:state};
    });
    for(const role of ['TEACHER','STUDENT'] as const)await check(`第${round}輪：${role}SQLite重啟後副本先抵達、原有效頁再恢復`,async()=>{
      const original=await seed(role,role==='STUDENT'?1:null),before=authority.inspect(original.id),count=authority.leaseCount();
      authority.phase='RUNNING';
      // 先建立副本，再重開同一來源的測試權威端；不涉及未知的寬限到期政策。
      const copy=await duplicate(original.page);assert.equal((await snapshot(copy)).state,'NEW');
      const oldBase=base;base=await authority.restart();assert.equal(base,oldBase);
      await copy.reload();assert.equal((await ready(copy)).state,'NEW');
      assert.equal((await copy.evaluate<{status:number}>('window.candidate.join()')).status,403);
      const denied=await post('/resume',{token:original.token,secret:randomBytes(32).toString('hex'),generation:before.generation,instanceId:randomUUID()});
      assert.equal(denied.status,403);assert.deepEqual(authority.inspect(original.id),before);
      await original.page.evaluate('window.candidate.resume()');const restored=await snapshot(original.page);
      assert.equal(restored.state,'OWNED');assert.equal(restored.identity!.id,original.id);
      assert.equal(restored.identity!.generation,before.generation);assert.equal(authority.leaseCount(),count);
      return{sameOrigin:true,copyDenied:denied.status,noAdditionalLease:true,restored};
    });
    await check(`第${round}輪：舊世代、偽造角色及交接回覆截斷`,async()=>{
      const original=await seed('STUDENT',1),oldState=await snapshot(original.page),old=authority.inspect(original.id);
      await original.page.reload();const current=await ready(original.page);
      const stale=await post('/action',{token:original.token,secret:original.secret,generation:old.generation,instanceId:oldState.instanceId});
      assert.equal(stale.status,403);
      const staleResume=await post('/resume',{token:original.token,secret:original.secret,generation:old.generation,instanceId:oldState.instanceId});
      assert.equal(staleResume.status,409);assert.equal(authority.inspect(original.id).instance,current.instanceId);
      const role=await original.page.evaluate<{status:number;body:Identity}>('window.candidate.action({role:"TEACHER",group:2})');
      assert.equal(role.body.role,'STUDENT');assert.equal(role.body.group,1);
      authority.truncateNextResumeReply=true;await original.page.reload();const disconnected=await ready(original.page);
      assert.equal(disconnected.state,'DISCONNECTED');
      await original.page.reload();const recovered=await ready(original.page);
      assert.equal(recovered.state,'OWNED');assert.equal(recovered.identity!.id,original.id);
      assert.equal(authority.inspect(original.id).expires_at,old.expires_at);
      return{staleAction:stale.status,staleResume:staleResume.status,recovered};
    });
  }
  const report={recordedAt:new Date().toISOString(),chrome:context.browser()!.version(),node:process.version,
    environment:{platform:process.platform,arch:arch(),kernel:release(),headless},rounds,
    candidate:'window.name第二憑證＋COOP noopener-allow-popups＋SQLite交接版本與執行個體核對',
    method:'同一隔離Chrome設定檔；擴充功能只驅動原生複製／關閉後還原；合成身分由測試fixture建立；產品未使用擴充功能或CDP。',
    cases,gate:cases.every(c=>c.outcome==='PASS')?'CANDIDATE_PASSED':'NOT_PROVEN',
    limitations:['這是G1隔離原型，不是4.2正式實作或全系統驗收。','未裁定U01強制中斷寬限、U02凍結休眠或U03未核實範圍。','未實作WebSocket、Google OAuth或固定負載效能驗收。']};
  mkdirSync(resolve('docs/evidence'),{recursive:true});
  const target=`docs/evidence/g1-window-name-${headless?'headless':'headed'}.json`;
  writeFileSync(target,JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({gate:report.gate,pass:cases.filter(c=>c.outcome==='PASS').length,total:cases.length,evidence:target}));
  if(report.gate!=='CANDIDATE_PASSED')process.exitCode=2;
}finally{await context?.close();await authority.stop();rmSync(root,{recursive:true,force:true});}
