import test from 'node:test';
import assert from 'node:assert/strict';
import {countWords,draftMessage,annotationBatchMessage,WritingClock} from '../src/core.mjs';

test('正文计数排除标题、标点和空白，支持非BMP汉字',()=>{
  assert.equal(countWords('# 第一章 标题\n你好，世界！abc123\n𠮷'),11);
});
test('选区只追加到当前聊天草稿，保留多段文本，不触发发送',()=>{
  const message=draftMessage('第一段。\n\n第二段。','试写');
  assert.deepEqual(message._meta,{'openai/message':{target:'active',send:false}});
  assert.equal(message.content.length,1);
  assert.ok(message.content[0].text.includes('> 第一段。\n> \n> 第二段。'));
  assert.throws(()=>draftMessage(' \n'));
});
test('批注汇总按文稿分组，保留原文与批注全文，追加到当前草稿且不改原记录',()=>{
  const records=[
    {title:'第二章',path:'作品/正文/第二章.md',quote:'原文甲\n\n下一段𠮷。',body:'修改因果。\n保留第二段。',updatedAt:'2026-11-02T01:00:00Z'},
    {title:'第一章',path:'作品/正文/第一章.md',quote:'原文乙',body:'补一个伏笔。',updatedAt:'2026-11-02T02:00:00Z'},
    {title:'第二章',path:'作品/正文/第二章.md',quote:'原文丙',body:'收紧结尾。',updatedAt:'2026-11-02T03:00:00Z'},
    {title:'临时灵感',quote:'草稿原文',body:'留待后续讨论。',updatedAt:'2026-11-02T00:00:00Z'},
  ];
  const original=structuredClone(records),message=annotationBatchMessage(records),text=message.content[0].text;
  assert.deepEqual(message._meta,{'openai/message':{target:'active',send:false}});
  assert.equal(message.role,'user');assert.equal(message.content.length,1);
  assert.ok(text.startsWith('\n\n【批注汇总 · 共 4 条】'));
  assert.equal(text.split('文稿：作品/正文/第二章.md').length-1,1);
  assert.ok(text.includes('文稿：作品/正文/第一章.md'));
  assert.ok(text.includes('文稿：临时灵感（草稿）'));
  assert.ok(text.includes('> 原文甲\n> \n> 下一段𠮷。'));
  for(const record of records)assert.ok(text.includes(record.body));
  assert.ok(text.includes('批注 4'));assert.deepEqual(records,original);
});

test('批注汇总不截断长原文与批注，无记录或缺少内容时拒绝生成',()=>{
  const quote='原'.repeat(24000),body='注'.repeat(3999)+'尾';
  const text=annotationBatchMessage([{quote,body,title:'长批注'}]).content[0].text;
  assert.ok(text.includes(quote));assert.ok(text.includes(body));
  assert.throws(()=>annotationBatchMessage([]),/暂无批注/);
  assert.throws(()=>annotationBatchMessage(null),/暂无批注/);
  assert.throws(()=>annotationBatchMessage([{quote:'原文',body:' '}]),/内容不完整/);
});

test('码字与空闲分开累计，暂停和恢复不计暂停时间',()=>{
  const clock=new WritingClock();
  clock.input(1000); clock.advance(46000);
  assert.equal(clock.activeMs,5000); assert.equal(clock.idleMs,40000);
  clock.pause(46000); clock.advance(200000);
  assert.equal(clock.activeMs,5000); assert.equal(clock.idleMs,40000);
  clock.input(200000); clock.advance(202000);
  assert.equal(clock.activeMs,7000); assert.equal(clock.idleMs,40000);
});

test('5秒边界开始空闲，再次输入恢复码字计时',()=>{
  const clock=new WritingClock();clock.input(1000);
  clock.advance(5999);assert.equal(clock.activeMs,4999);assert.equal(clock.idleMs,0);
  clock.advance(6000);assert.equal(clock.activeMs,5000);assert.equal(clock.idleMs,0);
  clock.advance(6500);assert.equal(clock.activeMs,5000);assert.equal(clock.idleMs,500);
  clock.input(7000);clock.advance(8000);
  assert.equal(clock.activeMs,6000);assert.equal(clock.idleMs,1000);
});
