import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createWorkspace} from '../src/workspace.mjs';
import {rebaseWritingAnchor,writingRequestMessage} from '../src/writing-anchor.mjs';

async function fixture(run) {
  const directory=await mkdtemp(join(tmpdir(),'writer-ai-'));
  const workspace=createWorkspace(directory);await workspace.init();
  const doc=await workspace.saveDocument({path:'文稿/测试.md',body:'前半句，后半句。\n第二段保留。'});
  const create=async()=> (await workspace.createWritingRequest({path:doc.path,title:doc.title,body:doc.body,offset:4,instruction:'写一段对话'})).request;
  const publish=item=>workspace.publishWritingSuggestion({requestId:item.id,generation:item.generation,text:'「你好。」'});
  try {await run({workspace,doc,create,publish,directory});}
  finally {await rm(directory,{recursive:true,force:true});}
}

test('AI content returns to a durable proposal; edits, acceptance, backups and duplicate protection',()=>fixture(async({workspace,doc,create,publish,directory})=>{
  const item=await create();
  const message=writingRequestMessage(item);
  assert.deepEqual(message._meta,{'openai/message':{target:'active',send:true}});
  assert.ok(message.content[0].text.includes(item.instruction));
  assert.equal(message.content[0].text.includes(item.id),false);
  assert.equal(message.content[0].text.includes('publish_writing_suggestion'),false);
  assert.equal(message.content[0].text.includes('插入位置上下文'),false);
  const context=await workspace.getWritingRequest({path:doc.path,instruction:item.instruction});
  assert.equal(context.requestId,item.id);assert.equal(context.generation,1);
  assert.equal(context.context.before,doc.body.slice(0,4));
  assert.equal(context.context.after,doc.body.slice(4));
  await publish(item);
  assert.equal((await workspace.readDocument(doc.path)).body,doc.body);
  const reloaded=createWorkspace(directory);
  let [ready]=(await reloaded.writingRequests({path:doc.path})).requests;
  assert.equal(ready.text,'「你好。」');
  const edited=(await workspace.updateWritingRequest({id:ready.id,version:ready.version,action:'edit',text:'  「你是谁？」\n我问。'})).request;
  await assert.rejects(workspace.updateWritingRequest({id:ready.id,version:ready.version,action:'discard'}),/已更新/);
  const result=await workspace.updateWritingRequest({id:edited.id,version:edited.version,action:'accept',body:doc.body,revision:doc.revision});
  assert.equal(result.document.body,'前半句，  「你是谁？」\n我问。后半句。\n第二段保留。');
  assert.equal((await workspace.writingRequests({path:doc.path})).requests.length,0);
  assert.equal((await workspace.readDocument(doc.path)).body,result.document.body);
  await assert.rejects(publish(item),/已结束/);
  await assert.rejects(workspace.updateWritingRequest({id:edited.id,version:result.request.version,action:'accept',body:result.document.body,revision:result.document.revision}),/已处理/);
}));

test('generated paragraphs use single newlines; intentional user-edited empty lines are preserved',()=>fixture(async({workspace,doc,create})=>{
  const item=await create();
  await workspace.publishWritingSuggestion({requestId:item.id,generation:1,text:'第一段。\r\n\r\n　\r\n第二段。'});
  let [ready]=(await workspace.writingRequests({path:doc.path})).requests;
  assert.equal(ready.text,'第一段。\n第二段。');
  const result=await workspace.updateWritingRequest({id:ready.id,version:ready.version,action:'accept',body:doc.body,revision:doc.revision});
  assert.equal(result.document.body,doc.body.slice(0,4)+'第一段。\n第二段。'+doc.body.slice(4));
  const manual=(await workspace.createWritingRequest({path:'',title:'草稿',body:'',offset:0,instruction:'写两段'})).request;
  await workspace.publishWritingSuggestion({requestId:manual.id,generation:1,text:'甲\n\n乙'});
  [ready]=(await workspace.writingRequests({path:''})).requests;
  ready=(await workspace.updateWritingRequest({id:ready.id,version:ready.version,action:'edit',text:'甲\n\n乙'})).request;
  assert.equal(ready.text,'甲\n\n乙');
}));

test('hidden context resolves regeneration without exposing it in the chat or guessing an ambiguous request',()=>fixture(async({workspace,doc,create,publish})=>{
  const item=await create();await publish(item);
  let [ready]=(await workspace.writingRequests({path:doc.path})).requests;
  ready=(await workspace.updateWritingRequest({id:ready.id,version:ready.version,action:'regenerate',instruction:'保留原要求，换一种写法'})).request;
  const message=writingRequestMessage(ready).content[0].text;
  assert.equal(message.includes(ready.text),false);
  assert.equal(message.includes(ready.id),false);
  const context=await workspace.getWritingRequest({path:doc.path,instruction:ready.instruction});
  assert.equal(context.generation,2);assert.equal(context.previousText,ready.text);
  await assert.rejects(workspace.getWritingRequest({path:'',instruction:ready.instruction}),/未找到/);
  await assert.rejects(workspace.getWritingRequest({path:'../逃逸.md',instruction:ready.instruction}));
  await create();await create();
  await assert.rejects(workspace.getWritingRequest({path:doc.path,instruction:'写一段对话'}),/多条/);
}));

