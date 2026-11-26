import test from 'node:test';
import assert from 'node:assert/strict';
import { parseGuidedNotes,parseSheetsUrl } from '../../src/server/guided-notes.js';
import { f1,f2,syntheticF3 } from '../fixtures/catalog.js';
import { sheetFixture } from '../helpers/sheets.js';

test('6.4／6.5 固定單題六題六欄；題組混合四題六欄且定位與標記完整',()=>{
  const one=parseGuidedNotes(sheetFixture(f1),'1',2);assert.equal(one.questions.length,6);assert.deepEqual(one.questions.flatMap(q=>q.fields.map(f=>f.answerRange)),['G5:H5','G7:H7','G9:H9','G11:H11','G13:H13','G15:H15']);
  const two=parseGuidedNotes(sheetFixture(f2),'1',20);assert.deepEqual(two.questions.map(q=>q.kind),['GROUP','GROUP','SINGLE','SINGLE']);assert.deepEqual(two.questions.flatMap(q=>q.fields.map(f=>f.answerRange)),['H5','H6','H8','H9','G11:H11','G13:H13']);assert.equal(two.questions[0]!.fields[0]!.label,'（1）');
  const large=parseGuidedNotes(sheetFixture(syntheticF3()),'1',2);assert.equal(large.questions.length,60);assert.equal(large.questions.flatMap(q=>q.fields).length,140);assert.equal(large.questions.at(-1)!.fields.length,4);
});
test('6.4 最後題目、表頭、重複題號或合併不明確時整次拒絕',()=>{
  const variants=[{...f1,cells:{...f1.cells,B4:'錯誤'}},{...f1,cells:{...f1.cells,B15:f1.cells.B5!}},{...f1,merges:f1.merges.filter(x=>x!=='G15:H15')},{...f2,cells:{...f2.cells,G6:''}},{...f2,merges:[...f2.merges,'H5:H6']}];
  for(const f of variants)assert.throws(()=>parseGuidedNotes(sheetFixture(f),'1',2),{code:'GUIDED_NOTES_FORMAT'});
  for(const groups of [1,21,2.5,NaN])assert.throws(()=>parseGuidedNotes(sheetFixture(f1),'1',groups),{code:'INVALID_GROUP_COUNT'});
});
test('6.6 已有答案與格式只保存為原始基準，不變成題目／提交或執行 HTML',()=>{
  const source=sheetFixture({...f1,cells:{...f1.cells,G5:'<script>舊答案</script>'}}),before=JSON.stringify(source);
  source.sheets[0]!.data![0]!.rowData![4]!.values![6]!.textFormatRuns=[{startIndex:0,format:{fontSize:9}}];
  const parsed=parseGuidedNotes(source,'1',2);assert.equal(parsed.questions.length,6);assert.ok(!parsed.questions[0]!.fields[0]!.prompt.includes('舊答案'));
  assert.ok(JSON.stringify(parsed.source.snapshot).includes('舊答案'));assert.ok(JSON.stringify(parsed.questions[0]!.fields[0]!.original).includes('textFormatRuns'));
  assert.equal((parsed.questions[0]!.fields[0]!.original as {rowMetadata:{pixelSize:number}}).rowMetadata.pixelSize,24);assert.ok(before.includes('舊答案'));
});
test('6.3 網址、gid、query／hash 與組數契約不猜測其他文件',()=>{
  assert.deepEqual(parseSheetsUrl('https://docs.google.com/spreadsheets/d/copy-id/edit?gid=0#gid=0'),{spreadsheetId:'copy-id',sheetId:'0'});
  assert.deepEqual(parseSheetsUrl('https://docs.google.com/spreadsheets/u/0/d/copy-id/edit?usp=sharing'),{spreadsheetId:'copy-id',sheetId:null});
  for(const url of ['http://docs.google.com/spreadsheets/d/id/edit','https://evil.test/spreadsheets/d/id/edit','https://docs.google.com@evil.test/spreadsheets/d/id/edit','https://docs.google.com/spreadsheets/d/id/edit?gid=-1','https://docs.google.com/spreadsheets/d/id/edit?gid=1#gid=2','https://docs.google.com/spreadsheets/d/id/edit?gid=1&gid=2'])assert.throws(()=>parseSheetsUrl(url),{code:'INVALID_SHEETS_URL'});
});
