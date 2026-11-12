const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
const {fixture}=require('./app-fixture.cjs');
const {resolve}=require('node:path');
const pause=ms=>new Promise(r=>setTimeout(r,ms));

async function main(){
  const browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHANNEL?{channel:process.env.PLAYWRIGHT_CHANNEL}:{})});
  let active;
  try{
    const body='雨停在凌晨三点。\n林舟推开旧书店的门，风铃轻轻响了一声。柜台上的台灯还亮着，暖黄的光落在一本摊开的笔记上。\n他认得那行字。三年前，姐姐寄来的最后一封信，也用了同样的蓝色墨水。\n「如果有人来找我，别告诉他你见过这封信。」\n窗外，一辆没有熄火的黑色轿车停在街角。林舟合上笔记，忽然听见柜台下面传来手机的振动声。';
    active=await fixture(browser,{body});const {page,frame,workspace}=active;
    await page.setViewportSize({width:1512,height:1000});
    const saved=()=>frame.locator('#appearance-status').filter({hasText:'所有设置已保存'}).waitFor();
    const open=()=>frame.locator('#appearance-open').click();
    const close=()=>frame.locator('#appearance-close').click();
    await open();
    assert.equal(await frame.locator('[data-theme="native"][aria-pressed=true]').count(),1);
    await frame.locator('#background-presets button[data-color="#dce8d2"]').click();await saved();
    await frame.locator('#theme-choices [data-theme=glass]').click();await saved();
    for(const palette of ['glacier','iris','mint','peach','silver','midnight']){
      await frame.locator(`#glass-presets [data-palette=${palette}]`).click();await saved();await close();
      const css=await frame.locator('.document').evaluate(el=>{const s=getComputedStyle(el);return {filter:s.backdropFilter,color:s.color,scheme:getComputedStyle(document.documentElement).colorScheme};});
      assert.match(css.filter,/blur/);assert.equal(css.scheme,palette==='midnight'?'dark':'light');
      assert.equal((await workspace.info()).settings.glassPalette,palette);
      await page.screenshot({path:resolve(__dirname,`../test-results/glass-${palette}.png`)});await open();
    }
    await frame.locator('#glass-presets [data-palette=glacier]').click();await saved();
    await page.screenshot({path:resolve(__dirname,'../test-results/settings-glass.png')});
    await frame.locator('#glass-frost').fill('85');await saved();
    await frame.locator('#settings-tab-typography').click();
    await frame.locator('#type-size').fill('21');await frame.locator('#type-height').fill('1.8');await saved();
    await page.screenshot({path:resolve(__dirname,'../test-results/settings-typography.png')});
    await frame.locator('#settings-tab-layout').click();await frame.locator('#sidebar-side').selectOption('right');await saved();
    await frame.locator('#type-motion').check();await saved();
    await close();await active.refresh();
    assert.equal(await frame.locator('html').getAttribute('data-theme'),'glass');
    assert.equal(await frame.locator('body').getAttribute('data-sidebar-side'),'right');
    assert.equal(await frame.locator('#draft-body').evaluate(el=>getComputedStyle(el).fontSize),'21px');
    assert.equal(await frame.locator('#glass-frost').inputValue(),'85');
    assert.equal(await frame.locator('html').getAttribute('data-reduce-motion'),'true');
    await frame.locator('#writing-fullscreen').click();
    assert.equal(await frame.locator('#stats-float').evaluate(el=>el.classList.contains('is-detached')),true);
    await page.screenshot({path:resolve(__dirname,'../test-results/glass-fullscreen.png')});
    await frame.locator('#writing-fullscreen-exit').click();await open();
    await frame.locator('#theme-choices [data-theme=native]').click();await saved();
    assert.equal(await frame.locator('html').evaluate(el=>el.style.getPropertyValue('--paper')),'#dce8d2');
    assert.equal(await frame.locator('.document').evaluate(el=>getComputedStyle(el).backdropFilter),'none');
    // Delayed writes cannot turn a more recent theme or typography choice back.
    const original=workspace.saveSettings;
    // An already-running old service can silently strip new fields: do not report success.
    workspace.saveSettings=async input=>{const result=await original(input);const {theme,glassPalette,glassFrost,...settings}=result.settings;return {settings};};
    await frame.locator('#theme-choices [data-theme=glass]').click();await frame.locator('#appearance-retry').waitFor();
    assert.match(await frame.locator('#appearance-status').textContent(),/重启客户端/);
    workspace.saveSettings=original;await frame.locator('#appearance-retry').click();await saved();
    workspace.saveSettings=async input=>{await pause(500);return original(input);};
    await frame.locator('#theme-choices [data-theme=glass]').click();await pause(180);
    await frame.locator('#glass-presets [data-palette=iris]').click();
    await frame.locator('#glass-presets [data-palette=mint]').click();
    await frame.locator('#settings-tab-typography').click();await frame.locator('#type-size').fill('23');await saved();
    const latest=(await workspace.info()).settings;
    assert.equal(latest.theme,'glass');assert.equal(latest.glassPalette,'mint');assert.equal(latest.fontSize,23);
    workspace.saveSettings=async()=>{throw Error('模拟保存失败');};
    await frame.locator('#type-size').fill('24');await frame.locator('#appearance-retry').waitFor();
    assert.match(await frame.locator('#appearance-status').textContent(),/保存未完成/);
    workspace.saveSettings=original;await frame.locator('#appearance-retry').click();await saved();
    assert.equal((await workspace.info()).settings.fontSize,24);
    // Narrow settings keep their footer and controls inside the viewport.
    await page.setViewportSize({width:390,height:780});await frame.locator('#settings-tab-appearance').click();
    await page.screenshot({path:resolve(__dirname,'../test-results/settings-glass-mobile.png')});
    const bounds=await frame.locator('#appearance-dialog').boundingBox();assert.ok(bounds.x>=0&&bounds.x+bounds.width<=391);
    const overflow=await frame.locator('.settings-content').evaluate(el=>el.scrollWidth>el.clientWidth+1);assert.equal(overflow,false);
    await frame.locator('#settings-tab-layout').focus();await page.keyboard.press('Home');
    assert.equal(await frame.locator('#settings-tab-appearance').getAttribute('aria-selected'),'true');
    await frame.locator('#settings-tab-layout').click();await frame.locator('#settings-stats-open').click();
    assert.equal(await frame.locator('#stats-settings-dialog').isVisible(),true);
    await frame.locator('#stats-settings-cancel').click();
    await page.setViewportSize({width:1512,height:1000});await frame.locator('#shelf-home').click();
    await page.screenshot({path:resolve(__dirname,'../test-results/glass-shelf.png')});
    assert.equal((await workspace.readDocument(active.doc.path)).body,body,'主题切换不应修改文稿');
    assert.deepEqual(active.errors,[]);
    console.log('PASS: six glass palettes, native restoration, persistence, rapid/delayed saves, retry, typography, fullscreen, shelf and mobile settings.');
  }catch(error){if(active)await active.page.screenshot({path:resolve(__dirname,'../test-results/themes-failure.png')}).catch(()=>{});throw error;}
  finally{if(active)await active.close();await browser.close();}
}
if(require.main===module)main().catch(error=>{console.error(error);process.exitCode=1;});
module.exports={main};
