import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,readdir,rm,symlink,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {createWorkspace} from '../src/workspace.mjs';
import {splitDays,dayKey,editCounts,aggregateDays} from '../src/writing-records.mjs';

async function fixture(run) {
  const directory=await mkdtemp(join(tmpdir(),'writer-workspace-test-'));
  const store=createWorkspace(directory);
  try {await store.init();await run(store,directory);}
  finally {assert.ok(resolve(directory).startsWith(resolve(tmpdir())+sep));assert.ok(directory.includes('writer-workspace-test-'));await rm(directory,{recursive:true,force:true});}
}
test('工作区文稿可创建、扫描和编辑，外部冲突保留原文件，覆盖前保留备份',()=>fixture(async store=>{
  const first=await store.saveDocument({path:'文稿/第一章.md',body:'作者输入的文字'});
  assert.equal((await store.scan())[0].path,first.path);
  assert.equal((await store.readDocument(first.path)).body,first.body);
  await assert.rejects(store.saveDocument({path:first.path,body:'不应覆盖'}));
  const edited=await store.saveDocument({path:first.path,revision:first.revision,body:'作者修改后的文字'});
  assert.notEqual(edited.revision,first.revision);
  const backups=await readdir(join(store.root,'数据','备份'));
  assert.equal(await readFile(join(store.root,'数据','备份',backups[0]),'utf8'),first.body);
  await writeFile(join(store.root,first.path),'外部修改','utf8');
  await assert.rejects(store.saveDocument({path:first.path,revision:edited.revision,body:'不应覆盖外部修改'}));
  assert.equal((await store.readDocument(first.path)).body,'外部修改');
}));
test('文稿可重命名：保留扩展名、同名不覆盖、旧版本与越界被拒绝',()=>fixture(async store=>{
  const first=await store.saveDocument({path:'文稿/第一章.md',body:'章节正文'});
  const renamed=await store.renameDocument({path:first.path,name:'第001章_初见',revision:first.revision});
  assert.equal(renamed.previousPath,'文稿/第一章.md');
  assert.equal(renamed.document.path,'文稿/第001章_初见.md');
  assert.equal(renamed.document.title,'第001章_初见');
  assert.equal(renamed.document.body,'章节正文');
  assert.deepEqual((await store.scan()).map(file=>file.path),['文稿/第001章_初见.md']);
  await assert.rejects(store.readDocument('文稿/第一章.md'));
  const same=await store.renameDocument({path:renamed.document.path,name:'第001章_初见.md'});
  assert.equal(same.document.path,renamed.document.path);
  await assert.rejects(store.renameDocument({path:renamed.document.path,name:''}),/名称/);
  for(const name of ['../越界','甲/乙','甲\\乙','.隐藏','NUL'])await assert.rejects(store.renameDocument({path:renamed.document.path,name}));
  await store.saveDocument({path:'文稿/已存在.md',body:'另一个文稿'});
  await assert.rejects(store.renameDocument({path:renamed.document.path,name:'已存在'}),/同名/);
  assert.equal((await store.readDocument('文稿/已存在.md')).body,'另一个文稿');
  await assert.rejects(store.renameDocument({path:renamed.document.path,name:'另一个名字',revision:'0'.repeat(64)}),/已在其他地方修改/);
  assert.equal((await store.readDocument(renamed.document.path)).body,'章节正文');
  const txt=await store.renameDocument({path:renamed.document.path,name:'改过的名字.txt'});
  assert.equal(txt.document.path,'文稿/改过的名字.md');
  assert.equal((await store.readDocument(txt.document.path)).body,'章节正文');
}));
test('文件夹可重命名：作品改名迁移封面，子文件夹连同文稿一起移动',()=>fixture(async store=>{
  const cover='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j4V0AAAAASUVORK5CYII=';
  await store.createWork({name:'旧作品'});
  await store.saveDocument({path:'旧作品/正文/第一章.md',body:'章节正文'});
  await store.saveStatsPreferences({fields:['work'],workPath:'旧作品',coverDataUrl:cover});
  const renamedWork=await store.renameFolder({path:'旧作品',name:'新作品'});
  assert.equal(renamedWork.folder.path,'新作品');
  assert.equal((await store.readDocument('新作品/正文/第一章.md')).body,'章节正文');
  assert.equal((await store.statsPreferences({workPath:'新作品'})).coverDataUrl,cover);
  const preferences=JSON.parse(await readFile(join(store.root,'数据','悬浮窗.json'),'utf8'));
  assert.ok(!('旧作品' in preferences.covers));assert.ok('新作品' in preferences.covers);
  assert.ok((await store.info()).works.some(work=>work.path==='新作品'));
  const renamedFolder=await store.renameFolder({path:'新作品/正文',name:'第一卷'});
  assert.equal(renamedFolder.folder.path,'新作品/第一卷');
  assert.deepEqual((await store.scan()).map(file=>file.path),['新作品/第一卷/第一章.md']);
  const same=await store.renameFolder({path:'新作品/第一卷',name:'第一卷'});
  assert.equal(same.folder.path,'新作品/第一卷');
  for(const name of ['','数据','.隐藏','../越界','甲/乙','甲\\乙','末尾.','NUL','COM1'])await assert.rejects(store.renameFolder({path:'新作品/第一卷',name}));
  await assert.rejects(store.renameFolder({path:'新作品/第一卷/第一章.md',name:'另一个'}),/只能重命名文件夹/);
  await assert.rejects(store.renameFolder({path:'新作品/第一卷',name:'草稿'}),/同名/);
  await assert.rejects(store.renameFolder({path:'新作品',name:'../越界'}));
  assert.deepEqual((await store.scan()).map(file=>file.path),['新作品/第一卷/第一章.md']);
}));
test('文稿操作拒绝越界、数据文件和链接目录',()=>fixture(async(store,directory)=>{
  for(const path of ['../正文.md','数据/批注.md','D:/正文.md','文稿/../../正文.md','文稿/CON.txt','文稿/.secret.md']) {
    await assert.rejects(store.saveDocument({path,body:'不应写入'}));
  }
  await mkdir(join(directory,'outside'));
  await symlink(join(directory,'outside'),join(store.root,'文稿','链接'),'junction');
  await assert.rejects(store.saveDocument({path:'文稿/链接/越界.md',body:'不应写入'}));
  assert.deepEqual(await readdir(join(directory,'outside')),[]);
}));
test('草稿和背景重启可恢复，码字快照重试不重复累计且月历按天保留',()=>fixture(async(store,directory)=>{
  await store.saveDraft({title:'试写',body:'保留草稿'});
  await store.saveSettings({background:'#dce8d2'});
  const record={id:'test-session-day-file',day:'2026-11-01',path:'文稿/测试.md',title:'测试',added:120,deleted:20,activeMs:60000,idleMs:10000,startedAt:'2026-11-01T00:00:00.000Z',updatedAt:'2026-11-01T00:01:10.000Z'};
  await store.saveRecords([record]);await store.saveRecords([record]);
  const restarted=createWorkspace(directory);
  const info=await restarted.info();
  assert.equal(info.draft.body,'保留草稿');assert.equal(info.settings.background,'#dce8d2');
  const history=await restarted.history('2026-11');
  assert.equal(history.records.length,1);assert.equal(aggregateDays(history.records)['2026-11-01'].added,120);
  await store.saveRecords([{...record,added:100,activeMs:50000}]);
  assert.equal((await store.history('2026-11')).records[0].added,120);
  assert.deepEqual((await store.history('2026-12')).records,[]);
}));
test('删除移入回收站并可恢复，恢复不覆盖同名文稿',()=>fixture(async store=>{
  const first=await store.saveDocument({path:'文稿/卷一/测试.md',body:'保留的章节正文'});
  const removed=await store.deleteDocument({path:first.path,revision:first.revision});
  assert.equal(removed.deleted,true);
  assert.deepEqual(await store.scan(),[]);
  await assert.rejects(store.readDocument(first.path));
  const trash=await store.listTrash();
  assert.equal(trash.entries.length,1);assert.equal(trash.entries[0].path,first.path);
  assert.equal(await readFile(join(store.root,'数据','回收站',removed.entry.id,'测试.md'),'utf8'),first.body);
  await store.saveDocument({path:first.path,body:'另一个同名章节'});
  await assert.rejects(store.restoreDocument({id:removed.entry.id}),/同名/);
  assert.equal((await store.readDocument(first.path)).body,'另一个同名章节');
  assert.equal((await store.listTrash()).entries.length,1);
  const sameName=await store.readDocument(first.path);
  await store.deleteDocument({path:first.path,revision:sameName.revision});
  await store.restoreDocument({id:removed.entry.id});
  assert.equal((await store.readDocument(first.path)).body,first.body);
  assert.equal((await store.listTrash()).entries.length,1);
  await assert.rejects(store.restoreDocument({id:removed.entry.id}),/已恢复/);
}));

