const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
const {fixture}=require('./app-fixture.cjs');

async function main(){
  const browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHANNEL?{channel:process.env.PLAYWRIGHT_CHANNEL}:{})});
  let active;
  try{
    const tail='\n'+Array.from({length:32},(_,i)=>`第${i+1}段正文。`).join('\n');
    active=await fixture(browser,{body:'开头不变。\n旧动作。\n删掉这一段。\n结尾不变。'+tail});
    const {frame,workspace,doc}=active;
    const editor=frame.locator('#draft-body'), refresh=frame.locator('#refresh-files');
    const sibling=await workspace.saveDocument({path:'测试作品/正文/第二章.md',body:'另一篇正文。'});
    await refresh.click();
    await refresh.locator('xpath=self::button[not(@aria-busy)]').waitFor();
    await workspace.saveDocument({path:sibling.path,revision:sibling.revision,body:'改过的另一篇正文。'});
    const body='开头不变。\n新动作。\n结尾不变。'+tail;
    const saved=await workspace.saveDocument({path:doc.path,revision:doc.revision,body});
    await active.selection(2);
    // The visible panel picks up the disk edit without the refresh button.
    await frame.locator('#document-status').filter({hasText:'已刷新磁盘改动'}).waitFor({timeout:8000});
    const state=()=>editor.evaluate(el=>{
      const marks=name=>[...(CSS.highlights.get(name)||[])].map(range=>range.toString());
      return {body:el.value,caret:el.selectionStart,added:marks('external-change'),deleted:marks('external-deletion')};
    });
    assert.deepEqual(await state(),{body,caret:2,added:['新'],deleted:['结']});
    const track=frame.locator('#external-change-track');
    await track.waitFor({state:'visible'});
    const ticks=await track.locator('span').evaluateAll(spans=>spans.map(el=>el.offsetTop));
    assert.ok(ticks.length>0);
    const trackHeight=await track.evaluate(el=>el.clientHeight);
    assert.ok(ticks.every(y=>y>=0 && y<trackHeight/4),`Expected changes in the first quarter of the scrollbar, got ${ticks.join(', ')} of ${trackHeight} px.`);
    assert.equal(await frame.locator('#session-count').textContent(),'0');
    await refresh.click();
    await refresh.locator('xpath=self::button[not(@aria-busy)]').waitFor();
    assert.deepEqual((await state()).added,['新']);

    const first=frame.locator('.file-entry').filter({hasText:'第一章'});
    const second=frame.locator('.file-entry').filter({hasText:'第二章'});
    assert.match(await first.getAttribute('class'),/file-entry-unread/);
    assert.match(await second.getAttribute('class'),/file-entry-unread/);
    await first.click();
    await frame.locator('.file-entry-unread').filter({hasText:'第一章'}).waitFor({state:'detached'});
    assert.deepEqual((await state()).added,['新']);
    await second.click();
    await frame.locator('.file-entry-unread').filter({hasText:'第二章'}).waitFor({state:'detached'});
    await active.selection(0);
    await editor.press('y');
    await frame.locator('#document-status').filter({hasText:'已自动保存'}).waitFor();
    await refresh.click();
    await refresh.locator('xpath=self::button[not(@aria-busy)]').waitFor();
    assert.equal(await frame.locator('.file-entry-unread').count(),0);

    await first.click();
    await frame.locator('#document-status').filter({hasText:doc.path}).waitFor();
    const diskBody=body.replace('开头不变','切回改动');
    await frame.locator('#draft-title').focus();
    const latest=await workspace.saveDocument({path:doc.path,revision:saved.revision,body:diskBody});
    await editor.evaluate(()=>window.dispatchEvent(new Event('focus')));
    await frame.locator('#document-status').filter({hasText:'已刷新磁盘改动'}).waitFor({timeout:2500});
    assert.equal((await state()).body,diskBody);
    assert.equal(await editor.evaluate(()=>document.activeElement.id),'draft-title');
    await first.click();
    await frame.locator('.file-entry-unread').filter({hasText:'第一章'}).waitFor({state:'detached'});

    const conflictBody=diskBody.replace('切回改动','磁盘改动');
    await workspace.saveDocument({path:doc.path,revision:latest.revision,body:conflictBody});
    await active.selection(0);
    await editor.press('x');
    await editor.evaluate(()=>window.dispatchEvent(new Event('focus')));
    await frame.locator('#feedback').filter({hasText:'已保留当前编辑'}).waitFor({timeout:2500});
    assert.equal((await state()).body,'x'+diskBody);
    assert.equal(await first.locator('xpath=self::button[contains(@class,"file-entry-unread")]').count(),0);
    await track.waitFor({state:'hidden'});
    assert.equal((await workspace.readDocument(doc.path)).body,conflictBody);
    assert.deepEqual(active.errors,[]);
    console.log('Refresh reloads the chapter, marks additions and deletions, and preserves conflicting local edits.');
  }finally{
    if(active)await active.close();
    await browser.close();
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});