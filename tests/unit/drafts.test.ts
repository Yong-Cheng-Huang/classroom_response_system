import test from 'node:test';
import assert from 'node:assert/strict';
import { DraftStore,type QuestionDraft } from '../../src/client/drafts.js';
const storage=()=>{const map=new Map<string,string>();return{map,getItem:(key:string)=>map.get(key)??null,setItem:(key:string,value:string)=>{map.set(key,value);},removeItem:(key:string)=>{map.delete(key);}};};
const owner={activityId:'activity',participantId:'person-a',groupId:'group-1'};

test('9.4 草稿依活動、組別、本人及題目隔離；原文字跨重建保留，移除只影響本題',()=>{
 const memory=storage(),a=new DraftStore(memory,owner),b=new DraftStore(memory,{...owner,participantId:'person-b'});
 const draft:QuestionDraft={version:1,answers:{f1:' 原樣\n👨‍👩‍👧‍👦 ',f2:'<script>字面文字</script>'}};
 a.save('q',draft);b.save('q',{version:1,answers:{f1:'另一個人的草稿'}});a.save('other',{version:1,answers:{f1:'另一題'}});
 assert.deepEqual(new DraftStore(memory,owner).read('q',['f1','f2']).draft,draft);
 assert.equal(b.read('q',['f1']).draft.answers.f1,'另一個人的草稿');
 assert.equal(new DraftStore(memory,{...owner,activityId:'new'}).read('q',['f1']).draft.answers.f1,'');
 assert.equal(new DraftStore(memory,{...owner,groupId:'group-2'}).read('q',['f1']).draft.answers.f1,'');
 a.remove('q');assert.equal(a.read('q',['f1']).draft.answers.f1,'');assert.equal(a.read('other',['f1']).draft.answers.f1,'另一題');assert.equal(b.read('q',['f1']).draft.answers.f1,'另一個人的草稿');
});
test('9.4 回覆不明的題組保留同一 requestId 與正規化完整內容；損壞或不相符資料不重送',()=>{
 const memory=storage(),store=new DraftStore(memory,owner),fields=['f1','f2','f3','f4'];
 const answers=Object.fromEntries(fields.map((id,i)=>[id,' 原答案'+i+' ']));
 const draft:QuestionDraft={version:1,answers,attempt:{requestId:'same-request',answers:fields.map((fieldId,i)=>({fieldId,text:'原答案'+i}))}};
 store.save('q',draft);assert.deepEqual(new DraftStore(memory,owner).read('q',fields).draft,draft);
 store.save('q',{...draft,answers:{...answers,f1:'被改動'}});assert.ok(store.read('q',fields).message);assert.equal(store.read('q',fields).draft.attempt,undefined);
 memory.map.set([...memory.map.keys()][0]!,'{bad');assert.ok(store.read('q',fields).message);
});
test('9.4 保存失敗不宣稱成功，讀取失敗回覆可顯示的中文訊息',()=>{
 const failing={getItem:()=>{throw new Error('storage blocked');},setItem:()=>{throw new Error('quota');},removeItem:()=>{}};
 const store=new DraftStore(failing,owner);assert.match(store.read('q',['f']).message,/草稿/);assert.throws(()=>store.save('q',{version:1,answers:{f:'尚未保存'}}));
});