test('删除拒绝旧版本、越界和链接，回收站数据不能用于越界恢复',()=>fixture(async(store,directory)=>{
  const first=await store.saveDocument({path:'文稿/测试.md',body:'最初正文'});
  await writeFile(join(store.root,first.path),'外部更新','utf8');
  await assert.rejects(store.deleteDocument({path:first.path,revision:first.revision}),/已在其他地方修改/);
  assert.equal((await store.readDocument(first.path)).body,'外部更新');
  assert.deepEqual((await store.listTrash()).entries,[]);
  for(const path of ['../正文.md','数据/批注.md'])await assert.rejects(store.deleteDocument({path,revision:first.revision}));
  await mkdir(join(directory,'outside'));
  await writeFile(join(directory,'outside','原稿.md'),'外部原稿');
  await symlink(join(directory,'outside'),join(store.root,'文稿','链接'),'junction');
  await assert.rejects(store.deleteDocument({path:'文稿/链接/原稿.md',revision:first.revision}));
  assert.equal(await readFile(join(directory,'outside','原稿.md'),'utf8'),'外部原稿');
  const latest=await store.readDocument(first.path),removed=await store.deleteDocument({path:first.path,revision:latest.revision});
  const manifest=join(store.root,'数据','回收站',removed.entry.id,'entry.json');
  await writeFile(manifest,JSON.stringify({...removed.entry,path:'../越界.md'}));
  await assert.rejects(store.restoreDocument({id:removed.entry.id}),/文稿路径/);
  assert.equal(await readFile(join(store.root,'数据','回收站',removed.entry.id,'测试.md'),'utf8'),'外部更新');
}));

