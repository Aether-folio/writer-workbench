import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,unlink,rmdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createAnnotationStore} from '../src/annotations.mjs';

async function withStore(run) {
  const directory = await mkdtemp(join(tmpdir(),'writer-annotations-'));
  const path = join(directory,'annotations.json');
  try { await run(createAnnotationStore(path),path); }
  finally { await unlink(path).catch(()=>{}); await rmdir(directory); }
}
test('批注新建、重启读取及修改保留原文快照',()=>withStore(async(store,path)=>{
  assert.deepEqual(await store.list(),[]);
  const original={title:'测试章节',quote:' 所选原文\n第二行 ',body:'伏笔应在前文出现。'};
  const note=await store.save(original);
  assert.equal(note.quote,original.quote);
  const reopened=createAnnotationStore(path);
  assert.deepEqual(await reopened.list(),[note]);
  const edited=await reopened.save({...note,quote:'尝试覆盖原文',title:'尝试覆盖标题',body:'修改后的批注'});
  assert.equal(edited.id,note.id);
  assert.equal(edited.quote,original.quote);
  assert.equal(edited.title,original.title);
  assert.equal(edited.createdAt,note.createdAt);
  assert.equal((await store.list())[0].body,'修改后的批注');
}));
test('并行保存不会丢记录，无效保存不会覆盖已有批注',()=>withStore(async(store,path)=>{
  await Promise.all(Array.from({length:8},(_,i)=>store.save({title:'测试',quote:`原文${i}`,body:`批注${i}`})));
  const before=await readFile(path,'utf8');
  assert.equal((await store.list()).length,8);
  await assert.rejects(store.save({title:'测试',quote:'原文',body:'   '}));
  await assert.rejects(store.save({id:'00000000-0000-4000-8000-000000000000',title:'测试',quote:'原文',body:'不存在'}));
  assert.equal(await readFile(path,'utf8'),before);
}));
test('损坏的批注文件不会被空列表或新批注覆盖',()=>withStore(async(store,path)=>{
  await writeFile(path,'invalid json','utf8');
  await assert.rejects(store.list());
  await assert.rejects(store.save({title:'测试',quote:'原文',body:'批注'}));
  assert.equal(await readFile(path,'utf8'),'invalid json');
}));
