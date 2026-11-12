import {App,applyDocumentTheme,applyHostStyleVariables} from '@modelcontextprotocol/ext-apps';
import {OpenAIExtensions} from '@openai/mcp-extensions/app';
import {countWords,WritingClock,formatTime} from './core.mjs';
import {attachWorkspace} from './workspace-ui.mjs';
import {attachWritingFullscreen} from './writing-fullscreen.mjs';
import {attachFloatingStats} from './floating-stats.mjs';
import {attachParagraphEditor} from './paragraph-editor.mjs';
import {attachPen} from './pen-ui.mjs';
import {decorateButton} from './icons.mjs';
import {attachWriterTools} from './writer-tools-ui.mjs';
import {attachFileComparison} from './pen-compare.mjs';

const $=id=>document.getElementById(id),editor=attachParagraphEditor($('draft-body')),title=$('draft-title'),feedback=$('feedback'),menu=$('selection-menu'),clock=new WritingClock();
const writingFullscreen=attachWritingFullscreen({editor});
let connected=false,messageSupported=false,composing=false,words=0,hostDisplayMode='',availableDisplayModes=null,changingDisplay=false;
const app=new App({name:'writer-workbench',version:'0.5.0'},{availableDisplayModes:['fullscreen','inline']}),extensions=new OpenAIExtensions(app);
async function callTool(name,args){const result=await app.callServerTool({name,arguments:args});if(result.isError)throw new Error(result.content?.find(c=>c.type==='text')?.text||'本地服务未完成请求。');if(!result.structuredContent)throw new Error('本地服务返回格式不正确。');return result.structuredContent;}
const notify=text=>{feedback.textContent=text;};
const workspace=attachWorkspace({app,editor,title,clock,callTool,notify,isComposing:()=>composing,onLoaded:()=>{words=countWords(editor.value);renderStats();}});
attachFloatingStats({callTool,notify});
const showComparison=attachFileComparison($('pen-compare-dialog'),{workspace,callTool});
const pen=attachPen({editor,title,workspace,callTool,notify,showComparison,canMessage:()=>connected&&messageSupported,sendMessage:async params=>{const result=await extensions.message.send(params);if(result?.isError)throw new Error('宿主未确认发送，请检查聊天后重试。');}});
attachWriterTools({editor,workspace,callTool,notify});
function renderDisplay(){const button=$('fullscreen');button.hidden=hostDisplayMode==='fullscreen'||Boolean(availableDisplayModes&&!availableDisplayModes.includes('fullscreen'));button.disabled=!connected||changingDisplay;}
function applyHost(context){if(context?.theme)applyDocumentTheme(context.theme);if(context?.styles?.variables)applyHostStyleVariables(context.styles.variables);workspace.applyAppearance();if(context?.displayMode)hostDisplayMode=context.displayMode;if(context?.availableDisplayModes)availableDisplayModes=context.availableDisplayModes;renderDisplay();}
function renderStats(){
  const now=performance.now();clock.advance(now);workspace.collectTime();
  const state=clock.running&&now-clock.lastInput<clock.idleThreshold?'writing':'resting';if($('stats-float').dataset.writingState!==state){$('stats-float').dataset.writingState=state;document.dispatchEvent(new CustomEvent('workbench:writing-state',{detail:state}));}
  $('word-total').textContent=words.toLocaleString('zh-CN')+' 字';$('session-count').textContent=workspace.added.toLocaleString('zh-CN');$('writing-speed').textContent=clock.activeMs>=15000?Math.round(workspace.added*3600000/clock.activeMs).toLocaleString('zh-CN'):'—';$('active-time').textContent=formatTime(clock.activeMs);$('idle-time').textContent=formatTime(clock.idleMs);$('pause').disabled=!clock.running;
  const finish=$('finish-writing');finish.disabled=!workspace.canFinish;const label=workspace.finishStatus==='saving'?'保存中':'结束';if(finish.getAttribute('aria-label')!==label)decorateButton(finish,label,'stop');
  $('timer-state').textContent=workspace.finishStatus==='saving'?'正在保存今日进展…':workspace.finishStatus==='saved'?'本次已结束，今日进展已保存。':workspace.finishStatus==='error'?'保存未完成，请重试结束。':!clock.started?'':!clock.running?'已暂停，继续输入后恢复。':now-clock.lastInput>=clock.idleThreshold?'空闲中，下次输入继续码字。':'正在码字';
}
function onEdit(){if(composing)return;workspace.onEdit();words=countWords(editor.value);clock.input(performance.now());renderStats();}
let fontWheel=0,fontWheelTimer;
$('draft-body').addEventListener('wheel',event=>{
  if(!(event.ctrlKey||event.metaKey))return;
  event.preventDefault();
  // 触控板/滚轮的事件可能被合并，按滚动量累计，约每 100 像素调一档。
  fontWheel+=event.deltaY*(event.deltaMode===1?33:1);
  const steps=Math.trunc(fontWheel/100);
  if(steps!==0){fontWheel-=steps*100;workspace.adjustFontSize(-steps);}
  clearTimeout(fontWheelTimer);fontWheelTimer=setTimeout(()=>{fontWheel=0;},300);
},{passive:false});
editor.addEventListener('compositionstart',e=>{if(!editor.isDecorationEvent(e))composing=true;});editor.addEventListener('compositionend',e=>{if(!editor.isDecorationEvent(e)){composing=false;onEdit();}});editor.addEventListener('input',e=>{if(!editor.isDecorationEvent(e))onEdit();});
editor.addEventListener('contextmenu',event=>{if(editor.isDecorationEvent(event))return;event.preventDefault();if(editor.selectionStart===editor.selectionEnd&&!editor.readOnly&&(event.clientX||event.clientY))editor.setCaretFromPoint(event.clientX,event.clientY);pen.refreshAvailability();menu.hidden=false;const bounds=menu.getBoundingClientRect();menu.style.left=Math.max(8,Math.min(event.clientX,innerWidth-bounds.width-8))+'px';menu.style.top=Math.max(8,Math.min(event.clientY,innerHeight-bounds.height-8))+'px';$('menu-pen').focus();});
document.addEventListener('pointerdown',e=>{if(!menu.contains(e.target))menu.hidden=true;});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!e.defaultPrevented&&!document.querySelector('dialog[open]')){menu.hidden=true;$('pen-toolbar').hidden=true;editor.focus({preventScroll:true});}if(!menu.hidden&&['ArrowUp','ArrowDown'].includes(e.key)){e.preventDefault();$('menu-pen').focus();}});
window.addEventListener('resize',()=>menu.hidden=true);
$('pause').onclick=()=>{clock.pause(performance.now());renderStats();workspace.flushRecords().catch(()=>{});};$('finish-writing').onclick=()=>workspace.finishWriting();
$('fullscreen').onclick=async()=>{if(!connected||changingDisplay)return;changingDisplay=true;renderDisplay();try{const result=await app.requestDisplayMode({mode:'fullscreen'},{timeout:8000});hostDisplayMode=result.mode;if(result.mode==='fullscreen')writingFullscreen.set(true);}catch{notify('请使用客户端面板的展开入口。');}finally{changingDisplay=false;renderDisplay();}};
for(const [id,label,name] of [['shelf-home','返回书架','shelf'],['search-open','查找与替换','search'],['backup-open','文稿备份','history'],['refresh-files','刷新文件列表和当前文稿','again'],['trash-open','文稿回收站','archive'],['writing-fullscreen','全屏写作','expand'],['writing-fullscreen-exit','退出全屏','collapse'],['annotations-to-chat','全部发送批注','send'],['annotations-clear','删除全部批注','trash'],['pen-history-open','递笔记录','history'],['pause','暂停','pause'],['pen-history-close','关闭','close'],['pen-version-close','关闭','close'],['pen-note-picker-close','关闭','close'],['search-close','关闭','close'],['backup-close','关闭','close']])if($(id))decorateButton($(id),label,name);
app.ontoolresult=()=>{};app.addEventListener('hostcontextchanged',applyHost);renderStats();
setInterval(()=>{if(!document.hidden)renderStats();},500);
const timeout=setTimeout(()=>{if(!connected){$('host-status').textContent='等待连接';notify('本地服务尚未连接，编辑内容会保留在当前页面。');}},8000);
app.connect().then(async()=>{connected=true;clearTimeout(timeout);applyHost(app.getHostContext());messageSupported=extensions.message!=null;$('host-status').textContent='已连接宿主';renderDisplay();await workspace.connected();await pen.connected(Boolean(workspace.features.pen));}).catch(error=>{clearTimeout(timeout);$('host-status').textContent='连接未完成';notify(error.message);});