test('添加作品创建三个空文件夹，作品名与文稿路径重启可恢复',()=>fixture(async(store,directory)=>{
  const result=await store.createWork({name:'示例长篇'});
  assert.equal(result.work.name,'示例长篇');
  assert.deepEqual(new Set(await readdir(join(store.root,result.work.path))),new Set(['设定','正文','草稿']));
  assert.deepEqual(await store.scan(),[]);
  const info=await createWorkspace(directory).info();
  assert.deepEqual(info.works,[{name:result.work.name,path:result.work.path}]);
  assert.ok(info.directories.some(folder=>folder.path===result.work.path+'/设定'));
  assert.ok(info.directories.some(folder=>folder.path===result.work.path+'/草稿'));
  await store.saveDocument({path:result.work.path+'/正文/第一章.md',body:'章节正文'});
  await store.saveDocument({path:result.work.path+'/设定/人物.md',body:'人物资料'});
  await assert.rejects(store.createWork({name:result.work.name}),/同名/);
  assert.equal((await store.readDocument(result.work.path+'/正文/第一章.md')).body,'章节正文');
  for(const name of ['../越界','甲/乙','甲\\乙','..','.hidden','NUL','数据','末尾.'])await assert.rejects(store.createWork({name}));
}));

test('悬浮窗信息选择持久化，作品封面互不串用，取消封面不删除其他作品图片',()=>fixture(async(store,directory)=>{
  await store.createWork({name:'作品甲'});await store.createWork({name:'作品乙'});
  const cover='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j4V0AAAAASUVORK5CYII=';
  await store.saveStatsPreferences({fields:['work','cover','words'],workPath:'作品甲',coverDataUrl:cover});
  const restarted=createWorkspace(directory);
  assert.equal((await restarted.statsPreferences({workPath:'作品甲'})).coverDataUrl,cover);
  assert.equal((await restarted.statsPreferences({workPath:'作品乙'})).coverDataUrl,null);
  assert.deepEqual((await restarted.statsPreferences()).fields,['work','cover','words']);
  await store.saveStatsPreferences({fields:['cover'],workPath:'作品乙',coverDataUrl:cover});
  await store.saveStatsPreferences({fields:['words'],workPath:'作品甲',coverDataUrl:null});
  assert.equal((await store.statsPreferences({workPath:'作品甲'})).coverDataUrl,null);
  assert.equal((await store.statsPreferences({workPath:'作品乙'})).coverDataUrl,cover);
  await assert.rejects(store.saveStatsPreferences({fields:['idle'],workPath:'../作品',coverDataUrl:cover}));
  await assert.rejects(store.saveStatsPreferences({fields:['words','words']}));
  await assert.rejects(store.saveStatsPreferences({fields:['idle'],workPath:'作品乙',coverDataUrl:'data:image/png;base64,YWJj'}),/图片格式/);
  assert.deepEqual((await store.statsPreferences()).fields,['words']);
  assert.equal((await store.statsPreferences({workPath:'作品乙'})).coverDataUrl,cover);
  assert.ok((await store.scan()).every(file=>!file.path.startsWith('数据/')));
}));

