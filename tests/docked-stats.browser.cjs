const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
const {fixture}=require('./app-fixture.cjs');
const {resolve}=require('node:path');
const pause=ms=>new Promise(r=>setTimeout(r,ms));

async function geometry(frame){return frame.locator('body').evaluate(()=>{
  const box=selector=>{const element=document.querySelector(selector);if(!element)return null;const rect=element.getBoundingClientRect();return {x:Math.round(rect.x),y:Math.round(rect.y),width:Math.round(rect.width),height:Math.round(rect.height)};};
  const panel=document.getElementById('stats-float');
  return {
    sidebar:box('#workbench-sidebar'),resizer:box('#sidebar-resizer'),document:box('.document'),desk:box('#writing-desk'),
    panel:box('#stats-float'),panelPosition:getComputedStyle(panel).position,panelParent:panel.parentElement?.className||'',
    panelCursor:getComputedStyle(document.getElementById('stats-head')).cursor,
  };
});}

async function main(){
  const browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHANNEL?{channel:process.env.PLAYWRIGHT_CHANNEL}:{})});
  let active;
  try{
    active=await fixture(browser,{body:Array.from({length:32},(_,index)=>`第${index+1}段。他停下脚步，望向街角那盏还亮着的灯。`).join('\n')});
    // 用最宽的内容组合（萌宠 + 四项数据 + 状态行）验证最小宽度下的排版。
    await active.workspace.saveStatsPreferences({fields:['work','words','speed','active','idle','status'],pet:{enabled:true,character:'dragon'},workPath:'测试作品'});
    await active.refresh();
    const {frame,page}=active;
    const panel=frame.locator('#stats-float'),head=frame.locator('#stats-head');

    // 1. 侧栏打开：统计面板固定在侧栏里，正文紧挨分隔条，没有随宽度增长的空隙。
    await page.setViewportSize({width:1512,height:1200});await pause(200);
    let g=await geometry(frame);
    assert.equal(g.panelPosition,'relative');
    assert.ok(g.panelParent.includes('files-sidebar'),'统计面板应固定在文稿侧栏');
    assert.ok(g.panel.x>=g.sidebar.x && g.panel.x+g.panel.width<=g.sidebar.x+g.sidebar.width+1,'统计面板不能超出侧栏');
    assert.equal(Math.round(g.document.x-(g.sidebar.x+g.sidebar.width)),Math.round(g.resizer.width));
    assert.equal(g.document.width,1512-g.sidebar.width-22-48);
    assert.notEqual(g.panelCursor,'grab','固定在侧栏时不应表现为可拖动的浮窗');

    // 2. 侧栏打开时拖不动：按住卡片顶部拖到正文上，仍然留在侧栏。
    const beforeDrag=await panel.boundingBox();
    let grip=await head.boundingBox();
    await page.mouse.move(grip.x+30,grip.y+14);
    await page.mouse.down();
    await page.mouse.move(900,320,{steps:10});
    await page.mouse.up();
    await pause(120);
    assert.equal(await panel.evaluate(el=>getComputedStyle(el).position),'relative');
    assert.deepEqual(await panel.boundingBox(),beforeDrag);

    // 3. 拉宽工作台时，新增宽度给正文。
    await page.setViewportSize({width:2200,height:1200});await pause(200);
    g=await geometry(frame);
    assert.equal(g.desk.width,2200);
    assert.equal(Math.round(g.document.x-(g.sidebar.x+g.sidebar.width)),Math.round(g.resizer.width));
    assert.equal(g.document.width,2200-262-22-48);
    await page.screenshot({path:resolve(__dirname,'../test-results/docked-wide.png')});
    await page.setViewportSize({width:1512,height:1200});await pause(150);

    // 4. 全屏写作：统计面板按原来的悬浮窗逻辑单独出现，可拖动、可用方向键移动。
    await frame.locator('#writing-fullscreen').click();await pause(300);
    const floating=await geometry(frame);
    assert.equal(floating.panelPosition,'fixed');
    assert.equal(await panel.isVisible(),true);
    assert.equal(await frame.locator('#fullscreen-stats-toggle').isVisible(),false);
    assert.equal(floating.panelCursor,'grab');
    assert.ok(floating.panel.x+floating.panel.width<=1512 && floating.panel.y+floating.panel.height<=1200);
    grip=await head.boundingBox();
    await page.mouse.move(grip.x+30,grip.y+14);await page.mouse.down();
    await page.mouse.move(grip.x-220,grip.y-180,{steps:10});await page.mouse.up();
    await pause(120);
    const dragged=await geometry(frame);
    assert.ok(dragged.panel.x<floating.panel.x-150 && dragged.panel.y<floating.panel.y-120,'全屏时浮窗应可拖动');
    await head.focus();
    await head.press('ArrowRight');
    const keyboard=await geometry(frame);
    assert.ok(Math.abs(keyboard.panel.x-dragged.panel.x-10)<1,'浮窗应支持方向键移动');
    await page.screenshot({path:resolve(__dirname,'../test-results/float-fullscreen.png')});

    // 5. 退出全屏：面板回到侧栏；再次全屏时沿用刚才拖到的位置。
    await frame.locator('#writing-fullscreen-exit').click();await pause(250);
    assert.equal(await panel.evaluate(el=>getComputedStyle(el).position),'relative');
    assert.ok((await geometry(frame)).panelParent.includes('files-sidebar'));
    await frame.locator('#writing-fullscreen').click();await pause(300);
    const again=await geometry(frame);
    assert.equal(again.panelPosition,'fixed');
    assert.ok(Math.abs(again.panel.x-keyboard.panel.x)<2 && Math.abs(again.panel.y-keyboard.panel.y)<2,'再次全屏应回到上次拖动的位置');
    await frame.locator('#writing-fullscreen-exit').click();await pause(250);

    // 6. 隐藏再显示：面板回到侧栏，开关状态同步。
    await panel.locator('#stats-hide').click();
    assert.equal(await panel.isVisible(),false);
    await frame.locator('#stats-toggle').click();await pause(150);
    assert.equal(await panel.isVisible(),true);
    assert.equal(await panel.evaluate(el=>getComputedStyle(el).position),'relative');
    assert.equal(await frame.locator('#stats-toggle').getAttribute('aria-expanded'),'true');

    // 7. 重新加载页面（相当于重新打开工作台）后仍然默认固定在侧栏。
    await active.refresh();await pause(300);
    assert.equal(await panel.evaluate(el=>getComputedStyle(el).position),'relative');
    assert.ok((await geometry(frame)).panelParent.includes('files-sidebar'));

    // 8. 回书架再打开作品，同样回到侧栏。
    await frame.locator('#shelf-home').click();await pause(250);
    await frame.locator('.shelf-book[data-path="测试作品"]').click();await pause(250);
    assert.equal(await panel.evaluate(el=>getComputedStyle(el).position),'relative');

    // Compact desktop: the file tree gets the height, while the configured text size is retained.
    await active.workspace.saveSettings({theme:'glass',glassPalette:'mint',fontSize:20});
    await active.refresh();
    const editor=frame.locator('#draft-body'),details=frame.locator('#stats-details-toggle');
    await frame.locator('#stats-pet-stage').waitFor();
    const normalPet=await frame.locator('#stats-pet-image').boundingBox();
    assert.equal(normalPet.width,96);
    for(const [width,height] of [[1100,900],[1024,640]]){
      await page.setViewportSize({width,height});
      await details.waitFor();
      const layout=await editor.evaluate(el=>{
        el.scrollTop=el.scrollHeight;
        return {
          fontSize:getComputedStyle(el).fontSize,
          tree:document.getElementById('file-list').clientHeight,
          stats:document.getElementById('stats-float').clientHeight,
          annotations:document.querySelector('.annotations-panel').clientHeight,
          spaceAfterLastLine:el.getBoundingClientRect().bottom-el.lastElementChild.getBoundingClientRect().bottom,
        };
      });
      assert.equal(layout.fontSize,'20px');
      assert.ok(layout.tree>=240&&layout.tree>layout.stats*2,JSON.stringify(layout));
      assert.ok(layout.annotations<=42,JSON.stringify(layout));
      assert.ok(layout.spaceAfterLastLine>=105,JSON.stringify(layout));
      assert.equal((await frame.locator('#stats-pet-image').boundingBox()).width,34);
      assert.equal(await frame.locator('#stats-work').isVisible(),false);
      await details.click();
      assert.equal(await frame.locator('#stats-work').isVisible(),true);
      await details.click();
      await editor.evaluate(el=>el.scrollTop=0);
      await page.screenshot({path:resolve(__dirname,`../test-results/compact-${width}x${height}.png`)});
    }
    await page.setViewportSize({width:1512,height:1200});
    assert.equal(await details.isVisible(),false);
    assert.equal(await frame.locator('#stats-work').isVisible(),true);

    // 9. 侧栏最窄宽度：保证统计卡片完整显示、不换行不重叠。
    await frame.locator('#sidebar-resizer').focus();
    await frame.locator('#sidebar-resizer').press('Home');
    await pause(250);
    const minimum=await frame.locator('body').evaluate(()=>{
      const rect=element=>element.getBoundingClientRect();
      const panel=document.getElementById('stats-float'),pet=document.getElementById('stats-pet-stage'),actions=document.querySelector('.stats-actions');
      const cells=[...document.querySelectorAll('.stats-grid>div')],labels=[...document.querySelectorAll('.stats-grid span')];
      return {
        sidebarWidth:Math.round(rect(document.getElementById('workbench-sidebar')).width),
        aria:document.getElementById('sidebar-resizer').getAttribute('aria-valuenow'),
        panelOverflow:panel.scrollWidth>panel.clientWidth+1,
        petWidth:Math.round(rect(document.getElementById('stats-pet-image')).width),
        petRight:Math.round(rect(pet).right),actionsLeft:Math.round(rect(actions).left),
        labelsOneLine:labels.every(label=>label.getClientRects().length===1),
        labelsFit:labels.every(label=>label.scrollWidth<=label.clientWidth+1),
        cellsFit:cells.every(cell=>cell.scrollWidth<=cell.clientWidth+1),
      };
    });
    assert.equal(minimum.sidebarWidth,220,'侧栏最窄宽度应为 220px');
    assert.equal(minimum.aria,'220');
    assert.equal(minimum.petWidth,96,'最小宽度下萌宠不能被压缩');
    assert.ok(minimum.actionsLeft>=minimum.petRight,'标题栏图标不能压到萌宠');
    assert.equal(minimum.labelsOneLine,true,'最小宽度下指标名称不能换行');
    assert.equal(minimum.labelsFit,true);
    assert.equal(minimum.cellsFit,true,'最小宽度下数字不能被裁切或重叠');
    assert.equal(minimum.panelOverflow,false);
    await frame.locator('#stats-float').screenshot({path:resolve(__dirname,'../test-results/docked-minimum.png')});

    const coverChoice=frame.locator('[data-stats-option="cover"]');
    await frame.locator('#stats-settings').click();
    await coverChoice.check();
    await frame.locator('#stats-settings-save').click();
    const cover=frame.locator('#stats-cover-block'),pet=frame.locator('#stats-pet-stage');
    await cover.waitFor();
    const box=await cover.boundingBox(),media=await frame.locator('#stats-media').boundingBox();
    assert.ok(Math.abs(box.x+box.width/2-media.x-media.width/2)<2,'窄侧栏封面应居中');
    assert.equal(await frame.locator('#stats-head #stats-pet-stage').count(),1);
    await frame.locator('#sidebar-resizer').press('End');
    await frame.locator('#stats-media #stats-pet-stage').waitFor();
    assert.ok((await pet.boundingBox()).x>(await cover.boundingBox()).x,'左侧栏萌宠在封面右边');
    const resizer=frame.locator('#sidebar-resizer');
    const capped=await geometry(frame);
    assert.equal(capped.sidebar.width,Number(await resizer.getAttribute('aria-valuemax')));
    const spare=await frame.locator('#stats-media').evaluate(el=>el.clientWidth
      - el.querySelector('#stats-cover-block').offsetWidth
      - el.querySelector('#stats-pet-stage').offsetWidth
      - parseFloat(getComputedStyle(el).columnGap));
    assert.ok(spare>=0&&spare<=1,'最大宽度只留够封面、间距和萌宠');
    await resizer.press('ArrowRight');
    assert.equal((await geometry(frame)).sidebar.width,capped.sidebar.width);
    const bar=await resizer.boundingBox();
    await page.mouse.move(bar.x+bar.width/2,bar.y+50);
    await page.mouse.down();
    await page.mouse.move(bar.x+200,bar.y+50,{steps:4});
    await page.mouse.up();
    assert.equal((await geometry(frame)).sidebar.width,capped.sidebar.width);
    assert.deepEqual(await head.evaluate(el=>{
      const style=getComputedStyle(el);
      return [style.backgroundColor,style.backgroundImage];
    }),['rgba(0, 0, 0, 0)','none']);
    await frame.locator('#appearance-open').click();
    await frame.locator('#settings-tab-layout').click();
    await frame.locator('#sidebar-side').selectOption('right');
    assert.ok((await pet.boundingBox()).x<(await cover.boundingBox()).x,'右侧栏萌宠在封面左边');
    await frame.locator('#sidebar-side').selectOption('left');
    await frame.locator('#appearance-close').click();
    await frame.locator('#stats-settings').click();
    await coverChoice.uncheck();
    await frame.locator('#stats-settings-save').click();
    await cover.waitFor({state:'hidden'});

    // 10. 窄窗：按需打开文稿抽屉，正文和抽屉均不产生横向溢出。
    const narrowHeight=()=>editor.evaluate(el=>({
      editorHeight:el.clientHeight,
      pageHeight:document.documentElement.scrollHeight,
      fontSize:getComputedStyle(el).fontSize,
      gapBeforeNotes:document.querySelector('.writing-sidebar').getBoundingClientRect().top-el.closest('.document').getBoundingClientRect().bottom,
    }));
    await page.setViewportSize({width:780,height:700});
    const medium=await narrowHeight();
    assert.ok(medium.editorHeight>340&&medium.pageHeight<=701&&medium.gapBeforeNotes<=15,JSON.stringify(medium));
    assert.equal(medium.fontSize,'20px');
    await page.setViewportSize({width:390,height:700});await pause(250);
    assert.ok(await frame.locator('body').evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    const filesToggle=frame.locator('#compact-files-toggle');
    assert.equal(await frame.locator('#workbench-files').isVisible(),false);
    const closed=await narrowHeight();
    assert.ok(closed.editorHeight>340&&closed.pageHeight<=701&&closed.gapBeforeNotes<=15,JSON.stringify(closed));
    await filesToggle.click();
    assert.equal(await frame.locator('#workbench-files').isVisible(),true);
    assert.ok(await frame.locator('#file-list').isVisible());
    const narrow=await geometry(frame);
    assert.ok(narrow.panel.width<=390,'窄窗下统计面板不应被撑出窗口');
    assert.equal(await panel.isVisible(),true);
    await page.screenshot({path:resolve(__dirname,'../test-results/docked-narrow.png'),fullPage:true});
    await filesToggle.press('Escape');
    assert.equal(await frame.locator('#workbench-files').isVisible(),false);
    assert.deepEqual(await narrowHeight(),closed);
    await page.screenshot({path:resolve(__dirname,'../test-results/narrow-writing-390x700.png')});

    // 小窗全屏先收起统计，可从标题栏打开。退出全屏后保留侧栏的可见状态。
    const fullscreenStats=frame.locator('#fullscreen-stats-toggle');
    await frame.locator('#writing-fullscreen').click();
    await fullscreenStats.waitFor();
    assert.equal(await fullscreenStats.getAttribute('aria-expanded'),'false');
    assert.equal(await panel.isVisible(),false);
    assert.equal(await editor.evaluate(el=>getComputedStyle(el).fontSize),'20px');
    await page.screenshot({path:resolve(__dirname,'../test-results/narrow-fullscreen-390x700.png')});
    await fullscreenStats.click();
    assert.equal(await fullscreenStats.getAttribute('aria-expanded'),'true');
    assert.equal(await panel.isVisible(),true);
    await panel.locator('#stats-hide').click();
    assert.equal(await fullscreenStats.getAttribute('aria-expanded'),'false');
    assert.equal(await panel.isVisible(),false);
    assert.equal(await fullscreenStats.evaluate(el=>el===document.activeElement),true);
    await fullscreenStats.click();
    await frame.locator('#writing-fullscreen-exit').click();
    await filesToggle.click();
    assert.equal(await panel.isVisible(),true);
    await frame.locator('#writing-fullscreen').click();
    await fullscreenStats.waitFor();
    assert.equal(await panel.isVisible(),false);
    assert.deepEqual(active.errors,[]);
    console.log('PASS: 窄窗正文填满剩余高度且字号不变，小窗全屏统计默认收起并可展开，宽屏统计保持可移动。');
  }finally{ if(active)await active.close(); await browser.close(); }
}
if(require.main===module)main().catch(error=>{console.error(error);process.exitCode=1;});
module.exports={main};
