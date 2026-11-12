const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const {readFileSync}=require('node:fs');
const {resolve}=require('node:path');
const assert=require('node:assert/strict');

(async()=>{
  const browser=await chromium.launch({...(process.env.PLAYWRIGHT_CHANNEL ? {channel:process.env.PLAYWRIGHT_CHANNEL} : {}),headless:true});
  try {
    const page=await browser.newPage({viewport:{width:900,height:750}});
    const css=readFileSync(resolve(__dirname,'../src/style.css'),'utf8');
    await page.setContent(`<style>${css}</style><div id="draft-body" contenteditable="true" role="textbox"></div>`);
    const source=readFileSync(resolve(__dirname,'../src/paragraph-editor.mjs'),'utf8');
    await page.addScriptTag({content:source.replace('export function','function')+'\nattachParagraphEditor(document.getElementById("draft-body"));'});
    const editor=page.locator('#draft-body');
    const original='第一段'+'很长的句子'.repeat(50)+'\n第二段\n\n第四段';
    await editor.evaluate((el,value)=>{el.value=value;},original);
    assert.equal(await editor.evaluate(el=>el.value),original);
    const layout=await editor.evaluate(el=>{
      const first=el.children[0].getBoundingClientRect(),second=el.children[1].getBoundingClientRect(),style=getComputedStyle(el);
      return {gap:second.top-first.bottom,font:parseFloat(style.fontSize),line:parseFloat(style.lineHeight)};
    });
    assert.ok(Math.abs(layout.gap-layout.font*1.3)<.05);assert.ok(Math.abs(layout.line-layout.font*1.6)<.05);
    await page.screenshot({path:resolve(__dirname,'../test-results/paragraph-spacing.png')});
    await editor.evaluate(el=>{el.focus();el.setSelectionRange(2,el.value.length-2);});
    assert.deepEqual(await editor.evaluate(el=>[el.selectionStart,el.selectionEnd]),[2,original.length-2]);
    await editor.evaluate(el=>{el.value='甲乙';el.focus();el.setSelectionRange(1,1);});
    await page.keyboard.press('Enter');await page.keyboard.insertText('新段');
    assert.equal(await editor.evaluate(el=>el.value),'甲\n新段乙');
    await page.keyboard.press('Control+z');
    assert.ok(['甲乙','甲\n乙'].includes(await editor.evaluate(el=>el.value)));
    await editor.evaluate(el=>{el.value='甲乙';el.focus();el.setSelectionRange(1,1);});
    await editor.evaluate(el=>{
      const clipboardData=new DataTransfer();clipboardData.setData('text/plain','第一行\n第二行');
      el.dispatchEvent(new ClipboardEvent('paste',{clipboardData,bubbles:true,cancelable:true}));
    });
    assert.equal(await editor.evaluate(el=>el.value),'甲第一行\n第二行乙');
    await page.keyboard.press('Control+z');
    assert.equal(await editor.evaluate(el=>el.value),'甲乙');
    await editor.fill('甲乙');await editor.evaluate(el=>el.setSelectionRange(1,1));
    await page.keyboard.press('Enter');
    assert.equal(await editor.evaluate(el=>el.value),'甲\n乙');
    assert.ok(Math.abs(await editor.evaluate(el=>parseFloat(getComputedStyle(el.lastElementChild).marginTop))-18*1.3)<.05);
    await page.keyboard.press('Backspace');
    assert.equal(await editor.evaluate(el=>el.value),'甲乙');
    const pasted='  缩进 <正文>\n\n　　下一段\n';
    await editor.evaluate((el,value)=>{
      el.value='';el.focus();el.setSelectionRange(0,0);
      const clipboardData=new DataTransfer();clipboardData.setData('text/plain',value);
      el.dispatchEvent(new ClipboardEvent('paste',{clipboardData,bubbles:true,cancelable:true}));
    },pasted);
    assert.equal(await editor.evaluate(el=>el.value),pasted);
    await editor.evaluate(el=>{el.value='另一篇已保存的文稿';el.focus();el.setSelectionRange(0,0);});
    await page.keyboard.press('Control+z');
    assert.equal(await editor.evaluate(el=>el.value),'另一篇已保存的文稿');
    await page.keyboard.press('Control+y');
    assert.equal(await editor.evaluate(el=>el.value),'另一篇已保存的文稿');
    // Every range, including cross-paragraph and empty paragraphs, must preserve source text.
    const projection=await editor.evaluate(el=>{for(const source of ['甲乙\n丙丁\n戊己','甲\n\n乙\n'])for(let start=0;start<source.length;start++)for(let end=start+1;end<=source.length;end++){el.value=source;const proposal=document.createElement('span');proposal.textContent='新内容';el.previewRange(proposal,start,end);if(el.value!==source)return {start,end,source,actual:el.value};el.rebuildSource();if(el.value!==source)return {start,end,source,actual:el.value,stage:'rebuild'};}return null;});
    assert.equal(projection,null,JSON.stringify(projection));
    await editor.evaluate(el=>{el.value='保留正文';el.readOnly=true;});
    assert.equal(await editor.getAttribute('contenteditable'),'false');
    assert.equal(await editor.evaluate(el=>el.value),'保留正文');
    console.log('PASS: 段落排版、原文换行、跨段预览源文本保持、选区、回车、粘贴、撤销及只读。');
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
