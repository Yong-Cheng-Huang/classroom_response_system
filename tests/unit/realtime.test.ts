import test from 'node:test';
import assert from 'node:assert/strict';
import { SnapshotCursor,type RealtimeFrame } from '../../src/shared/realtime.js';
const frame=(revision:number,type:'update'|'snapshot'='update',activityId='a'):RealtimeFrame=>({type,revision,activityId,serverEpoch:'boot',channelId:'private',data:{scope:'lobby',view:{activityId,phase:'READY',canJoin:true,groups:[],serverNow:1000}}});
test('7.3 接收器拒絕漏訊、亂序、重複、舊連線及舊活動；授權完整快照補缺口',()=>{
  const cursor=new SnapshotCursor();assert.equal(cursor.accept(frame(2)),'resync');assert.equal(cursor.accept(frame(1,'snapshot')),'applied');
  assert.equal(cursor.accept(frame(1)),'ignored');assert.equal(cursor.accept(frame(3)),'resync');assert.equal(cursor.value?.revision,1);
  assert.equal(cursor.accept(frame(3,'snapshot')),'applied');assert.equal(cursor.accept(frame(2)),'ignored');
  assert.equal(cursor.accept({...frame(4),channelId:'old'}),'ignored');assert.equal(cursor.accept({...frame(4),serverEpoch:'old'}),'ignored');
  assert.equal(cursor.accept(frame(4,'update','new')),'resync');assert.equal(cursor.accept(frame(4,'snapshot','new')),'applied');
  assert.equal(cursor.accept(frame(3,'snapshot','a')),'ignored');assert.equal(cursor.value?.activityId,'new');
  const reboot=new SnapshotCursor();assert.equal(reboot.accept({...frame(1,'snapshot','new'),serverEpoch:'new-boot'}),'applied');
});
