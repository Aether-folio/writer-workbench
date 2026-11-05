import {App, applyDocumentTheme, applyHostStyleVariables} from '@modelcontextprotocol/ext-apps';
import {OpenAIExtensions} from '@openai/mcp-extensions/app';
import {countWords,quoteChatMessage,annotationBatchMessage,WritingClock,formatTime} from './core.mjs';
import {attachWorkspace} from './workspace-ui.mjs';
import {attachWritingFullscreen} from './writing-fullscreen.mjs';
import {attachFloatingStats} from './floating-stats.mjs';
import {attachParagraphEditor} from './paragraph-editor.mjs';
import {attachWritingSuggestions} from './writing-suggestions-ui.mjs';

const $ = id => document.getElementById(id);
const editor = attachParagraphEditor($('draft-body'));
const writingFullscreen=attachWritingFullscreen({editor});
const title = $('draft-title');
const feedback = $('feedback');
const menu = $('selection-menu');
const menuButton = $('menu-quote');
const dialog = $('annotation-dialog');
const annotationBody = $('annotation-body');
const quoteDialog=$('quote-chat-dialog'),quoteInstruction=$('quote-chat-instruction');
let activeQuote=null,quoteSending=false,quoteComposing=false;
const clock = new WritingClock();
let selection = '';
let menuSelection = '';
let composing = false;
let messageSupported = false;
let adding = false;
let appConnected = false;
let timer;
let annotations = [];
let nextAnnotationId=0;
let activeAnnotation = null;
let savingAnnotation = false;
let addingAnnotations=false,annotationChatNotice='';
let hostDisplayMode='',availableDisplayModes=null,changingDisplay=false;

const app = new App({name:'writer-workbench',version:'0.4.3'}, {availableDisplayModes:['fullscreen','inline']});
const extensions = new OpenAIExtensions(app);
const workspace=attachWorkspace({app,editor,title,clock,callTool:callAnnotationTool,notify:message=>{feedback.textContent=message;},onLoaded:()=>{renderStats();updateSelection();}});
attachFloatingStats({callTool:callAnnotationTool,notify:message=>{feedback.textContent=message;}});
const writingSuggestions=attachWritingSuggestions({editor,title,workspace,callTool:callAnnotationTool,
  canMessage:()=>appConnected && messageSupported,
  sendMessage:async params=>{const result=await extensions.message.send(params);if(result?.isError)throw new Error('写作请求发送失败，请重试。');},
  notify:message=>{feedback.textContent=message;},
});

