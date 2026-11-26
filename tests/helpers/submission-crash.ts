import { readFileSync,writeSync } from 'node:fs';
import { openDatabase } from '../../src/server/database.js';
import { IdentityService } from '../../src/server/identity.js';
import { SubmissionService } from '../../src/server/submissions.js';
import { createSqliteAllocator } from '../../src/server/command-queue.js';
import type { TabProof } from '../../src/shared/session.js';
import type { CommandInputs } from '../../src/shared/contracts.js';
const [path,fixturePath,mode]=process.argv.slice(2);if(!path||!fixturePath)throw new Error('故障探針參數缺漏');
const fixture=JSON.parse(readFileSync(fixturePath,'utf8')) as {proof:TabProof;activityId:string;questionId:string;input:CommandInputs['submit'];lastField:string};
const db=openDatabase(path),identity=new IdentityService(db,'crash-ranking-fixture',()=>2000,true);identity.markReady();
const service=new SubmissionService(db,identity);
function halt(marker:string):never{writeSync(1,marker+'\n');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0);throw new Error('未預期恢復');}
if(mode==='before'){
 db.function('submission_halt',()=>halt('BEFORE_COMMIT'));
 db.exec(`CREATE TRIGGER cut_submission BEFORE INSERT ON submission_answers WHEN NEW.field_id='${fixture.lastField}' BEGIN SELECT submission_halt(); END;`);
}
service.submit(fixture.proof,fixture.activityId,fixture.questionId,fixture.input,createSqliteAllocator(db,()=>2000)());
if(mode==='after')halt('AFTER_COMMIT_BEFORE_RESPONSE');
db.close();
