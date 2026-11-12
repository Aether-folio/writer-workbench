const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
const {fixture}=require('./app-fixture.cjs');
const {resolve}=require('node:path');
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function main(){const browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHANNEL?{channel:process.env.PLAYWRIGHT_CHANNEL}:{})});let active;
try{active=await fixture(browser,{body:'甲乙\n\n丙丁\n戊己'});let {frame,page,workspace,doc}=active;await active.open(1,7);await frame.locator('#pen-instruction').fill('改写跨段内容');await frame.locator('#pen-send').click();await frame.locator('#pen-dialog').waitFor({state:'hidden'});await active.publish('新段落一。\n新段落二。','replace');await frame.locator('.pen-proposal-text').filter({hasText:'新段落二'}).waitFor();const editor=frame.locator('#draft-body');assert.equal(await editor.evaluate(el=>el.value),doc.body);
 const copied=await editor.evaluate(el=>{el.focus();el.select();const data=new DataTransfer();el.dispatchEvent(new ClipboardEvent('copy',{clipboardData:data,bubbles:true,cancelable:true}));return data.getData('text/plain');});assert.equal(copied,doc.body);
 await active.selection(0,8);await editor.press('Backspace');assert.equal(await editor.evaluate(el=>el.value),doc.body);
 const paragraphs=frame.locator('.pen-proposal-text > div'),toolbar=frame.locator('#pen-toolbar');
 await paragraphs.filter({hasText:'新段落一'}).hover();
 await toolbar.waitFor();
 const firstPosition=await toolbar.boundingBox();
 await frame.locator('#draft-title').hover();
 await toolbar.waitFor({state:'hidden'});
 await paragraphs.filter({hasText:'新段落二'}).hover();
 await toolbar.waitFor();
 assert.deepEqual(await toolbar.boundingBox(),firstPosition,'Both paragraphs should reveal the toolbar in the same place');
 assert.equal(await toolbar.getByRole('button').count(),4);
 await toolbar.getByRole('button',{name:'采纳此处',exact:true}).click();await frame.locator('.pen-proposal').waitFor({state:'hidden'});await pause(2800);assert.equal(await frame.locator('.pen-proposal').count(),0);assert.equal((await workspace.readDocument(doc.path)).body,doc.body.slice(0,1)+'新段落一。\n新段落二。'+doc.body.slice(7));
 await active.close();
 const base='首段原文。\n\n次段原文。\n这段保持原样。\n末段原文。';
 active=await fixture(browser,{body:base});
 ({frame,page,workspace,doc}=active);
 const replacements=new Map([['首段原文。','第一段 AI 改稿。'],['次段原文。','第二段 AI 改稿。'],['末段原文。','单独一处 AI 改稿。']]);
 for(const original of replacements.keys()){
   const start=base.indexOf(original);
   await active.open(start,start+original.length);
   await frame.locator('#pen-instruction').fill(original);
   await frame.locator('#pen-save').click();
   await frame.locator('.pen-note-open').filter({hasText:original}).waitFor();
 }
 await frame.locator('#annotations-to-chat').click();
 await frame.locator('#feedback').filter({hasText:'已发送3条'}).waitFor();
 const {requests}=await workspace.writingRequests({path:doc.path});
 for(const item of requests){
   await workspace.publishWritingSuggestion({requestId:item.id,generation:item.generation,mode:'replace',text:replacements.get(item.instruction)});
 }
 const groupedToolbar=frame.locator('#pen-toolbar');
 const first=frame.locator('.pen-proposal-text').filter({hasText:'第一段 AI 改稿。'});
 const second=frame.locator('.pen-proposal-text').filter({hasText:'第二段 AI 改稿。'});
 const separate=frame.locator('.pen-proposal-text').filter({hasText:'单独一处 AI 改稿。'});
 await separate.waitFor();
 await first.hover();
 const groupAccept=groupedToolbar.getByRole('button',{name:'采纳这组改稿',exact:true});
 await groupAccept.waitFor();
 const groupPosition=await groupedToolbar.boundingBox();
 await second.hover();
 await groupAccept.waitFor();
 assert.deepEqual(await groupedToolbar.boundingBox(),groupPosition);
 await separate.hover();
 await groupedToolbar.getByRole('button',{name:'采纳此处',exact:true}).waitFor();
 await second.hover();
 await groupAccept.click();
 await frame.locator('#feedback').filter({hasText:'已采纳这组2处改稿'}).waitFor();
 assert.equal(await first.count(),0);
 assert.equal(await second.count(),0);
 assert.ok(await separate.isVisible());
 assert.equal((await workspace.readDocument(doc.path)).body,'第一段 AI 改稿。\n\n第二段 AI 改稿。\n这段保持原样。\n末段原文。');
 assert.deepEqual(active.errors,[]);
 await active.close();active=await fixture(browser,{body:Array.from({length:300},(_,i)=>`第${i}段，正文内容。`).join('\n')});({frame,page,workspace,doc}=active);const longEditor=frame.locator('#draft-body');await longEditor.evaluate(el=>{el.focus();el.setSelectionRange(1000,1004);el.scrollTop=550;el.dispatchEvent(new Event('scroll'));});await pause(800);const saved=(await workspace.readingPosition({path:doc.path})).position;assert.equal(saved.start,1000);await active.refresh();await pause(800);assert.equal(await longEditor.evaluate(el=>el.selectionStart),1000);assert.equal(Math.round(await longEditor.evaluate(el=>el.scrollTop)),Math.round(saved.scrollTop));
 await active.open(500);await frame.locator('#pen-instruction').fill('补一个很长的动作');await frame.locator('#pen-send').click();await frame.locator('#pen-dialog').waitFor({state:'hidden'});await active.publish('这是补写内容。'.repeat(30),'insert');await frame.locator('.pen-proposal-text').filter({hasText:'这是补写内容。'}).waitFor();await longEditor.evaluate(el=>{const proposal=el.querySelector('.pen-proposal');proposal.scrollIntoView({block:'center'});});await frame.locator('.pen-proposal-text').hover();
 const checkGeometry=async()=>{
   const geometry=await frame.locator('#pen-toolbar').evaluate(el=>{
     const bar=el.getBoundingClientRect(),body=document.getElementById('draft-body').getBoundingClientRect();
     const batch=document.getElementById('pen-review-actions'),footerButton=batch.firstElementChild.getBoundingClientRect();
     const slot=el.closest('.pen-inline-actions');
     const lastLine=[...slot.closest('.pen-proposal').querySelector('.pen-proposal-text').getClientRects()].at(-1);
     const followsText=bar.top>=lastLine.bottom-1||bar.left>=lastLine.right;
     return {followsText,inSlot:slot.contains(el),belowEditor:batch.getBoundingClientRect().top>=body.bottom,leftAligned:footerButton.left-body.left<30};
   });
   assert.deepEqual(geometry,{followsText:true,inSlot:true,belowEditor:true,leftAligned:true});
 };
 await checkGeometry();
 await frame.locator('#writing-fullscreen').click();await frame.locator('.pen-proposal-text').hover();await checkGeometry();await page.screenshot({path:resolve(__dirname,'../test-results/pen-fullscreen.png')});
 await frame.locator('#writing-fullscreen-exit').click();await frame.locator('#appearance-open').click();await frame.locator('#background-hex').fill('#202822');await frame.locator('#background-apply').click();assert.equal(await frame.locator('html').evaluate(el=>el.style.colorScheme),'dark');await frame.locator('#appearance-close').click();await page.screenshot({path:resolve(__dirname,'../test-results/pen-dark.png')});assert.deepEqual(active.errors,[]);
 await active.close();
 const prefix='“你们先按顺序登记。';
 const suffix='学员到服务中心签到，材料分组发。”值班员举起登记表。';
 const insertion='在活动室，忘记携带个人证件的，到前台补录。';
 active=await fixture(browser,{body:prefix+suffix});
 ({frame,page,workspace,doc}=active);
 await page.setViewportSize({width:590,height:800});
 await active.open(prefix.length);
 await frame.locator('#pen-instruction').fill('说明现场补录规则');
 await frame.locator('#pen-send').click();
 const waiting=frame.locator('.pen-wait-active');
 await waiting.waitFor();
 assert.deepEqual(await waiting.evaluate(el=>{
   const style=getComputedStyle(el);
   return [el.textContent,style.fontSize,style.fontWeight];
 }),['递笔中...','16px','700']);
 const dots=waiting.locator('.pen-wait-dots');
 const stages=await dots.evaluate(el=>{
   const animation=el.getAnimations()[0];
   animation.pause();
   return [0,410,810,1210].map(time=>{
     animation.currentTime=time;
     return getComputedStyle(el).clipPath;
   });
 });
 assert.equal(new Set(stages).size,4);
 await page.emulateMedia({reducedMotion:'reduce'});
 assert.equal(await dots.evaluate(el=>getComputedStyle(el).animationName),'none');
 await active.publish(insertion,'insert');
 const inline=frame.locator('.pen-proposal-text').filter({hasText:insertion});
 await inline.waitFor();
 const slot=frame.locator('.pen-inline-actions:not([hidden])');
 const reserved=await slot.boundingBox();
 assert.ok(reserved.width>0);
 await frame.locator('.pen-proposal-marker').click();
 const accept=frame.getByRole('button',{name:'采纳此处',exact:true});
 await accept.waitFor();
 assert.deepEqual(await slot.boundingBox(),reserved,'Showing actions should leave the text in place');
 assert.equal(await slot.locator('#pen-toolbar').count(),1);
 const overlapsText=await frame.locator('#pen-toolbar').evaluate(toolbar=>{
   const bar=toolbar.getBoundingClientRect();
   const walker=document.createTreeWalker(document.getElementById('draft-body'),NodeFilter.SHOW_TEXT);
   const range=document.createRange();
   while(walker.nextNode()){
     range.selectNodeContents(walker.currentNode);
     if([...range.getClientRects()].some(rect=>bar.left<rect.right&&bar.right>rect.left&&bar.top<rect.bottom&&bar.bottom>rect.top))return true;
   }
   return false;
 });
 assert.equal(overlapsText,false,'The inline toolbar must leave both the suggestion and the following manuscript visible');
 assert.equal((await workspace.readDocument(doc.path)).body,prefix+suffix);
 await accept.click();
 await inline.waitFor({state:'hidden'});
 assert.equal((await workspace.readDocument(doc.path)).body,prefix+insertion+suffix);
 assert.deepEqual(active.errors,[]);
 console.log('PASS: cross-paragraph preview, adjacent proposal groups, protected deletion, reading position recovery, and an inline toolbar that leaves the text visible.');
}finally{if(active)await active.close();await browser.close();}}
if(require.main===module)main().catch(e=>{console.error(e);process.exitCode=1;});
module.exports={main};