function applyHost(context) {
  if (context?.theme) applyDocumentTheme(context.theme);
  if (context?.styles?.variables) applyHostStyleVariables(context.styles.variables);
  workspace.applyAppearance();
  if(context?.displayMode) {
    if(context.displayMode!==hostDisplayMode && !changingDisplay)$('display-status').hidden=true;
    hostDisplayMode=context.displayMode;
  }
  if(context?.availableDisplayModes)availableDisplayModes=context.availableDisplayModes;
  renderDisplayAction();
}
function renderDisplayAction() {
  $('fullscreen').hidden=hostDisplayMode==='fullscreen' || Boolean(availableDisplayModes && !availableDisplayModes.includes('fullscreen'));
  $('fullscreen').disabled=!appConnected || changingDisplay;
  $('fullscreen').textContent=changingDisplay?'正在展开…':'展开工作台';
}
function renderStats() {
  const now = performance.now();
  clock.advance(now);
  workspace.collectTime();
  const writingState=clock.running && now-clock.lastInput<clock.idleThreshold ? 'writing' : 'resting';
  if($('stats-float').dataset.writingState!==writingState) {
    $('stats-float').dataset.writingState=writingState;
    document.dispatchEvent(new CustomEvent('workbench:writing-state',{detail:writingState}));
  }
  const count = countWords(editor.value);
  $('word-total').textContent = count.toLocaleString('zh-CN') + ' 字';
  $('session-count').textContent = workspace.added.toLocaleString('zh-CN');
  $('writing-speed').textContent = clock.activeMs >= 15000 ? Math.round(workspace.added * 3600000 / clock.activeMs).toLocaleString('zh-CN') : '—';
  $('active-time').textContent = formatTime(clock.activeMs);
  $('idle-time').textContent = formatTime(clock.idleMs);
  $('pause').disabled = !clock.running;
  $('finish-writing').disabled = !workspace.canFinish;
  $('finish-writing').textContent = workspace.finishStatus==='saving' ? '保存中…' : '结束';
  $('timer-state').textContent = workspace.finishStatus==='saving' ? '正在保存今日进展…' : workspace.finishStatus==='saved' ? '本次已结束，今日进展已保存。' : workspace.finishStatus==='error' ? '保存未完成，请重试「结束」。' : !clock.started ? '' : !clock.running ? '已暂停，继续输入后恢复。' : now - clock.lastInput >= clock.idleThreshold ? '空闲中，下次输入继续码字。' : '正在码字';
}
function updateSelection() {
  selection = editor.value.slice(editor.selectionStart, editor.selectionEnd);
}
function renderAnnotationChatAction() {
  const button=$('annotations-to-chat');
  button.disabled=!appConnected || !messageSupported || !annotations.length || adding || savingAnnotation;
  button.textContent=addingAnnotations?'正在发送…':'全部发送到聊天';
  button.title=!messageSupported?'当前宿主未开放聊天发送接口':`直接发送全部 ${annotations.length} 条批注到当前聊天`;
  const status=$('annotation-chat-status');
  status.textContent=addingAnnotations?'正在发送…':annotationChatNotice || (appConnected && !messageSupported?'当前宿主未开放聊天发送接口。':'');
  status.hidden=!status.textContent;
}
function renderAnnotations() {
  const list = $('annotation-list');
  list.replaceChildren();
  $('annotation-count').textContent = `${annotations.length} 条`;
  for (const annotation of [...annotations].sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt))) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'annotation-card';
    item.dataset.id = annotation.id;
    item.setAttribute('aria-label',`修改批注：${annotation.body.slice(0,40)}`);
    const source = document.createElement('span');
    source.className = 'annotation-source';
    source.textContent = annotation.title;
    const quote = document.createElement('span');
    quote.className = 'annotation-excerpt';
    quote.textContent = annotation.quote;
    const body = document.createElement('span');
    body.className = 'annotation-content';
    body.textContent = annotation.body;
    const date = document.createElement('time');
    date.dateTime = annotation.updatedAt;
    date.textContent = new Intl.DateTimeFormat('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}).format(new Date(annotation.updatedAt));
    item.append(source,quote,body,date);
    item.addEventListener('click',()=>openAnnotation(annotation));
    list.append(item);
  }
  renderAnnotationChatAction();
}
async function callAnnotationTool(name,args) {
  const result = await app.callServerTool({name,arguments:args});
  if (result.isError) throw new Error(result.content?.find(item=>item.type==='text')?.text || '批注服务未完成请求。');
  if (!result.structuredContent) throw new Error('批注服务返回格式不正确。');
  return result.structuredContent;
}
function openAnnotation(existing) {
  menu.hidden = true;
  if (!existing && !menuSelection.trim()) return;
  activeAnnotation = existing ? {...existing} : {title:title.value.trim() || '未命名草稿',quote:menuSelection,path:workspace.path};
  $('annotation-dialog-heading').textContent = existing ? '修改批注' : '添加批注';
  $('annotation-save').textContent = existing ? '更新批注' : '加入批注';
  $('annotation-quote').textContent = activeAnnotation.quote;
  annotationBody.value = existing?.body || '';
  $('annotation-error').textContent = '';
  dialog.showModal();
  annotationBody.focus();
}
function closeAnnotation() {
  if (savingAnnotation) return;
  dialog.close();
  activeAnnotation = null;
  editor.focus();
}
async function saveAnnotation(event) {
  event.preventDefault();
  if (savingAnnotation || !activeAnnotation) return;
  const body = annotationBody.value.trim();
  if (!body) { $('annotation-error').textContent = '请先填写批注内容。'; annotationBody.focus(); return; }
  savingAnnotation = true;
  renderAnnotationChatAction();
  $('annotation-save').disabled = true;
  $('annotation-save').textContent = '正在添加…';
  annotationBody.readOnly = true;
  try {
    const now=new Date().toISOString();
    const annotation={...activeAnnotation,id:activeAnnotation.id || `annotation-${++nextAnnotationId}`,body,createdAt:activeAnnotation.createdAt || now,updatedAt:now};
    const index = annotations.findIndex(item=>item.id===annotation.id);
    if (index<0) annotations.push(annotation);
    else annotations[index] = annotation;
    annotationChatNotice='';
    renderAnnotations();
    dialog.close();
    activeAnnotation = null;
    feedback.textContent = '';
    editor.focus();
  } catch (error) {
    $('annotation-error').textContent = '添加未完成：' + (error instanceof Error ? error.message : '请重试。');
  } finally {
    savingAnnotation = false;
    $('annotation-save').disabled = false;
    $('annotation-save').textContent = '加入批注';
    annotationBody.readOnly = false;
    renderAnnotationChatAction();
  }
}
function onEdit() {
  if (composing) return;
  workspace.onEdit();
  clock.input(performance.now());
  renderStats();
  updateSelection();
  if (!timer) timer = setInterval(renderStats,500);
}
function openQuoteChat(text) {
  if(adding || !text.trim())return;
  if(!messageSupported || !extensions.message){feedback.textContent='当前宿主未开放聊天发送接口。';return;}
  activeQuote={text,title:title.value.trim() || '未命名草稿',path:workspace.path};
  quoteComposing=false;
  menu.hidden=true;$('quote-chat-selection').textContent=text;quoteInstruction.value='';$('quote-chat-error').textContent='';
  quoteDialog.showModal();quoteInstruction.focus();
}
function closeQuoteChat() {
  if(quoteSending)return;
  quoteDialog.close();activeQuote=null;editor.focus();
}
async function sendQuoteChat() {
  if(adding || quoteSending || !activeQuote)return;
  let params;
  try {params=quoteChatMessage(activeQuote.text,quoteInstruction.value,activeQuote.title,activeQuote.path);}
  catch(error){$('quote-chat-error').textContent=error.message;quoteInstruction.focus();return;}
  adding=true;quoteSending=true;quoteInstruction.readOnly=true;$('quote-chat-send').disabled=true;$('quote-chat-send').textContent='正在发送…';$('quote-chat-error').textContent='';renderAnnotationChatAction();
  try {
    const result = await extensions.message.send(params);
    if (result?.isError) throw new Error('宿主未完成发送，请重试。');
    quoteDialog.close();activeQuote=null;feedback.textContent='选区和对话内容已发送，等待 AI 回复。';
  } catch (error) {
    $('quote-chat-error').textContent='发送未完成：'+(error instanceof Error?error.message:'请重试。');
  } finally {
    adding=false;quoteSending=false;quoteInstruction.readOnly=false;$('quote-chat-send').disabled=false;$('quote-chat-send').textContent='发送到聊天';renderAnnotationChatAction();
  }
}

