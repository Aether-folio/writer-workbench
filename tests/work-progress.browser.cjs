const assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const {fixture}=require('./app-fixture.cjs');

(async()=>{
  const browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHANNEL?{channel:process.env.PLAYWRIGHT_CHANNEL}:{})});
  let active;
  try{
    const {countWords}=await import('../src/core.mjs');
    active=await fixture(browser);
    const {page,frame,workspace}=active;
    const tools=frame.getByRole('group',{name:'文稿工具'});
    assert.equal(await frame.locator('#sidebar-files-tab,#sidebar-outline-tab').count(),0);
    const total=frame.locator('.file-folder[data-path="测试作品/正文"] > summary .folder-word-total');
    assert.equal(await total.textContent(),countWords(active.doc.body)+' 字');
    const bottom=frame.locator('#workbench-sidebar > footer.workspace-actions');
    assert.equal(await bottom.getByRole('button',{name:'文本对照'}).locator('svg').count(),1);
    assert.equal(await bottom.locator('#host-status').innerText(),'已连接宿主');
    assert.equal(await frame.locator('#workbench-sidebar > :last-child').getAttribute('class'),'workspace-actions');
    assert.equal(await tools.getByRole('button',{name:'文稿备份'}).locator('svg').count(),1);
    const annotations=frame.locator('.writing-sidebar');
    assert.equal(await annotations.isVisible(),false);
    await active.open(0);
    await frame.locator('#pen-instruction').fill('测试批注');
    await frame.locator('#pen-save').click();
    await annotations.getByText('测试批注').waitFor();
    await annotations.getByRole('button',{name:'删除批注',exact:true}).click();
    await annotations.waitFor({state:'hidden'});
    assert.equal(await frame.getByRole('button',{name:'递笔记录'}).isVisible(),true);
    const start=frame.getByRole('button',{name:'一键整理'});
    await start.click();
    await page.waitForFunction(()=>window.messages.length===1);
    const sent=await page.evaluate(()=>window.messages[0].content[0].text);
    assert.match(sent,/一键整理/);
    const jobId=sent.match(/jobId: ([a-f0-9-]+)/)[1];
    const chapter=await workspace.progress.next({jobId});
    assert.equal(chapter.chapter,'第一卷/第一章.md');
    assert.equal(await frame.getByRole('progressbar',{name:'章节整理进度'}).getAttribute('aria-valuenow'),'0');
    await workspace.progress.submit({jobId,token:chapter.token,summary:{plot:'原来的动作发生了',foreshadowing:'无明显伏笔',continuity:'动作已完成'}});
    await frame.locator('#work-progress-message').filter({hasText:'正在打开进度文稿'}).waitFor();
    assert.equal(await frame.getByRole('progressbar',{name:'章节整理进度'}).getAttribute('aria-valuenow'),'100');
    await frame.locator('#document-status').filter({hasText:'设定/大纲/进度.md'}).waitFor();
    await frame.locator('#work-progress').waitFor({state:'hidden'});
    assert.match(await frame.locator('#draft-body').innerText(),/原来的动作发生了/);
    await start.click();
    await frame.locator('#work-progress-message').filter({hasText:'没有需要重新整理'}).waitFor();
    await frame.locator('#work-progress').waitFor({state:'hidden'});
    assert.equal(await page.evaluate(()=>window.messages.length),1);
    await frame.getByRole('button',{name:'设置',exact:true}).click();
    await frame.getByRole('tab',{name:'排版'}).click();
    await frame.getByLabel('全局字体').selectOption('longcang');
    assert.equal(await frame.locator('#type-preview-font').innerText(),'龙藏体');
    assert.equal(await frame.locator('#type-family optgroup').count(),0);
    await frame.locator('#font-load-status').waitFor({state:'hidden'});
    assert.match(await frame.locator('.type-preview p').first().evaluate(el=>getComputedStyle(el).fontFamily),/Workbench Long Cang/);
    assert.doesNotMatch(await frame.locator('#draft-body').evaluate(el=>getComputedStyle(el).fontFamily),/Workbench Long Cang/);
    assert.notEqual((await workspace.info()).settings.fontFamily,'longcang');
    await frame.locator('#appearance-close').click();
    await frame.locator('#appearance-dialog').waitFor({state:'hidden'});
    await frame.locator('#appearance-status').filter({hasText:'所有设置已保存'}).waitFor({state:'attached'});
    assert.equal((await workspace.info()).settings.fontFamily,'longcang');
    assert.ok(await frame.locator('#draft-body').evaluate(el=>[...el.ownerDocument.fonts].some(font=>font.family==='Workbench Long Cang'&&font.status==='loaded')));
    for(const selector of ['#draft-body','#draft-title','.folder-word-total','#stats-work','#host-status','#appearance-dialog','.type-preview p','#type-family option','#backup-before']){
      assert.match(await frame.locator(selector).first().evaluate(el=>getComputedStyle(el).fontFamily),/Workbench Long Cang/,selector);
    }
    await frame.getByRole('button',{name:'设置',exact:true}).click();
    await frame.getByLabel('全局字体').selectOption('system');
    await frame.locator('#type-family').press('Escape');
    await frame.locator('#appearance-dialog').waitFor({state:'hidden'});
    assert.equal((await workspace.info()).settings.fontFamily,'longcang');
    assert.deepEqual(active.errors,[]);
    console.log('Work progress sends one job, updates by completion and persists the global font.');
    await active.close();
    active=await fixture(browser,{apiOverride:async(name,args,runtime)=>{
      if(name==='workspace_info'){
        const info=await runtime.workspace.info();
        delete info.features.workProgress;
        return info;
      }
    }});
    await active.frame.getByRole('button',{name:'一键整理'}).click();
    await active.frame.locator('#work-progress-message').filter({hasText:'完全退出并重启客户端'}).waitFor();
    assert.equal(await active.page.evaluate(()=>window.messages.length),0);
  }finally{await active?.close();await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