test('萌宠选择全局持久化，旧悬浮窗配置兼容，其他设置保存保留萌宠与关闭时的选择',()=>fixture(async(store,directory)=>{
  await writeFile(join(store.root,'数据','悬浮窗.json'),JSON.stringify({version:1,fields:['words'],covers:{}}));
  assert.deepEqual((await store.statsPreferences()).pet,{enabled:false,character:'dragon'});
  await store.saveStatsPreferences({fields:['words'],pet:{enabled:true,character:'fish'}});
  const restarted=createWorkspace(directory);
  assert.deepEqual((await restarted.statsPreferences()).pet,{enabled:true,character:'fish'});
  await restarted.createWork({name:'萌宠测试作品'});
  assert.deepEqual((await restarted.statsPreferences({workPath:'萌宠测试作品'})).pet,{enabled:true,character:'fish'});
  await restarted.saveStatsPreferences({fields:['active'],workPath:'萌宠测试作品'});
  assert.deepEqual((await store.statsPreferences()).pet,{enabled:true,character:'fish'});
  await assert.rejects(store.saveStatsPreferences({fields:[],pet:{enabled:true,character:'other'}}));
  await assert.rejects(store.saveStatsPreferences({fields:[],pet:{enabled:'false',character:'fish'}}));
  assert.deepEqual((await store.statsPreferences()).fields,['active']);
  await store.saveStatsPreferences({fields:['active'],pet:{enabled:false,character:'fish'}});
  const saved=JSON.parse(await readFile(join(store.root,'数据','悬浮窗.json'),'utf8'));
  assert.deepEqual(saved.pet,{enabled:false,character:'fish'});
  assert.deepEqual((await createWorkspace(directory).statsPreferences()).pet,saved.pet);
}));

test('北京时间跨天分配时长，文字重写统计新增与删除',()=>{
  const start=Date.parse('2026-11-01T15:59:50Z'),end=Date.parse('2026-11-01T16:00:15Z');
  assert.equal(dayKey(end),'2026-11-02');
  assert.deepEqual(splitDays(start,end),[{day:'2026-11-01',milliseconds:10000},{day:'2026-11-02',milliseconds:15000}]);
  assert.deepEqual(editCounts('甲乙丙','甲丁戊丙'),{added:2,deleted:1});
  assert.deepEqual(editCounts('已有正文','已有正文'),{added:0,deleted:0});
  assert.deepEqual(editCounts('\u{20000}','\u{20400}'),{added:1,deleted:1});
});

test('彻底删除仅移除指定回收站条目，不影响文稿及其他回收站记录',()=>fixture(async(store,directory)=>{
  const first=await store.saveDocument({path:'文稿/删除甲.md',body:'原文甲'});
  const second=await store.saveDocument({path:'文稿/删除乙.md',body:'原文乙'});
  const kept=await store.saveDocument({path:'文稿/保留.md',body:'保留内容'});
  const a=await store.deleteDocument({path:first.path,revision:first.revision});
  const b=await store.deleteDocument({path:second.path,revision:second.revision});
  await assert.rejects(store.deleteTrash({id:'../文稿'}));
  const outside=join(directory,'码字工作台','数据','回收站',a.entry.id,'未知.txt');
  await writeFile(outside,'未知文件');
  await assert.rejects(store.deleteTrash({id:a.entry.id}),/未知文件/);
  assert.equal((await store.listTrash()).entries.length,2);
  await rm(outside);
  assert.deepEqual(await store.deleteTrash({id:a.entry.id}),{deleted:true,id:a.entry.id});
  assert.deepEqual((await store.listTrash()).entries.map(x=>x.id),[b.entry.id]);
  await assert.rejects(readFile(join(directory,'码字工作台','数据','回收站',a.entry.id,'entry.json')));
  await assert.rejects(store.restoreDocument({id:a.entry.id}));
  assert.equal((await store.readDocument(kept.path)).body,'保留内容');
  await store.restoreDocument({id:b.entry.id});
  await assert.rejects(store.deleteTrash({id:b.entry.id}),/已恢复/);
}));
test('彻底删除拒绝链接内容，保留链接目标',()=>fixture(async(store,directory)=>{
  const doc=await store.saveDocument({path:'文稿/链接测试.md',body:'内容'});
  const {entry}=await store.deleteDocument({path:doc.path,revision:doc.revision});
  const archived=join(directory,'码字工作台','数据','回收站',entry.id,'链接测试.md');
  const outside=join(directory,'外部目录');await mkdir(outside);await writeFile(join(outside,'原文.md'),'不应被删除');await rm(archived);
  await symlink(outside,archived,'junction');
  await assert.rejects(store.deleteTrash({id:entry.id}),/链接/);
  assert.equal(await readFile(join(outside,'原文.md'),'utf8'),'不应被删除');
}));
