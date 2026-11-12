const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
const {fixture}=require('./app-fixture.cjs');

async function main(){
  const browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHANNEL?{channel:process.env.PLAYWRIGHT_CHANNEL}:{})});
  let active;
  try{
    active=await fixture(browser,{body:'旧的开头。\n旧的结尾。'});
    const {frame,workspace,doc}=active;
    const {suggestions}=await workspace.stageChatEdits({path:doc.path,instruction:'调整开头和结尾',edits:[
      {original:'旧的开头。',replacement:'新的开头。'},
      {original:'旧的结尾。',replacement:'新的结尾。'},
    ]});
    const proposal=i=>frame.locator(`.pen-proposal[data-request-id="${suggestions[i].id}"] .pen-proposal-text`);
    const manuscript=frame.locator('#draft-body'),toolbar=frame.locator('#pen-toolbar');
    await proposal(0).waitFor();
    await proposal(1).waitFor();
    const firstBadge=frame.getByRole('button',{name:'第一章.md，有待采纳改稿'});
    const track=frame.locator('#external-change-track');
    await firstBadge.waitFor();
    await track.waitFor({state:'visible'});
    assert.ok(await track.locator('span').count()>0);

    const sibling=await workspace.saveDocument({path:'测试作品/正文/第一卷/第二章.md',body:'另一章的原文。'});
    await workspace.stageChatEdits({path:sibling.path,instruction:'润色第二章',edits:[
      {original:'另一章的原文。',replacement:'另一章的建议。'},
    ]});
    await frame.getByRole('button',{name:'第二章.md，有待采纳改稿'}).waitFor({timeout:10000});
    assert.equal((await workspace.readDocument(doc.path)).body,doc.body);
    assert.equal(await manuscript.evaluate(el=>el.value),doc.body);
    assert.notEqual(await proposal(0).evaluate(el=>getComputedStyle(el).color),await manuscript.evaluate(el=>getComputedStyle(el).color));

    await proposal(0).focus();
    await toolbar.getByRole('button',{name:'查看对照'}).click();
    const compare=frame.locator('#pen-compare-dialog');
    await compare.waitFor({state:'visible'});
    assert.equal(await compare.locator('#compare-file-form').isVisible(),false);
    assert.equal(await compare.locator('.pen-compare-remove').textContent(),'1旧的开头。');
    assert.equal(await compare.locator('.pen-compare-add').textContent(),'1新的开头。');
    await compare.getByRole('button',{name:'关闭',exact:true}).click();

    await proposal(0).focus();
    await toolbar.getByRole('button',{name:'采纳此处'}).click();
    await proposal(0).waitFor({state:'detached'});
    await firstBadge.waitFor();
    await track.waitFor({state:'visible'});
    assert.equal((await workspace.readDocument(doc.path)).body,'新的开头。\n旧的结尾。');
    await proposal(1).focus();
    await toolbar.getByRole('button',{name:'取消',exact:true}).click();
    await proposal(1).waitFor({state:'detached'});
    await firstBadge.waitFor({state:'detached'});
    await track.waitFor({state:'hidden'});
    assert.equal((await workspace.readDocument(doc.path)).body,'新的开头。\n旧的结尾。');
    assert.deepEqual(active.errors,[]);
    console.log('Chat edits render as independent proposals, compare against the original, and only save on acceptance.');
  }finally{
    if(active)await active.close();
    await browser.close();
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});