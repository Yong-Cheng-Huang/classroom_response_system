import test from 'node:test';
import assert from 'node:assert/strict';
import {temporaryDatabase} from '../helpers/database.js';
import {sheetFixture} from '../helpers/sheets.js';
import {syntheticF3} from '../fixtures/catalog.js';
import {freshProof} from '../helpers/ranking.js';
import {IdentityService} from '../../src/server/identity.js';
import {ActivityService} from '../../src/server/activity.js';
import {SubmissionService} from '../../src/server/submissions.js';
import {parseGuidedNotes} from '../../src/server/guided-notes.js';
import {createSqliteAllocator} from '../../src/server/command-queue.js';
import {readActivityModel} from '../../src/server/read-model.js';

test('13.3 F3快照保留全部題目、欄位順序與答案，SQL讀取次數不隨題數增長',async t=>{
 const {database:db}=temporaryDatabase(t),now=()=>1000,identity=new IdentityService(db,'snapshot-fixture',now),activities=new ActivityService(db,identity,undefined,now),proof=freshProof(),grant=identity.login('snapshot-fixture',proof),teacher={...proof,token:grant.token,generation:grant.generation};
 const candidate=parseGuidedNotes(sheetFixture(syntheticF3()),'1',20),a=await activities.replace(teacher,candidate,{activityId:null,version:null,confirmed:false}),group=db.prepare('SELECT id FROM groups ORDER BY number LIMIT 1').get() as {id:string},p=freshProof(),g=identity.join(a.activityId,group.id,'原學生',p),student={...p,token:g.token,generation:g.generation},order=createSqliteAllocator(db,now);activities.transition(teacher,a.activityId,1,'start',order());
 const q=db.prepare("SELECT id FROM questions WHERE kind='GROUP' ORDER BY position DESC LIMIT 1").get() as {id:string},fields=db.prepare('SELECT id FROM question_fields WHERE question_id=? ORDER BY position').all(q.id) as {id:string}[];new SubmissionService(db,identity).submit(student,a.activityId,q.id,{requestId:'bulk-snapshot',answers:fields.map((f,i)=>({fieldId:f.id,text:'答案'+i}))},order());
 const prepare=db.prepare.bind(db);let reads=0;db.prepare=((sql:string)=>{if(/^\s*SELECT/i.test(sql))reads++;return prepare(sql);}) as typeof db.prepare;
 const model=readActivityModel(db,identity)!;assert.equal(model.questions.length,60);assert.equal(model.questions.flatMap(q=>q.fields).length,140);assert.deepEqual(model.questions.map(q=>q.number),candidate.questions.map(q=>q.number));assert.deepEqual(model.questions.flatMap(q=>q.fields.map(f=>f.prompt)),candidate.questions.flatMap(q=>q.fields.map(f=>f.prompt)));assert.equal(model.groups.length,20);assert.equal(model.participants.length,1);assert.equal(model.submissions.length,1);assert.deepEqual(model.submissions[0]!.answers.map(a=>a.text).sort(),fields.map((_,i)=>'答案'+i).sort());
 t.diagnostic("F3完整快照SELECT次數："+reads);assert.ok(reads<=12,`F3完整快照用了${reads}次SELECT，題數不應造成逐題查詢放大`);
});
