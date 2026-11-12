const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
const {fixture}=require('./app-fixture.cjs');
const {resolve}=require('node:path');
const pause=ms=>new Promise(r=>setTimeout(r,ms));

async function main(){
  const browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHANNEL?{channel:process.env.PLAYWRIGHT_CHANNEL}:{})});
  let active;
  try{
    active=await fixture(browser,{body:'开头的一句正文。\n第二段正文。'});
    const {frame,page,workspace,doc}=active;
    await page.setViewportSize({width:1512,height:1100});
    await pause(200);
    const manuscript=frame.locator('#draft-body');
    const initialWidth=(await manuscript.boundingBox()).width;
    const sidebarWidth=(await frame.locator('#workbench-sidebar').boundingBox()).width;
    await page.setViewportSize({width:1912,height:1100});
    assert.equal(Math.round((await manuscript.boundingBox()).width-initialWidth),400);
    assert.equal((await frame.locator('#workbench-sidebar').boundingBox()).width,sidebarWidth);
    await frame.locator('#appearance-open').click();
    await frame.locator('#settings-tab-typography').click();
    await frame.locator('#auto-page-width').uncheck();
    await frame.locator('#appearance-status').filter({hasText:'所有设置已保存'}).waitFor();
    assert.equal(Math.round((await manuscript.boundingBox()).width),1098);
    assert.equal((await workspace.info()).settings.autoPageWidth,false);
    await frame.locator('#auto-page-width').check();
    await frame.locator('#appearance-close').click();
    await page.setViewportSize({width:1512,height:1100});

    // 1. 顶部设置入口、去掉「写作 / 背景设置」按钮和正文底部三个快捷按钮。
    assert.equal(await frame.locator('#nav-editor').count(),0,'「写作」按钮应已移除');
    assert.equal(await frame.locator('#appearance-open').isVisible(),true,'右上角应有设置按钮');
    assert.equal(await frame.locator('#document-save').count(),0);
    assert.equal(await frame.locator('#document-saveas').count(),0);
    assert.equal(await frame.locator('#select-all').count(),0);
    assert.equal(await frame.locator('.document-footer').evaluate(el=>el.querySelectorAll('button').length),0);

    // 2. 设置弹窗：背景、排版、侧栏位置；切换侧栏到右边并检查真实布局。
    await frame.locator('#appearance-open').click();
    await frame.locator('#appearance-dialog').waitFor({state:'visible'});
    assert.equal(await frame.locator('#appearance-heading').textContent(),'设置');
    assert.equal(await frame.locator('#background-presets button').count()>0,true);
    await frame.locator('#settings-tab-layout').click();
    assert.equal(await frame.locator('#sidebar-side').isVisible(),true);
    await frame.locator('#sidebar-side').selectOption('right');
    await pause(300);
    assert.equal(await frame.locator('body').getAttribute('data-sidebar-side'),'right');
    const right=await frame.locator('body').evaluate(()=>{
      const box=sel=>{const r=document.querySelector(sel).getBoundingClientRect();return {x:Math.round(r.x),w:Math.round(r.width)};};
      return {sidebar:box('#workbench-sidebar'),resizer:box('#sidebar-resizer'),doc:box('.document'),columns:getComputedStyle(document.querySelector('.workspace-shell')).gridTemplateColumns};
    });
    assert.ok(right.sidebar.x>right.doc.x,'侧栏应移到正文右边');
    assert.ok(right.resizer.x>right.doc.x && right.resizer.x<right.sidebar.x,'分隔条应在正文和侧栏之间');
    assert.match(right.columns,/\d+px 22px 262px$/);
    await page.screenshot({path:resolve(__dirname,'../test-results/ui-sidebar-right.png')});
    await frame.locator('#appearance-close').click();
    // 右侧栏向左拖是变宽。
    const handle=await frame.locator('#sidebar-resizer').boundingBox();
    await page.mouse.move(handle.x+handle.width/2,handle.y+160);await page.mouse.down();
    await page.mouse.move(handle.x+handle.width/2-40,handle.y+160,{steps:8});await page.mouse.up();
    await pause(200);
    assert.equal(Math.round((await frame.locator('#workbench-sidebar').boundingBox()).width),302,'右侧栏向左拖动应加宽');
    // 重新打开工作台后仍然保持在右边。
    await active.refresh();await pause(400);
    assert.equal(await frame.locator('body').getAttribute('data-sidebar-side'),'right','侧栏位置应持久保存');

    // 旧版后台不认识 sidebarSide，保存时会把这个字段丢掉；界面不能因此翻回左边。
    const originalSaveSettings=active.workspace.saveSettings;
    active.workspace.saveSettings=async input=>{
      const {sidebarSide,...rest}=input;
      const result=await originalSaveSettings(rest);
      const {sidebarSide:_ignored,...settings}=result.settings;
      return {settings};
    };
    await frame.locator('#appearance-open').click();
    await frame.locator('#settings-tab-layout').click();
    await frame.locator('#sidebar-side').selectOption('left');await pause(300);
    assert.equal(await frame.locator('body').getAttribute('data-sidebar-side'),'left');
    await frame.locator('#sidebar-side').selectOption('right');await pause(400);
    assert.equal(await frame.locator('body').getAttribute('data-sidebar-side'),'right','后台返回缺少该字段时侧栏也不应翻回左边');
    await frame.locator('#appearance-close').click();
    active.workspace.saveSettings=originalSaveSettings;
    await frame.locator('#appearance-open').click();
    await frame.locator('#settings-tab-layout').click();
    await frame.locator('#sidebar-side').selectOption('left');
    await pause(300);
    assert.equal(await frame.locator('body').getAttribute('data-sidebar-side'),'left');
    await frame.locator('#appearance-close').click();

    // 2b. 正文里 Ctrl+滚轮调字号：立即生效、限制在 14–30，并保存。
    const body=frame.locator('#draft-body');
    const fontSize=()=>body.evaluate(el=>parseFloat(getComputedStyle(el).fontSize));
    const wheel=async deltaY=>{await body.evaluate((el,dy)=>el.dispatchEvent(new WheelEvent('wheel',{deltaY:dy,ctrlKey:true,bubbles:true,cancelable:true})),deltaY);await pause(160);};
    await body.hover();
    await page.keyboard.down('Control');
    await page.mouse.wheel(0,-120);await pause(200);
    await page.keyboard.up('Control');
    assert.equal(await fontSize(),19,'Ctrl+滚轮向上应加大字号');
    assert.equal(await frame.locator('#type-size').inputValue(),'19','设置里的字号应同步');
    await wheel(120);
    assert.equal(await fontSize(),18,'Ctrl+滚轮向下应减小字号');
    await wheel(120);
    assert.equal(await fontSize(),17);
    for(let i=0;i<4;i++)await wheel(120);
    assert.equal(await fontSize(),14,'字号最小为 14px');
    assert.equal(await body.evaluate(()=>window.visualViewport?.scale ?? 1),1,'不应触发页面缩放');
    await pause(700);
    assert.equal((await active.workspace.info()).settings.fontSize,14,'字号应保存到设置');

    // 3. 批注面板：无勾选框、每条可删除、顶部可全部删除，提示文字不在批注区。
    async function note(start,instruction){
      await active.open(start,start+2);
      await frame.locator('#pen-instruction').fill(instruction);
      await frame.locator('#pen-save').click();
      await frame.locator('#pen-dialog').waitFor({state:'hidden'});
      await frame.locator('.pen-note-open').filter({hasText:instruction}).waitFor();
    }
    await note(0,'第一条批注');await note(6,'第二条批注');
    assert.equal(await frame.locator('.pen-note-card').count(),2);
    assert.equal(await frame.locator('.pen-note-card input[type=checkbox]').count(),0,'批注不应再有勾选框');
    assert.equal(await frame.locator('#annotations-selected').count(),0,'不应再有「发送选中」');
    assert.equal(await frame.locator('#annotations-clear').isVisible(),true,'顶部应有全部删除');
    assert.equal(await frame.locator('.writing-sidebar #feedback').count(),0,'批注区不应再显示底部文字提示');
    assert.ok((await workspace.writingRequests({path:doc.path})).drafts.length===2);
    await frame.locator('.pen-note-card').filter({hasText:'第一条批注'}).locator('.pen-note-delete').click();
    await frame.locator('.pen-note-card').filter({hasText:'第一条批注'}).waitFor({state:'detached'});
    assert.equal(await frame.locator('.pen-note-card').count(),1,'单条删除应移除对应批注');
    assert.equal((await workspace.writingRequests({path:doc.path})).drafts.length,1);
    await frame.locator('#annotations-clear').click();
    await frame.locator('#annotation-count').filter({hasText:'0条'}).waitFor();
    assert.equal(await frame.locator('.pen-note-card').count(),0,'全部删除应清空批注');
    assert.equal((await workspace.writingRequests({path:doc.path})).drafts.length,0);

    // 4. 正文里的批注图标带浅色底，颜色更醒目。
    await note(0,'再放一条批注');
    const marker=frame.locator('.pen-note-marker');
    await marker.waitFor();
    const style=await marker.evaluate(el=>{const s=getComputedStyle(el);return {color:s.color,background:s.backgroundColor,width:s.width};});
    assert.notEqual(style.background,'rgba(0, 0, 0, 0)','批注图标应有可见底色');
    assert.ok(parseFloat(style.width)>=19,'批注图标应略微放大');
    const rgb=style.color.match(/\d+/g).map(Number);
    assert.ok(rgb[0]>rgb[1]+60 && rgb[0]>rgb[2]+60,`批注图标应为红色，实际 ${style.color}`);

    // 5. 悬浮窗的暂停/结束改成图标。
    assert.equal(await frame.locator('#pause svg').count(),1,'暂停按钮应为图标');
    assert.equal(await frame.locator('#finish-writing svg').count(),1,'结束按钮应为图标');
    assert.equal(await frame.locator('#pause').getAttribute('aria-label'),'暂停');
    assert.equal(await frame.locator('#finish-writing').getAttribute('aria-label'),'结束');

    assert.deepEqual(active.errors,[]);
    console.log('PASS: 设置入口与侧栏左右切换（含旧后台丢弃字段时不回弹）、Ctrl+滚轮调字号、批注单条/全部删除与醒目图标、暂停结束图标、底部快捷按钮移除。');
  }finally{ if(active)await active.close(); await browser.close(); }
}
if(require.main===module)main().catch(error=>{console.error(error);process.exitCode=1;});
module.exports={main};
