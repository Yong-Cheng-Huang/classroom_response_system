// 只對父程序建立的臨時資料庫做故障注入；不啟動正式應用程式。
import { writeFileSync,writeSync } from 'node:fs';
import { dirname,join } from 'node:path';
import { randomBytes,randomUUID } from 'node:crypto';
import { openDatabase } from '../../src/server/database.js';
import { IdentityService } from '../../src/server/identity.js';
import { replacePreparedActivity } from '../../src/server/activity-replacement.js';
import { preparedActivity } from '../../tests/helpers/replacement.js';
const [path,mode]=process.argv.slice(2);if(!path||!mode)throw new Error('探針參數缺漏');
const database=openDatabase(path);let now=1000;
const identity=new IdentityService(database,'g2-isolated-fixture',()=>now,true);identity.markReady();
const activity=await replacePreparedActivity(database,preparedActivity(),{activityId:null,version:null,confirmed:false});
const group=database.prepare('SELECT id FROM groups WHERE activity_id=? ORDER BY number LIMIT 1').get(activity.activityId) as {id:string};
const initial={secret:randomBytes(32).toString('hex'),instanceId:randomUUID(),generation:0};
const grant=identity.join(activity.activityId,group.id,'G2合成組員',initial);
writeFileSync(join(dirname(path),'proof.json'),JSON.stringify({...initial,token:grant.token,generation:grant.generation}),{mode:0o600});
// 正式 socket 的斷線轉換尚待 7.4，本探針只隔離已設計的 GRACE 儲存狀態與撤銷交易。
database.prepare("UPDATE sessions SET lifecycle='GRACE',grace_started_at=1000,grace_deadline=31000,state_version=state_version+1 WHERE id=?").run(identity.principal({...initial,token:grant.token,generation:grant.generation}).sessionId);
function halt(boundary:string):never{
  writeSync(1,JSON.stringify({boundary,logicalNow:now})+'\n');
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0);
  throw new Error('探針未預期恢復');
}
if(mode==='before-deadline'){now=30999;halt('截止前，未進撤銷交易');}
if(mode==='rollback-revocation'){
  now=31000;database.function('g2_halt',()=>halt('截止時，撤銷交易尚未 COMMIT'));
  database.exec("CREATE TRIGGER g2_cut BEFORE UPDATE OF lifecycle ON sessions WHEN NEW.lifecycle='REVOKED' BEGIN SELECT g2_halt(); END;");
  identity.sweep();
}
if(mode==='committed-revocation'){now=31000;identity.sweep();halt('截止時，撤銷及移除已 COMMIT');}
if(mode==='clean-before'){now=30999;identity.shutdown();halt('截止前，正常關機檢查點已 COMMIT');}
if(mode==='clean-expired'){now=31000;identity.shutdown();halt('截止時，正常關機已保存失效');}
throw new Error('未知探針模式');
