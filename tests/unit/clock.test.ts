import test from 'node:test';
import assert from 'node:assert/strict';
import { ServerClock } from '../../src/client/clock.js';
test('7.6 伺服器校時採往返中點與單調時鐘；重新校正不依客戶端日期或累加 timer',()=>{
  let mono=100;const clock=new ServerClock(()=>mono);assert.equal(clock.now(2000),2000);
  let changes=0;const unsubscribe=clock.subscribe(()=>changes++);
  clock.sample(10000);mono=5100;assert.equal(clock.now(0),15000);
  const sentAt=mono;mono+=100;clock.sample(20000,sentAt);assert.equal(clock.now(0),20050);assert.equal(clock.snapshot()?.rtt,100);
  mono+=250;assert.equal(clock.now(0),20300);clock.sample(NaN);assert.equal(changes,2);
  unsubscribe();clock.sample(30000);assert.equal(changes,2);assert.equal(clock.now(0),30000);
});

test('13.3 伺服器脈衝觸發DOM訂閱，保留已校準錨點與RTT，不採脈衝抵達延遲重設時間',()=>{
 let mono=100;const clock=new ServerClock(()=>mono);clock.sample(10000,80);const anchor=clock.snapshot()!;let updates=0;clock.subscribe(()=>updates++);mono+=1100;
 clock.tick(50000);assert.equal(updates,1);assert.notEqual(clock.snapshot(),anchor);assert.equal(clock.snapshot()?.serverAt,anchor.serverAt);assert.equal(clock.snapshot()?.rtt,20);assert.equal(clock.now(0),11110);clock.tick(NaN);assert.equal(updates,1);
});
