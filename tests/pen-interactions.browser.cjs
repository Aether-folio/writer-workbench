const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
const {fixture}=require('./app-fixture.cjs');
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function main(){const browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHANNEL?{channel:process.env.PLAYWRIGHT_CHANNEL}:{})});let active;
try{
 active=await fixture(browser);let {frame,page,workspace,doc}=active;
 async function note(start,instruction){await active.open(start);await frame.locator('#pen-instruction').fill(instruction);await frame.locator('#pen-save').click();await frame.locator('#pen-dialog').waitFor({state:'hidden'});await frame.locator('.pen-note-open').filter({hasText:instruction}).waitFor();}
 await note(2,'第一条要求');await note(2,'第二条要求');await frame.locator('.pen-note-marker').waitFor();assert.equal(await frame.locator('.pen-note-marker').count(),1);await frame.locator('.pen-note-marker').click();assert.equal(await frame.locator('#pen-note-picker button').count(),2);await frame.locator('#pen-note-picker button').filter({hasText:'第一条要求'}).click();assert.equal(await frame.locator('#pen-instruction').inputValue(),'第一条要求');await frame.locator('#pen-relocate').click();await frame.locator('#pen-dialog').waitFor({state:'hidden'});await active.selection(12);await frame.locator('#pen-open').click();assert.equal(await frame.locator('#pen-instruction').inputValue(),'第一条要求');await frame.locator('#pen-save').click();await frame.locator('#pen-dialog').waitFor({state:'hidden'});assert.equal((await workspace.writingRequests({path:doc.path})).drafts.find(d=>d.instruction==='第一条要求').offset,12);
 await page.evaluate(()=>window.messageError=true);await frame.locator('#annotations-to-chat').click();await frame.locator('#feedback').filter({hasText:'发送未完成'}).waitFor();assert.equal((await workspace.writingRequests({path:doc.path})).drafts.length,2);assert.equal(await page.evaluate(()=>window.submitted),0);
 await page.evaluate(()=>{window.messageError=false;window.holdMessages=true;});await frame.locator('#annotations-to-chat').click();await page.waitForFunction(()=>window.replies.length===1);assert.equal(await page.evaluate(()=>window.submitted),1);assert.equal(await frame.locator('#annotations-to-chat').isDisabled(),true);
 // Edit an earlier snapshot while its chat delivery is still in flight.
 await frame.locator('.pen-note-open').filter({hasText:'第一条要求'}).click();await frame.locator('#pen-instruction').fill('发送期间修改的要求');await frame.locator('#pen-save').click();await frame.locator('#pen-dialog').waitFor({state:'hidden'});await note(4,'发送期间新增的要求');await page.evaluate(()=>{window.holdMessages=false;window.replies.splice(0).forEach(reply=>reply());});await frame.locator('#feedback').filter({hasText:'已发送2条'}).waitFor();const pending=(await workspace.writingRequests({path:doc.path})).drafts;assert.deepEqual(pending.map(d=>d.instruction).sort(),['发送期间修改的要求','发送期间新增的要求'].sort());assert.equal(await page.evaluate(()=>window.draftText),'已有聊天草稿');
 await active.close();active=await fixture(browser,{messageEnabled:false,body:''});({frame,page,workspace,doc}=active);await active.open(0);await frame.locator('#pen-instruction').fill('无宿主发送能力仍可暂存');assert.equal(await frame.locator('#pen-send').isDisabled(),true);await frame.locator('#pen-instruction').press('Enter');assert.equal(await frame.locator('#pen-dialog').isVisible(),true);await frame.locator('#pen-save').click();await frame.locator('.pen-note-marker').waitFor();assert.equal((await workspace.writingRequests({path:doc.path})).drafts.length,1);assert.equal(await page.evaluate(()=>window.submitted),0);assert.deepEqual(active.errors,[]);
 await active.close();active=await fixture(browser);({frame,page,workspace,doc}=active);await active.open(8,14);await frame.locator('#pen-instruction').fill('替换这里');await frame.locator('#pen-send').click();await frame.locator('#pen-dialog').waitFor({state:'hidden'});await active.publish('替换后的动作','replace');await frame.locator('.pen-proposal-text').filter({hasText:'替换后的动作'}).waitFor();
 // Simulate a newer document version deleting the original target.
 let saved=await workspace.readDocument(doc.path);await workspace.saveDocument({...saved,body:'完全不同的正文。'});await active.refresh();await frame.locator('.pen-wait-label').filter({hasText:'定位已变动'}).waitFor();
 await page.evaluate(()=>{
   const backend=window.backend;
   window.completedWritingPolls=0;
   window.backend=async(name,args)=>{
     const result=await backend(name,args);
     if(name==='writing_requests')window.completedWritingPolls++;
     return result;
   };
 });
 await active.selection(3,5);
 await frame.locator('.pen-proposal-marker').click();
 const conflictToolbar=frame.locator('#pen-toolbar');
 await conflictToolbar.waitFor();
 const polls=await page.evaluate(()=>window.completedWritingPolls);
 await page.waitForFunction(previous=>window.completedWritingPolls>previous,polls);
 await pause(350);
 assert.ok(await conflictToolbar.evaluate(el=>!el.hidden&&el.contains(document.activeElement)));
 await conflictToolbar.getByRole('button',{name:'移到当前选区或光标'}).click();
 await frame.locator('.pen-proposal-text').filter({hasText:'替换后的动作'}).waitFor();assert.equal(await frame.locator('#draft-body').evaluate(el=>el.value),'完全不同的正文。');await frame.locator('.pen-proposal-text').hover();await frame.locator('#pen-toolbar').getByRole('button',{name:'采纳此处',exact:true}).click();await frame.locator('.pen-proposal').waitFor({state:'hidden'});assert.equal((await workspace.readDocument(doc.path)).body,'完全不替换后的动作正文。');assert.deepEqual(active.errors,[]);
 const base=(await workspace.readDocument(doc.path)).body;
 const second=base.lastIndexOf('正文');
 for(const [start,end,instruction] of [[0,2,'改第一处'],[second,second+2,'改第二处']]){
   await active.open(start,end);
   await frame.locator('#pen-instruction').fill(instruction);
   await frame.locator('#pen-save').click();
   await frame.locator('.pen-note-open').filter({hasText:instruction}).waitFor();
 }
 await frame.locator('#annotations-to-chat').click();
 await frame.locator('#feedback').filter({hasText:'已发送2条'}).waitFor();
 const {requests}=await workspace.writingRequests({path:doc.path});
 for(const item of requests.filter(item=>item.status==='waiting')){
   await workspace.publishWritingSuggestion({requestId:item.id,generation:item.generation,mode:'replace',text:item.instruction==='改第一处'?'忽然':'原稿'});
 }
 const first=frame.locator('.pen-proposal').filter({hasText:'忽然'});
 const other=frame.locator('.pen-proposal').filter({hasText:'原稿'});
 const toolbar=frame.locator('#pen-toolbar');
 const bulk=frame.locator('#pen-review-actions');
 await other.locator('.pen-proposal-text').waitFor();
 await other.locator('.pen-proposal-original').hover();
 await toolbar.waitFor({state:'hidden'});
 assert.deepEqual(await bulk.getByRole('button').evaluateAll(buttons=>buttons.map(button=>[button.title,button.textContent])),[['全部采纳',''],['全部重新生成',''],['全部取消','']]);
 await first.locator('.pen-proposal-text').hover();
 assert.deepEqual(await toolbar.getByRole('button').evaluateAll(buttons=>buttons.map(button=>[button.title,button.textContent])),[['查看对照',''],['采纳此处',''],['重新生成',''],['取消','']]);
 await frame.locator('#draft-title').hover();
 await toolbar.waitFor({state:'hidden'});
 assert.ok(await bulk.isVisible());
 await other.locator('.pen-proposal-text').hover();
 await toolbar.getByRole('button',{name:'采纳此处'}).click();
 await other.waitFor({state:'hidden'});
 await first.locator('.pen-proposal-text').waitFor();
 assert.equal((await workspace.readDocument(doc.path)).body,base.slice(0,second)+'原稿'+base.slice(second+2));
 await active.open(second,second+2);
 await frame.locator('#pen-instruction').fill('再改第二处');
 await frame.locator('#pen-send').click();
 await active.publish('新稿','replace');
 await frame.locator('.pen-proposal-text').filter({hasText:'新稿'}).waitFor();
 await bulk.getByRole('button',{name:'全部重新生成'}).click();
 await bulk.waitFor({state:'hidden'});
 await frame.locator('#feedback').filter({hasText:'已发送2条'}).waitFor();
 const regenerated=(await workspace.writingRequests({path:doc.path})).requests.filter(item=>item.status==='waiting');
 assert.deepEqual(regenerated.map(item=>[item.instruction,item.generation]).sort(),[['再改第二处',2],['改第一处',2]]);
 for(const item of regenerated){
   await workspace.publishWritingSuggestion({requestId:item.id,generation:item.generation,mode:'replace',text:item.instruction==='改第一处'?'接着':'改后'});
 }
 await frame.locator('.pen-proposal-text').filter({hasText:'改后'}).waitFor();
 await bulk.getByRole('button',{name:'全部采纳'}).click();
 await bulk.waitFor({state:'hidden'});
 await frame.locator('#feedback').filter({hasText:'已采纳全部2处'}).waitFor();
 assert.equal((await workspace.readDocument(doc.path)).body,'接着'+base.slice(2,second)+'改后'+base.slice(second+2));
 assert.deepEqual(active.errors,[]);
 console.log('PASS: batch delivery, relocation, independent hover and chapter actions, and batch regeneration and acceptance.');
}catch(e){if(active){console.error('PEN_FAILURE',{error:await active.frame.locator('#pen-error').textContent(),feedback:await active.frame.locator('#feedback').textContent(),dialogOpen:await active.frame.locator('#pen-dialog').isVisible(),errors:active.errors});await active.page.screenshot({path:require('node:path').resolve(__dirname,'../test-results/pen-interaction-failure.png')});}throw e;}finally{if(active)await active.close();await browser.close();}}
if(require.main===module)main().catch(e=>{console.error(e);process.exitCode=1;});
module.exports={main};
