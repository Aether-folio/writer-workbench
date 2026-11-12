import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {join,resolve,sep} from 'node:path';
import {createWorkspace} from '../src/workspace.mjs';
test('more than 1000 chapters remain visible and searchable; CRLF search uses editor offsets',async()=>{
 const base=resolve('.test-temp');await mkdir(base,{recursive:true});const root=await mkdtemp(join(base,'scale-'));
 try{const store=createWorkspace(root);await store.init();await store.createWork({name:'长篇测试'});const folder=join(store.root,'长篇测试/正文');
 for(let start=0;start<1005;start+=40)await Promise.all(Array.from({length:Math.min(40,1005-start)},(_,i)=>{const n=start+i;return writeFile(join(folder,String(n).padStart(4,'0')+'.md'),n===1004?'开头。\r\n最后一章的检索词。':'第'+n+'章正文。');}));
 let began=performance.now();const info=await store.info();const scanMs=Math.round(performance.now()-began);assert.equal(info.files.length,1005);
 began=performance.now();const result=await store.searchDocuments({workPath:'长篇测试',query:'检索词'});const searchMs=Math.round(performance.now()-began);assert.equal(result.total,1);assert.equal(result.matches[0].path,'长篇测试/正文/1004.md');assert.equal(result.matches[0].offset,'开头。\n最后一章的'.length);
 const path='长篇测试/正文/0000.md',body='长段落。'.repeat(25000);let doc=await store.readDocument(path);doc=await store.saveDocument({...doc,body});for(let i=0;i<50;i++)await store.createWritingRequest({path,title:'压测',body,offset:i*2000,instruction:'批注'+i,draft:true});
 began=performance.now();for(let i=0;i<5;i++)assert.equal((await store.writingRequests({path,allDrafts:true})).drafts.length,50);const pollMs=Math.round((performance.now()-began)/5);
 const measurement={chapters:1005,chapterCharacters:body.length,notes:50,scanMs,wholeBookSearchMs:searchMs,averageCachedPollMs:pollMs};await mkdir('test-results',{recursive:true});await writeFile('test-results/scale.json',JSON.stringify(measurement,null,2));console.log('SCALE',JSON.stringify(measurement));
 }finally{if(!root.startsWith(base+sep))throw Error('Unsafe cleanup');await rm(root,{recursive:true,force:true});}
});