test('regeneration isolates generations and rejection leaves the manuscript intact',()=>fixture(async({workspace,doc,create,publish})=>{
  const item=await create();await publish(item);
  let [ready]=(await workspace.writingRequests({path:doc.path})).requests;
  const again=(await workspace.updateWritingRequest({id:ready.id,version:ready.version,action:'regenerate',instruction:'保留原要求，增加动作'})).request;
  assert.equal(again.generation,2);assert.equal(again.text,'「你好。」');
  await assert.rejects(publish(item),/已结束/);
  await workspace.publishWritingSuggestion({requestId:again.id,generation:2,text:'第二版'});
  [ready]=(await workspace.writingRequests({path:doc.path})).requests;
  await workspace.updateWritingRequest({id:ready.id,version:ready.version,action:'discard'});
  assert.equal((await workspace.readDocument(doc.path)).body,doc.body);
  await assert.rejects(workspace.publishWritingSuggestion({requestId:item.id,generation:2,text:'迟到的内容'}),/已结束/);
}));

test('safe rebase preserves edits before the anchor; changing its neighborhood requires relocation',()=>fixture(async({workspace,doc,create,publish})=>{
  const item=await create();await publish(item);
  let [ready]=(await workspace.writingRequests({path:doc.path})).requests;
  const changed=await workspace.saveDocument({...doc,body:'新增开头。'+doc.body,revision:doc.revision});
  const accepted=await workspace.updateWritingRequest({id:ready.id,version:ready.version,action:'accept',body:changed.body,revision:changed.revision});
  assert.equal(accepted.document.body,'新增开头。前半句，「你好。」后半句。\n第二段保留。');
  const another=(await workspace.createWritingRequest({path:doc.path,title:doc.title,body:accepted.document.body,offset:7,instruction:'补一句'})).request;
  await publish(another);
  [ready]=(await workspace.writingRequests({path:doc.path})).requests;
  const modified=await workspace.saveDocument({...accepted.document,body:'整段重写了'});
  await assert.rejects(workspace.updateWritingRequest({id:ready.id,version:ready.version,action:'accept',body:modified.body,revision:modified.revision}),/重新定位/);
  ready=(await workspace.updateWritingRequest({id:ready.id,version:ready.version,action:'relocate',body:modified.body,offset:modified.body.length})).request;
  const moved=await workspace.updateWritingRequest({id:ready.id,version:ready.version,action:'accept',body:modified.body,revision:modified.revision});
  assert.equal(moved.document.body,'整段重写了「你好。」');
}));

test('external changes and deleted files cannot be overwritten or recreated',()=>fixture(async({workspace,doc,create,publish,directory})=>{
  const item=await create();await publish(item);
  const [ready]=(await workspace.writingRequests({path:doc.path})).requests;
  await writeFile(join(directory,'码字工作台',doc.path),'外部写入','utf8');
  await assert.rejects(workspace.updateWritingRequest({id:ready.id,version:ready.version,action:'accept',body:doc.body,revision:doc.revision}),/已改变/);
  assert.equal((await workspace.readDocument(doc.path)).body,'外部写入');
  const current=await workspace.readDocument(doc.path);await workspace.deleteDocument(current);
  await assert.rejects(workspace.updateWritingRequest({id:ready.id,version:ready.version,action:'accept',body:current.body,revision:current.revision}));
  assert.equal((await workspace.writingRequests({path:doc.path})).requests.length,1);
}));

test('draft acceptance and interrupted acceptance receipts recover without duplicate insertion',()=>fixture(async({workspace,directory})=>{
  await workspace.saveDraft({title:'草稿',body:'原文'});
  const item=(await workspace.createWritingRequest({path:'',title:'草稿',body:'原文',offset:2,instruction:'续写'})).request;
  await workspace.publishWritingSuggestion({requestId:item.id,generation:1,text:'后续'});
  const [ready]=(await workspace.writingRequests({path:''})).requests;
  const result=await workspace.updateWritingRequest({id:ready.id,version:ready.version,action:'accept',body:'原文'});
  assert.equal(result.document.body,'原文后续');
  const file=join(directory,'码字工作台','数据','AI辅助',item.id+'.json');
  const receipt=JSON.parse(await readFile(file,'utf8'));receipt.status='accepting';await writeFile(file,JSON.stringify(receipt));
  assert.equal((await workspace.writingRequests({path:''})).requests.length,0);
  assert.equal((await workspace.info()).draft.body,'原文后续');
}));

test('invalid anchors, paths and oversized/empty answers are rejected',()=>fixture(async({workspace,doc,create})=>{
  const item=await create();
  assert.equal((await workspace.writingRequests({path:''})).requests.length,0);
  await assert.rejects(workspace.createWritingRequest({path:'../逃逸.md',title:'x',body:'a',offset:0,instruction:'写'}));
  await assert.rejects(workspace.createWritingRequest({path:doc.path,title:'x',body:'a',offset:2,instruction:'写'}));
  await assert.rejects(workspace.publishWritingSuggestion({requestId:item.id,generation:1,text:'  '}));
  await assert.rejects(workspace.publishWritingSuggestion({requestId:item.id,generation:1,text:'字'.repeat(100001)}));
  assert.equal(rebaseWritingAnchor('前半句，后半句','全段重写了',4),null);
}));

test('CRLF manuscripts keep their line endings and use editor offsets',()=>fixture(async({workspace})=>{
  const doc=await workspace.saveDocument({path:'文稿/Windows.md',body:'第一段\r\n第二段。'});
  const item=(await workspace.createWritingRequest({path:doc.path,title:doc.title,body:'第一段\n第二段。',offset:7,instruction:'插入'})).request;
  await workspace.publishWritingSuggestion({requestId:item.id,generation:1,text:'插入\n下一行'});
  const [ready]=(await workspace.writingRequests({path:doc.path})).requests;
  const result=await workspace.updateWritingRequest({id:ready.id,version:ready.version,action:'accept',body:'第一段\n第二段。',revision:doc.revision});
  assert.equal(result.document.body,'第一段\r\n第二段插入\r\n下一行。');
}));