async function addAnnotationsToChat() {
  if(adding || savingAnnotation || !annotations.length)return;
  if(!messageSupported || !extensions.message){annotationChatNotice='当前宿主未开放聊天发送接口，暂不可发送批注。';renderAnnotationChatAction();return;}
  adding=true;addingAnnotations=true;annotationChatNotice='';renderAnnotationChatAction();
  try {
    const submitted=[...annotations],params=annotationBatchMessage(submitted),count=submitted.length;
    const result=await extensions.message.send(params);
    if(result?.isError)throw new Error('宿主未完成批注发送，请重试。');
    annotations=annotations.filter(annotation=>!submitted.includes(annotation));
    renderAnnotations();
    annotationChatNotice=`已发送 ${count} 条批注，等待 AI 回复。`;
  } catch(error) {
    annotationChatNotice='发送未完成：'+(error instanceof Error?error.message:'请重试。');
  } finally {
    adding=false;addingAnnotations=false;renderAnnotationChatAction();feedback.textContent=annotationChatNotice;
  }
}

editor.addEventListener('compositionstart',event=>{if(!editor.isDecorationEvent(event))composing=true;});
editor.addEventListener('compositionend',event=>{if(!editor.isDecorationEvent(event)){composing=false;onEdit();}});
editor.addEventListener('input',event=>{if(!editor.isDecorationEvent(event))onEdit();});
for (const event of ['select','keyup','pointerup']) editor.addEventListener(event,updateSelection);
editor.addEventListener('contextmenu',event=>{
  if(editor.isDecorationEvent(event))return;
  updateSelection();
  if(!selection && !editor.readOnly && (event.clientX || event.clientY)){
    editor.setCaretFromPoint(event.clientX,event.clientY);updateSelection();
  }
  event.preventDefault();
  menuSelection = selection;
  menuButton.disabled = !selection.trim() || !messageSupported || adding;
  $('menu-annotate').disabled=!selection.trim();
  writingSuggestions.refreshAvailability();
  menu.hidden = false;
  menu.style.left = '8px';
  menu.style.top = '8px';
  const bounds = menu.getBoundingClientRect();
  menu.style.left = Math.max(8,Math.min(event.clientX,innerWidth-bounds.width-8)) + 'px';
  menu.style.top = Math.max(8,Math.min(event.clientY,innerHeight-bounds.height-8)) + 'px';
  menu.querySelector('button:not(:disabled)')?.focus();
});
menuButton.addEventListener('click',()=>openQuoteChat(menuSelection));
$('quote-chat-cancel').addEventListener('click',closeQuoteChat);
$('quote-chat-send').addEventListener('click',sendQuoteChat);
quoteDialog.addEventListener('cancel',event=>{event.preventDefault();closeQuoteChat();});
quoteInstruction.addEventListener('compositionstart',()=>{quoteComposing=true;});
quoteInstruction.addEventListener('compositionend',()=>{quoteComposing=false;});
quoteInstruction.addEventListener('input',()=>{$('quote-chat-error').textContent='';});
quoteInstruction.addEventListener('keydown',event=>{
  if(event.key!=='Enter' || event.shiftKey || event.isComposing || quoteComposing || event.keyCode===229)return;
  event.preventDefault();if(!event.repeat)sendQuoteChat();
});
$('menu-annotate').addEventListener('click',()=>openAnnotation());
$('annotation-save').addEventListener('click',saveAnnotation);
$('annotation-close').addEventListener('click',closeAnnotation);
$('annotation-cancel').addEventListener('click',closeAnnotation);
$('annotations-to-chat').addEventListener('click',addAnnotationsToChat);
dialog.addEventListener('cancel',event=>{event.preventDefault();closeAnnotation();});
document.addEventListener('pointerdown',event=>{if (!menu.contains(event.target)) menu.hidden=true;});
document.addEventListener('keydown',event=>{
  if(event.key==='Escape' && !document.querySelector('dialog[open]')){menu.hidden=true;editor.focus();}
  if (!menu.hidden && ['ArrowDown','ArrowUp'].includes(event.key)) {
    event.preventDefault();
    const items=[...menu.querySelectorAll('button:not(:disabled)')];
    const step=event.key==='ArrowDown' ? 1 : -1;
    items[(items.indexOf(document.activeElement)+step+items.length)%items.length]?.focus();
  }
});
window.addEventListener('resize',()=>{menu.hidden=true;});
$('pause').addEventListener('click',()=>{clock.pause(performance.now());renderStats();workspace.flushRecords().catch(()=>{});});
$('finish-writing').addEventListener('click',()=>workspace.finishWriting());
$('select-all').addEventListener('click',()=>{editor.focus();editor.select();updateSelection();});
$('fullscreen').addEventListener('click',async()=>{
  if (!appConnected || changingDisplay) return;
  changingDisplay=true;renderDisplayAction();
  const status=$('display-status');status.hidden=false;status.textContent='正在展开工作台…';
  try {
    const result=await app.requestDisplayMode({mode:'fullscreen'},{timeout:8000});
    hostDisplayMode=result.mode;if(result.mode==='fullscreen')writingFullscreen.set(true);
    status.textContent=result.mode==='fullscreen'?'工作台已展开':'当前窗口未能展开，请使用工作台面板的展开入口。';
  } catch {status.textContent='当前窗口无法展开，请使用工作台面板的展开入口。';}
  finally {changingDisplay=false;renderDisplayAction();}
});

app.ontoolresult = () => {};
app.addEventListener('hostcontextchanged',applyHost);
renderStats();
renderAnnotationChatAction();
const connectionTimeout = setTimeout(()=>{
  if (!appConnected) {
    $('host-status').textContent='尚未连接宿主';
  }
},8000);
app.connect().then(()=>{
  appConnected=true;
  clearTimeout(connectionTimeout);
  applyHost(app.getHostContext());
  messageSupported=extensions.message != null;
  $('host-status').textContent='已连接宿主';
  menuButton.title=messageSupported ? '在工作台填写对话内容后直接发送' : '宿主未开放聊天发送接口';
  writingSuggestions.refreshAvailability();
  renderDisplayAction();
  updateSelection();
  renderAnnotations();
  workspace.connected().then(async()=>{
    const info=await callAnnotationTool('workspace_info',{});
    await writingSuggestions.connected(Boolean(info.features?.writingSuggestions));
  }).catch(error=>{feedback.textContent=error.message;});
}).catch(error=>{
  clearTimeout(connectionTimeout);
  $('host-status').textContent='连接未完成';
  feedback.textContent=error instanceof Error ? error.message : '宿主连接失败。';
});
