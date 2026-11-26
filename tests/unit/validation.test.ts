import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeNickname, normalizeAnswer, visibleLength, randomEnglishNickname } from '../../src/shared/validation.js';

test('4.5 共用可見字元規則：暱稱 1／20／21、完整 emoji、組合字及修剪',()=>{
  for(const char of ['中','A','👨‍👩‍👧‍👦','e\u0301']){
    assert.equal(visibleLength(char),1);
    for(const n of [1,20])assert.equal(normalizeNickname('  '+char.repeat(n)+'　'),char.repeat(n));
    assert.throws(()=>normalizeNickname(char.repeat(21)),{code:'INVALID_NICKNAME'});
  }
  for(const value of ['', '　 \t', 'a\nb','a\rb','a\r\nb','a\u0085b','a\u2028b','a\u2029b',null,3])assert.throws(()=>normalizeNickname(value),{code:'INVALID_NICKNAME'});
  assert.equal(visibleLength(normalizeNickname(' a b ')),3);
});
test('4.5 答案 1／200／201、全空白、emoji 與多行；文字不當成 HTML',()=>{
  for(const char of ['中','👩🏽‍💻','e\u0301']){
    for(const n of [1,200])assert.equal(normalizeAnswer('\n '+char.repeat(n)+' \n'),char.repeat(n));
    assert.throws(()=>normalizeAnswer(char.repeat(201)),{code:'INVALID_ANSWER'});
  }
  for(const value of ['', '　 \n\t',null,[]])assert.throws(()=>normalizeAnswer(value),{code:'INVALID_ANSWER'});
  assert.equal(normalizeAnswer(' 一\n二 '),'一\n二');
  assert.equal(normalizeAnswer('<script>test</script>'),'<script>test</script>');
});
test('4.4 隨機名字永遠是合法英文名字，允許重複',()=>{
  for(let i=0;i<100;i++){const value=randomEnglishNickname();assert.match(value,/^[A-Za-z]+$/u);assert.equal(normalizeNickname(value),value);}
});
