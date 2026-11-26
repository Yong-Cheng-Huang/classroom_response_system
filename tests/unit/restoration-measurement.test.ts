import test from 'node:test';
import assert from 'node:assert/strict';
import {restorationTiming} from '../helpers/restoration-measurement.js';
test('13.3 後續全體核對不能延後已記錄的逐頁完整恢復；保留真實超時與計時錯誤',()=>{
 const clock={offset:100,uncertainty:2},reference={wall:100000,mono:7000,uncertainty:1,startedAt:90000,endedAt:null};
 const fast=restorationTiming({at:1900,elapsed:5000,observerVerificationMs:1},clock,reference,1000);
 assert.equal(fast.restored,2000);assert.equal(fast.upperMs,1004);assert.equal(fast.timerValid,true);
 const slow=restorationTiming({at:6500,elapsed:9600},clock,reference,1000);assert.ok(slow.upperMs>5000);assert.equal(slow.timerValid,true);
 assert.equal(restorationTiming({at:1900,elapsed:3000},clock,reference,1000).timerValid,false);
 assert.equal(restorationTiming({at:1900,elapsed:null},clock,reference,1000).timerValid,false);
});
