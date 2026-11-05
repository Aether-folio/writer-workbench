const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const {fixture}=require('./browser.cjs');
const assert=require('node:assert/strict');
const {mkdtemp,rm}=require('node:fs/promises');
const {resolve}=require('node:path');
const {pathToFileURL}=require('node:url');

(async()=>{
 const {createWorkspace}=await import(pathToFileURL(resolve(__dirname,'../src/workspace.mjs')).href);
 const directory=await mkdtemp(resolve(__dirname,'../.test-temp/writer-chat-actions-'));
 const workspace=createWorkspace(directory);await workspace.init();
 const original='开头的一句。\n\n结尾的一句。';
 const doc=await workspace.saveDocument({path:'文稿/聊天测试.md',body:original});
 let legacy=false;
 const routes={workspace_info:async()=>{const info=await workspace.info();if(legacy)delete info.features.writingRequestContext;return info;},read_document:a=>workspace.readDocument(a.path),save_document:a=>workspace.saveDocument(a),save_draft:a=>workspace.saveDraft(a),save_writing_records:a=>workspace.saveRecords(a.records),stats_preferences:a=>workspace.statsPreferences(a),writing_requests:a=>workspace.writingRequests(a),create_writing_request:a=>workspace.createWritingRequest(a),update_writing_request:a=>workspace.updateWritingRequest(a)};
 const browser=await chromium.launch({...(process.env.PLAYWRIGHT_CHANNEL ? {channel:process.env.PLAYWRIGHT_CHANNEL} : {}),headless:true});
 try {
  const {page,frame,errors}=await fixture(browser,true,{},(name,args)=>{
    if(!routes[name])throw new Error('Unknown test tool '+name);return routes[name](args);
  });
  await frame.locator('#shelf-home').click();await frame.locator('.shelf-book').first().click();
  await frame.locator('#document-status').filter({hasText:'已打开'}).waitFor();
  const editor=frame.locator('#draft-body');
  const ai=frame.locator('#menu-ai-writing');
  async function rightClickAt(offset,emptyLine=false) {
    const point=await editor.evaluate((el,{offset,emptyLine})=>{
      el.focus();el.setSelectionRange(offset);
      const rect=emptyLine?el.children[1].getBoundingClientRect():getSelection().getRangeAt(0).getBoundingClientRect();
      const point={x:rect.left+1,y:rect.top+Math.max(2,rect.height/2)};
      el.setSelectionRange(0);return point;
    },{offset,emptyLine});
    await editor.evaluate((el,point)=>el.dispatchEvent(new MouseEvent('contextmenu',{clientX:point.x,clientY:point.y,bubbles:true,cancelable:true})),point);
  }
  // A selection is not required: start, middle, paragraph end, empty line and EOF.
  for(const [offset,emptyLine] of [[0,false],[3,false],[6,false],[7,true],[original.length,false]]) {
    await rightClickAt(offset,emptyLine);
    assert.equal(await ai.isEnabled(),true);
    assert.equal(await frame.locator('#menu-quote').isEnabled(),false);
    assert.equal(await editor.evaluate(el=>el.selectionEnd),offset);
    await ai.click();
    assert.equal(await frame.locator('#ai-writing-context').textContent(),original.slice(0,offset)+'【在此插入】'+original.slice(offset));
    await frame.locator('#ai-writing-cancel').click();
  }
  assert.equal(await page.evaluate(()=>window.submitted),0);
  await editor.evaluate(el=>{el.readOnly=true;});
  await editor.dispatchEvent('contextmenu',{clientX:0,clientY:0,bubbles:true,cancelable:true});
  assert.equal(await ai.isEnabled(),false);
  await editor.evaluate(el=>{el.readOnly=false;});

  // Old backend metadata must not permanently disable the location menu.
  legacy=true;
  await rightClickAt(3);await ai.click();
  await frame.locator('#ai-writing-instruction').fill('补一句。');await frame.locator('#ai-writing-submit').click();
  await frame.locator('#ai-writing-error').filter({hasText:'旧版本'}).waitFor();
  assert.equal(await frame.locator('#ai-writing-instruction').inputValue(),'补一句。');
  assert.equal((await workspace.writingRequests({path:doc.path})).requests.length,0);
  await frame.locator('#ai-writing-cancel').click();legacy=false;

  async function selectionMenu() {
    await editor.evaluate(el=>{el.focus();el.setSelectionRange(0,6);el.dispatchEvent(new Event('select'));});
    await editor.dispatchEvent('contextmenu',{clientX:0,clientY:0,bubbles:true,cancelable:true});
  }
  async function openQuote() {await selectionMenu();await frame.locator('#menu-quote').click();}
  const instruction=frame.locator('#quote-chat-instruction');
  await openQuote();
  assert.equal(await frame.locator('#quote-chat-selection').textContent(),'开头的一句。');
  assert.equal(await page.evaluate(()=>window.submitted),0);
  await frame.locator('#quote-chat-cancel').click();
  assert.equal(await page.evaluate(()=>window.submitted),0);
  await openQuote();await instruction.press('Enter');
  await frame.locator('#quote-chat-error').filter({hasText:'请填写'}).waitFor();
  await instruction.fill('分析人物动机。');await instruction.press('Shift+Enter');await instruction.pressSequentially('给两条建议。');
  assert.equal(await instruction.inputValue(),'分析人物动机。\n给两条建议。');
  await instruction.dispatchEvent('compositionstart');await instruction.dispatchEvent('keydown',{key:'Enter',isComposing:true});await instruction.dispatchEvent('compositionend');
  await instruction.dispatchEvent('keydown',{key:'Enter',keyCode:229});await instruction.dispatchEvent('keydown',{key:'Enter',repeat:true});
  assert.equal(await page.evaluate(()=>window.submitted),0);
  await page.screenshot({path:resolve(__dirname,'../test-results/quote-chat-dialog.png')});
  await page.evaluate(()=>{window.testHoldMessages=true;window.testMessageReplies=[];});
  await instruction.press('Enter');
  await frame.locator('#quote-chat-send:disabled').waitFor();
  await frame.locator('#quote-chat-send').dispatchEvent('click');await instruction.dispatchEvent('keydown',{key:'Enter'});
  await frame.locator('#quote-chat-cancel').click();
  assert.equal(await frame.locator('#quote-chat-dialog').isVisible(),true);
  assert.equal(await page.evaluate(()=>window.submitted),1);
  await page.evaluate(()=>{window.testHoldMessages=false;window.testMessageReplies.splice(0).forEach(reply=>reply());});
  await frame.locator('#quote-chat-dialog').waitFor({state:'hidden'});
  let message=await page.evaluate(()=>window.testMessages.at(-1).params);
  assert.deepEqual(message._meta,{'openai/message':{target:'active',send:true}});
  assert.ok(message.content[0].text.includes('> 开头的一句。'));
  assert.ok(message.content[0].text.includes('分析人物动机。\n给两条建议。'));
  assert.equal(await page.evaluate(()=>window.existingDraft),'我已有的问题。');
  assert.equal(await editor.evaluate(el=>el.value),original);

  await openQuote();await instruction.fill('换一种解释。');await page.evaluate(()=>{window.testMessageError=true;});
  await frame.locator('#quote-chat-send').click();await frame.locator('#quote-chat-error').filter({hasText:'发送未完成'}).waitFor();
  assert.equal(await instruction.inputValue(),'换一种解释。');assert.equal(await frame.locator('#quote-chat-send').isEnabled(),true);
  await page.evaluate(()=>{window.testMessageError=false;});await frame.locator('#quote-chat-send').click();
  await frame.locator('#quote-chat-dialog').waitFor({state:'hidden'});
  assert.equal(await page.evaluate(()=>window.submitted),2);

  async function annotate(text) {await selectionMenu();await frame.locator('#menu-annotate').click();await frame.locator('#annotation-body').fill(text);await frame.locator('#annotation-save').click();}
  await annotate('解释这里的因果。');
  await frame.locator('#annotations-to-chat').click();
  await frame.locator('#annotation-chat-status').filter({hasText:'已发送 1 条'}).waitFor();
  assert.equal(await page.evaluate(()=>window.submitted),3);
  assert.equal(await frame.locator('.annotation-card').count(),0);
  message=await page.evaluate(()=>window.testMessages.at(-1).params);
  assert.deepEqual(message._meta,{'openai/message':{target:'active',send:true}});
  assert.ok(message.content[0].text.includes('解释这里的因果。'));

  await annotate('失败时保留。');await page.evaluate(()=>{window.testMessageError=true;});
  await frame.locator('#annotations-to-chat').click();await frame.locator('#annotation-chat-status').filter({hasText:'发送未完成'}).waitFor();
  assert.equal(await frame.locator('.annotation-card').count(),1);
  await page.evaluate(()=>{window.testMessageError=false;window.testHoldMessages=true;window.testMessageReplies=[];});
  await frame.locator('#annotations-to-chat').click();
  await frame.locator('#annotations-to-chat:disabled').waitFor();await frame.locator('#annotations-to-chat').dispatchEvent('click');
  assert.equal(await page.evaluate(()=>window.submitted),4);
  assert.equal(await page.evaluate(()=>window.testMessageReplies.length),1);
  await frame.locator('.annotation-card').click();await frame.locator('#annotation-body').fill('发送期间修改的批注。');await frame.locator('#annotation-save').click();
  await annotate('发送期间新增的批注。');
  await page.evaluate(()=>{window.testHoldMessages=false;window.testMessageReplies.splice(0).forEach(reply=>reply());});
  await frame.locator('#annotation-chat-status').filter({hasText:'已发送 1 条'}).waitFor();
  assert.equal(await frame.locator('.annotation-card').count(),2);
  await frame.locator('#annotations-to-chat').click();await frame.locator('#annotation-chat-status').filter({hasText:'已发送 2 条'}).waitFor();
  assert.equal(await page.evaluate(()=>window.submitted),5);assert.equal(await frame.locator('.annotation-card').count(),0);
  assert.equal(await page.evaluate(()=>window.existingDraft),'我已有的问题。');
  assert.equal((await workspace.readDocument(doc.path)).body,original);

  // Empty manuscripts also have a valid insertion location.
  await editor.fill('');
  const bounds=await editor.boundingBox();
  await editor.dispatchEvent('contextmenu',{clientX:bounds.x+32,clientY:bounds.y+32,bubbles:true,cancelable:true});
  assert.equal(await ai.isEnabled(),true);await ai.click();assert.equal(await frame.locator('#ai-writing-context').textContent(),'【在此插入】');
  await frame.locator('#ai-writing-cancel').click();
  assert.deepEqual(errors,[]);await page.close();
  const unsupported=await fixture(browser,false);
  await unsupported.frame.locator('#draft-body').fill('不支持聊天发送。');
  await unsupported.frame.locator('#draft-body').dispatchEvent('contextmenu',{clientX:0,clientY:0,bubbles:true,cancelable:true});
  assert.equal(await unsupported.frame.locator('#menu-ai-writing').isEnabled(),false);
  assert.equal(await unsupported.page.evaluate(()=>window.submitted),0);await unsupported.page.close();
  console.log('PASS: caret insertion at start/middle/end/blank line/empty doc, read-only and legacy backend feedback, quote composer/cancel/Enter/Shift+Enter/IME/failure/retry/double-submit, batch direct send/retention/concurrent notes, no draft or manuscript mutation.');
 } finally {await browser.close();await rm(directory,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
