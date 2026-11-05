import {dayKey,splitDays,editCounts,aggregateDays} from './writing-records.mjs';
import {formatTime} from './core.mjs';
import {attachSidebar} from './sidebar.mjs';
import {buildShelfItems,pickWorkDocument,pickLatestDocument,renderShelf as renderShelfView,shelfSummary} from './shelf.mjs';

const $=id=>document.getElementById(id);
const uid=()=>globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const presets=[['纸白','#fffdf8'],['米黄','#f5edd8'],['豆绿','#dce8d2'],['雾蓝','#e2edf2'],['浅灰','#e6e7e9'],['夜墨','#242825']];
const number=value=>Math.round(value).toLocaleString('zh-CN');

export function attachWorkspace({app,editor,title,clock,callTool,notify,onLoaded}) {
  let connected=false,path='',revision='',lastBody=editor.value,dirty=false,editVersion=0,documentSaving=null,saveTimeout;
  let titleSnapshot='',renamingTitle=false,titleCommit=null;
  let settings={background:'#fffdf8'},fileList=[],newMode='blank',creating=false,historyMonth=dayKey().slice(0,7),selectedDay=dayKey(),historyGeneration=0,historyDays={};
  let added=0,seenActive=0,seenIdle=0,statsSaving=null,statsVersion=0,savedStatsVersion=0,lastFlush=Date.now();
  let directoryList=[],workList=[],worksReady=false,selectedFolder='',newFolder='',statsPreferencesReady=false,lastStatsContext=null;
  let shelfCovers=new Map(),shelfCoversGeneration=0,shelfReady=false,draftInfo={title:'未命名草稿',body:''};
  let workDialogMode='add',workRenameTarget='',shelfMenuTarget=null,shelfMenuAnchor=null,coverTarget='',shelfStatusTimer;
  const records=new Map();
  let pendingDelete=null,deleteGeneration=0,trashReady=false,trashBusy=false,pendingTrash=null;
  let finishStatus='';
  const sidebar=attachSidebar({editor,onOpen:openDocument,onDelete:requestDelete,onCreate:folder=>openNameDialog('blank',folder),onRename:(filePath,name)=>renameFile(filePath,name),onRenameFolder:(folderPath,name)=>renameFolder(folderPath,name),onSelectFolder:folder=>{selectedFolder=folder;updateStatsWork();},showEditor});
  function updateStatsWork() {
    const location=path || selectedFolder;
    const work=workList.find(item=>location===item.path || location.startsWith(item.path+'/'));
    const name=work ? `《${work.name.replace(/^《(.*)》$/,'$1')}》` : '未选择作品';
    $('stats-work').textContent=name;$('stats-work').title=name;
    $('stats-drag-handle').setAttribute('aria-label',`移动码字悬浮窗，${name}，使用方向键移动`);
    const contextKey=`${statsPreferencesReady}:${work?.path || ''}`;
    if(contextKey!==lastStatsContext) {
      lastStatsContext=contextKey;document.dispatchEvent(new CustomEvent('workbench:workchange',{detail:{work:work || null,supported:statsPreferencesReady}}));
    }
  }
  function acceptWorkspaceInfo(info) {
    fileList=info.files;directoryList=info.directories || [{name:'文稿',path:'文稿'}];workList=info.works || [];
    if(!fileList.some(file=>file.path.startsWith('文稿/')))directoryList=directoryList.filter(folder=>folder.path!=='文稿' && !folder.path.startsWith('文稿/'));
    trashReady=Boolean(info.features?.trash);worksReady=Boolean(info.features?.works);statsPreferencesReady=Boolean(info.features?.statsPreferences);
    if(!directoryList.some(item=>item.path===selectedFolder))selectedFolder=workList.length ? workList[0].path+'/正文' : directoryList[0]?.path || '';
    if(info.draft) draftInfo=info.draft;
    shelfReady=true;
    renderFiles();
    renderShelf();
    if(!$('shelf-page').hidden)loadCovers().catch(()=>{});
  }
  function renderShelf() {
    const items=buildShelfItems({works:workList,files:fileList,covers:shelfCovers,draft:draftInfo});
    renderShelfView($('shelf-grid'),{items,ready:shelfReady,canCreate:worksReady,onCreate:openWorkDialog,onOpen:openShelfItem,onContextMenu:openShelfMenu});
    $('shelf-subtitle').textContent=shelfReady ? shelfSummary(items) : '正在整理书架…';
  }
  function shelfStatus(message,tone='info') {
    const status=$('shelf-status');
    if(!status)return;
    status.textContent=message;
    if(tone==='error')status.dataset.tone='error';else delete status.dataset.tone;
    clearTimeout(shelfStatusTimer);
    if(message)shelfStatusTimer=setTimeout(()=>{status.textContent='';delete status.dataset.tone;},3200);
  }
  function closeShelfMenu(restoreFocus=false) {
    const menu=$('shelf-menu'),anchor=shelfMenuAnchor;
    if(menu && !menu.hidden)menu.hidden=true;
    shelfMenuTarget=null;shelfMenuAnchor=null;
    if(restoreFocus && anchor?.isConnected)anchor.focus({preventScroll:true});
  }
  function openShelfMenu(item,anchor,event) {
    const menu=$('shelf-menu');
    if(!menu || item.kind!=='work')return;
    closeShelfMenu();
    shelfMenuTarget=item;shelfMenuAnchor=anchor;
    for(const button of menu.querySelectorAll('button[data-action]')) {
      if(button.dataset.action==='remove-cover')button.hidden=!shelfCovers.get(item.path);
    }
    menu.hidden=false;menu.style.left='0px';menu.style.top='0px';
    const bounds=menu.getBoundingClientRect(),rect=anchor.getBoundingClientRect();
    const x=event.clientX || rect.left+24,y=event.clientY || rect.top+24;
    menu.style.left=Math.max(8,Math.min(x,innerWidth-bounds.width-8))+'px';
    menu.style.top=Math.max(8,Math.min(y,innerHeight-bounds.height-8))+'px';
    menu.querySelector('button:not([hidden])')?.focus({preventScroll:true});
  }
  async function saveWorkCover(workPath,coverDataUrl) {
    const preferences=await callTool('stats_preferences',{workPath});
    const args={fields:preferences.fields,workPath,coverDataUrl};
    if(preferences.pet)args.pet=preferences.pet;
    await callTool('save_stats_preferences',args);
    const next=coverDataUrl ? String(coverDataUrl) : '';
    shelfCovers.set(workPath,next);
    document.dispatchEvent(new CustomEvent('workbench:coverchange',{detail:{workPath,coverDataUrl:next}}));
    renderShelf();
  }
  function requestCoverChange(workPath) {
    coverTarget=workPath;
    const input=$('shelf-cover-file');
    input.value='';input.click();
  }
  async function removeWorkCover(workPath) {
    try {await saveWorkCover(workPath,null);shelfStatus('封面已移除。');}
    catch(error) {shelfStatus('封面未移除：'+error.message,'error');}
  }
  async function handleShelfCoverFile(file) {
    const workPath=coverTarget;coverTarget='';
    if(!file || !workPath)return;
    if(!['image/png','image/jpeg','image/webp'].includes(file.type) || file.size>2097152) {
      shelfStatus('请选择 2 MB 以内的 PNG、JPG 或 WebP 图片。','error');return;
    }
    shelfStatus('正在保存封面…');
    try {
      const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(new Error('图片读取失败'));reader.readAsDataURL(file);});
      const image=new Image();image.src=data;await image.decode();
      await saveWorkCover(workPath,data);
      shelfStatus('封面已更新。');
    } catch(error) {shelfStatus('封面未保存：'+error.message,'error');}
  }
  async function loadCovers() {
    if(!worksReady) return;
    const missing=workList.filter(work=>!shelfCovers.has(work.path));
    if(!missing.length) return;
    const generation=++shelfCoversGeneration;
    await Promise.all(missing.map(async work=>{
      try {
        const result=await callTool('stats_preferences',{workPath:work.path});
        shelfCovers.set(work.path,String(result?.coverDataUrl || ''));
      } catch {shelfCovers.set(work.path,'');}
    }));
    if(generation===shelfCoversGeneration && !$('shelf-page').hidden) renderShelf();
  }
  async function openShelfItem(item) {
    if(creating) return;
    if(item.kind==='draft') {
      creating=true;editor.readOnly=true;
      try {
        clearTimeout(saveTimeout);pauseClock();await flushDocument();await flushRecords();
        const info=await refreshFiles();
        sidebar.show();loadDocument(info?.draft || draftInfo);showEditor();
      } catch(error) {notify(error.message);}
      finally {creating=false;editor.readOnly=false;}
      return;
    }
    if(item.kind==='loose') {
      const loose=fileList.filter(file=>!workList.some(work=>file.path.startsWith(work.path+'/')));
      const target=pickLatestDocument(loose);
      if(!target) {notify('这篇文稿似乎已被移动，正在刷新书架。');await refreshFiles().catch(()=>{});return;}
      selectedFolder=target.path.includes('/') ? target.path.slice(0,target.path.lastIndexOf('/')) : '文稿';
      sidebar.show();
      await openDocument(target.path);
      return;
    }
    await openWork(item.path);
  }
  async function openWork(workPath) {
    const work=workList.find(item=>item.path===workPath);
    if(!work) {notify('没有找到这个作品，可能已被移动或删除。');await refreshFiles().catch(()=>{});return;}
    if(creating) return;
    selectedFolder=work.path+'/正文';
    sidebar.show();sidebar.reveal(work.path);
    // 刚从这个作品回到书架时，优先回到原来那篇；否则打开正文里最近更新的一篇。
    const current=path && path.startsWith(work.path+'/') ? fileList.find(file=>file.path===path) : null;
    const target=current || pickWorkDocument(fileList,work.path);
    if(target) {await openDocument(target.path);return;}
    notify(`《${work.name.replace(/^《(.*)》$/,'$1')}》还没有文稿，先建第一篇吧。`);
    openNameDialog('blank',selectedFolder);
  }
  function showShelf() {
    pauseClock();
    $('shelf-page').hidden=false;$('editor-page').hidden=true;$('history-page').hidden=true;
    document.body.classList.add('is-shelf');
    document.querySelector('.workspace-shell')?.classList.add('shelf-mode');
    $('shelf-home').setAttribute('aria-pressed','true');
    $('nav-editor').setAttribute('aria-pressed','false');
    $('nav-history').setAttribute('aria-pressed','false');
    renderShelf();
    onLoaded();
    $('shelf-title').focus({preventScroll:true});
    // 先落盘再刷新：书架上的文稿数、最近更新和草稿都来自磁盘。
    flushDocument().catch(()=>{}).then(()=>refreshFiles()).catch(()=>{});
    flushRecords().catch(()=>{});
    loadCovers().catch(()=>{});
  }
  function recordFor(day) {
    const key=`${day}|${path}`;
    if(!records.has(key)) records.set(key,{id:uid(),day,path,title:title.value.trim() || '未命名草稿',added:0,deleted:0,activeMs:0,idleMs:0,startedAt:new Date().toISOString(),updatedAt:new Date().toISOString()});
    return records.get(key);
  }
  function touch(record) {record.updatedAt=new Date().toISOString();statsVersion++;}
  function collectTime() {
    const active=clock.activeMs-seenActive,idle=clock.idleMs-seenIdle;
    seenActive=clock.activeMs;seenIdle=clock.idleMs;
    const end=Date.now(),start=end-active-idle;
    for(const [kind,from,to] of [['activeMs',start,start+active],['idleMs',start+active,end]]) {
      for(const part of splitDays(from,to)) {const record=recordFor(part.day);record[kind]+=part.milliseconds;touch(record);}
    }
    if(connected && Date.now()-lastFlush>=10000) {lastFlush=Date.now();flushRecords().catch(()=>{});}
  }
  function pauseClock() {clock.pause(performance.now());collectTime();}
  function onEdit() {
    const change=editCounts(lastBody,editor.value);lastBody=editor.value;
    if(change.added || change.deleted) {
      const record=recordFor(dayKey());record.added+=change.added;record.deleted+=change.deleted;record.title=title.value.trim() || record.title;added+=change.added;touch(record);
    }
    markDirty();
  }
  function markDirty() {
    dirty=true;editVersion++;
    $('document-status').textContent='尚未保存';
    clearTimeout(saveTimeout);
    saveTimeout=setTimeout(()=>flushDocument().catch(()=>{}),1200);
    if(finishStatus){finishStatus='';onLoaded();}
  }
  async function flushRecords() {
    if(!connected || !records.size || statsVersion===savedStatsVersion) return;
    if(statsSaving) {await statsSaving;return flushRecords();}
    const snapshot=[...records.values()].map(record=>({...record})),version=statsVersion;
    statsSaving=callTool('save_writing_records',{records:snapshot});
    try {await statsSaving;savedStatsVersion=version;}
    catch(error) {notify(`码字记录保存未完成：${error.message}`);throw error;}
    finally {statsSaving=null;}
  }
  async function flushDocument() {
    if(!connected) throw new Error('尚未连接本地文件服务。');
    if(documentSaving) {await documentSaving;return flushDocument();}
    if(!dirty) return;
    const version=editVersion,body=editor.value;
    $('document-status').textContent='正在保存…';
    const request=path ? callTool('save_document',{path,body,revision}) : callTool('save_draft',{title:title.value,body});
    documentSaving=request;
    try {
      const saved=await documentSaving;
      if(documentSaving===request) documentSaving=null;
      if(path) revision=saved.revision;
      if(editVersion===version) {dirty=false;$('document-status').textContent=path ? '已自动保存 · '+path : '草稿已自动保存，可另存为文稿';}
      else $('document-status').textContent='有新的修改，正在等待保存';
      await flushRecords().catch(()=>{});
    } catch(error) {$('document-status').textContent='保存未完成，内容仍在编辑区';notify(error.message+' 可用“另存为”保留当前内容。');throw error;}
    finally {if(documentSaving===request)documentSaving=null;}
  }
  async function finishWriting() {
    if(!connected || creating)return;
    const editorWasReadOnly=editor.readOnly,titleWasReadOnly=title.readOnly;
    creating=true;editor.readOnly=true;title.readOnly=true;
    clearTimeout(saveTimeout);pauseClock();finishStatus='saving';onLoaded();
    notify('正在保存当前文稿和今日码字记录…');
    try {
      const errors=[];
      try {await flushDocument();}catch(error){errors.push('文稿：'+error.message);}
      // Save the writing record even if the document has an external edit conflict.
      try {await flushRecords();}catch(error){errors.push('码字记录：'+error.message);}
      if(errors.length)throw new Error(errors.join('；'));
      finishStatus='saved';
      notify('本次码字已结束，当前文稿和今日码字记录已保存。');
    } catch(error) {
      finishStatus='error';
      notify('结束保存未完成：'+error.message+' 内容仍在编辑区，请重试；文件冲突可用“另存为”保留。');
    } finally {
      creating=false;editor.readOnly=editorWasReadOnly;title.readOnly=titleWasReadOnly;onLoaded();
    }
  }
  function renderFiles() {
    sidebar.renderFiles(fileList,path,directoryList);updateStatsWork();
  }
  async function refreshFiles() {
    const info=await callTool('workspace_info',{});acceptWorkspaceInfo(info);return info;
  }
  async function requestDelete(filePath) {
    if(creating)return;
    const generation=++deleteGeneration;pendingDelete=null;
    $('delete-filename').textContent=filePath;$('delete-error').textContent='';$('delete-confirm').disabled=true;
    $('delete-dialog').showModal();$('delete-cancel').focus();
    if(!trashReady){$('delete-error').textContent='删除功能已安装，请重启 Codex 后使用。';return;}
    try {
      const snapshot=filePath===path ? {revision} : await callTool('read_document',{path:filePath});
      if(generation!==deleteGeneration || !$('delete-dialog').open)return;
      pendingDelete={path:filePath,revision:snapshot.revision};$('delete-confirm').disabled=false;
    } catch(error){$('delete-error').textContent=error.message;}
  }
  async function confirmDelete() {
    if(creating || !pendingDelete)return;
    creating=true;editor.readOnly=true;$('delete-confirm').disabled=true;$('delete-cancel').disabled=true;
    const target=pendingDelete,active=target.path===path;
    try {
      if(active){clearTimeout(saveTimeout);pauseClock();await flushDocument();await flushRecords();}
      await callTool('delete_document',{path:target.path,revision:active?revision:target.revision});
      // Detach immediately so a delayed autosave cannot recreate the removed file.
      if(active)loadDocument({title:'未命名草稿',body:''});
      $('delete-dialog').close();pendingDelete=null;++deleteGeneration;
      const info=await refreshFiles();if(active){loadDocument(info.draft);showEditor();}
      notify('');
    } catch(error){if($('delete-dialog').open)$('delete-error').textContent=error.message;else notify(error.message);}
    finally {creating=false;editor.readOnly=false;$('delete-confirm').disabled=false;$('delete-cancel').disabled=false;}
  }
  async function renderTrash() {
    $('trash-status').textContent='正在读取…';$('trash-error').textContent='';$('trash-list').replaceChildren();
    if(!trashReady){$('trash-status').textContent='';$('trash-error').textContent='回收站功能已安装，请重启 Codex 后使用。';return;}
    try {
      const {entries}=await callTool('list_trash',{});
      $('trash-status').textContent=entries.length?`${entries.length} 个已删除文稿`:'回收站为空';
      for(const entry of entries) {
        const item=document.createElement('div');item.className='trash-item';
        const info=document.createElement('div'),name=document.createElement('p'),date=document.createElement('p');
        name.textContent=entry.path;date.className='subtle';date.textContent=new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',dateStyle:'short',timeStyle:'short'}).format(new Date(entry.deletedAt));info.append(name,date);
        const restore=document.createElement('button');restore.type='button';restore.textContent='恢复';restore.setAttribute('aria-label',`恢复 ${entry.path}`);
        restore.addEventListener('click',async()=>{
          if(trashBusy)return;
          trashBusy=true;restore.disabled=true;$('trash-error').textContent='';
          try {await callTool('restore_document',{id:entry.id});await refreshFiles();await renderTrash();}
          catch(error){$('trash-error').textContent=error.message;}
          finally {trashBusy=false;restore.disabled=false;}
        });
        const remove=document.createElement('button');remove.type='button';remove.className='trash-remove';remove.textContent='彻底删除';remove.setAttribute('aria-label',`彻底删除 ${entry.path}`);
        remove.addEventListener('click',()=>{
          if(trashBusy)return;
          pendingTrash=entry;$('trash-delete-filename').textContent=entry.path;$('trash-delete-error').textContent='';
          $('trash-delete-dialog').showModal();$('trash-delete-cancel').focus();
        });
        item.append(info,restore,remove);$('trash-list').append(item);
      }
    } catch(error){$('trash-status').textContent='';$('trash-error').textContent=error.message;}
  }
  function loadDocument(document) {
    path=document.path || '';revision=document.revision || '';editor.value=document.body;title.value=document.title;title.readOnly=false;titleSnapshot=path ? document.title : '';lastBody=editor.value;dirty=false;editVersion++;finishStatus='';
    $('document-status').textContent=path ? '已打开 · '+path : '草稿已自动恢复';
    if(path)selectedFolder=path.includes('/')?path.slice(0,path.lastIndexOf('/')):'文稿';
    renderFiles();sidebar.renderOutline();onLoaded();
    documentChanged();
  }
  function documentChanged() {document.dispatchEvent(new CustomEvent('workbench:documentchange',{detail:{path}}));}
  async function acceptWritingSuggestion(item) {
    if(creating || !connected)throw new Error('正在处理文稿，请稍后重试。');
    if(path!==item.path)throw new Error('请回到建议所属的文稿后采纳。');
    const wasReadOnly=editor.readOnly,wasTitleReadOnly=title.readOnly;
    creating=true;editor.readOnly=true;title.readOnly=true;clearTimeout(saveTimeout);
    try {
      await flushDocument();
      const result=await callTool('update_writing_request',{id:item.id,version:item.version,action:'accept',body:editor.value,...(path?{revision}:{})});
      editor.value=result.document.body;
      onEdit(); // Accepted text counts once; merely viewing a proposal never counts.
      revision=result.document.revision || '';dirty=false;clearTimeout(saveTimeout);
      $('document-status').textContent='已采纳并保存'+(path?' · '+path:'到草稿');
      sidebar.renderOutline();onLoaded();documentChanged();
      await flushRecords().catch(()=>{});
      return result;
    } finally {creating=false;editor.readOnly=wasReadOnly;title.readOnly=wasTitleReadOnly;}
  }
  async function renameFile(filePath,rawName) {
    if(creating) throw new Error('正在保存当前文稿，请稍后再试。');
    const name=String(rawName ?? '').trim();
    if(!name) throw new Error('名称不能为空。');
    const active=filePath===path,wasReadOnly=editor.readOnly,wasTitleReadOnly=title.readOnly;
    creating=true;editor.readOnly=true;if(active)title.readOnly=true;
    try {
      if(active) {
        clearTimeout(saveTimeout);
        if(dirty || documentSaving) await flushDocument();
      }
      const result=await callTool('rename_document',{path:filePath,name,...(active && revision ? {revision} : {})});
      await refreshFiles();
      if(active) {
        path=result.document.path;revision=result.document.revision;
        title.value=result.document.title;titleSnapshot=result.document.title;
        lastBody=editor.value;dirty=false;editVersion++;finishStatus='';
        selectedFolder=path.includes('/')?path.slice(0,path.lastIndexOf('/')):'文稿';
        $('document-status').textContent='已重命名 · '+path;
        sidebar.renderFiles(fileList,path,directoryList);sidebar.renderOutline();updateStatsWork();onLoaded();
        documentChanged();
      }
      notify(`已重命名为“${result.document.title}”。`);
      return result.document;
    } catch(error) {
      notify('重命名未完成：'+error.message);
      throw error;
    } finally {creating=false;editor.readOnly=wasReadOnly;title.readOnly=wasTitleReadOnly;}
  }
  async function renameFolder(folderPath,rawName) {
    if(creating) throw new Error('正在保存当前文稿，请稍后再试。');
    const name=String(rawName ?? '').trim();
    if(!name) throw new Error('名称不能为空。');
    const base=folderPath.split('/').pop();
    const isWorkRoot=folderPath.split('/').length===2 && ['设定','正文','草稿'].includes(base);
    if(isWorkRoot) {
      const warning=`「${base}」是作品的结构文件夹，改名后工作台可能无法再识别这个作品。仍要改名为「${name}」吗？`;
      let confirmed=true;
      try {confirmed=typeof confirm!=='function' || confirm(warning);} catch {confirmed=true;}
      if(!confirmed) {const error=new Error('已取消重命名。');error.cancelled=true;throw error;}
    }
    const inside=Boolean(path) && (path===folderPath || path.startsWith(folderPath+'/'));
    const wasReadOnly=editor.readOnly;
    creating=true;editor.readOnly=true;
    try {
      if(inside) {
        clearTimeout(saveTimeout);
        if(dirty || documentSaving) await flushDocument();
      }
      const result=await callTool('rename_folder',{path:folderPath,name});
      // 作品封面按目录名保存：顶层作品改名后清掉旧键，重新按新路径读取。
      if(!folderPath.includes('/')) shelfCovers.clear();
      await refreshFiles();
      const nextPath=result.folder.path;
      if(inside) {
        path=nextPath+path.slice(folderPath.length);
        $('document-status').textContent='已重命名 · '+path;
      }
      if(selectedFolder===folderPath || selectedFolder.startsWith(folderPath+'/')) selectedFolder=nextPath+selectedFolder.slice(folderPath.length);
      if(inside) {sidebar.renderFiles(fileList,path,directoryList);sidebar.renderOutline();onLoaded();documentChanged();}
      updateStatsWork();
      notify(`文件夹已重命名为“${result.folder.name}”。`);
      return result.folder;
    } catch(error) {
      notify(error.cancelled ? error.message : '重命名未完成：'+error.message);
      throw error;
    } finally {creating=false;editor.readOnly=wasReadOnly;}
  }
  function commitTitleRename() {
    if(renamingTitle || !path) return;
    const next=title.value.trim();
    if(next===titleSnapshot) return;
    if(!next) {title.value=titleSnapshot;notify('文稿名称不能为空。');return;}
    renamingTitle=true;
    titleCommit=renameFile(path,next).catch(()=>{title.value=titleSnapshot;}).finally(()=>{renamingTitle=false;titleCommit=null;});
  }
  async function openDocument(filePath) {
    if(titleCommit) await titleCommit.catch(()=>{});
    if(creating) return;
    creating=true;editor.readOnly=true;
    try {
      clearTimeout(saveTimeout);pauseClock();await flushDocument();await flushRecords();
      const document=await callTool('read_document',{path:filePath});loadDocument(document);showEditor();
    } catch(error) {notify(error.message);}
    finally {creating=false;editor.readOnly=false;}
  }
  function showEditor() {
    $('shelf-page').hidden=true;$('editor-page').hidden=false;$('history-page').hidden=true;
    document.body.classList.remove('is-shelf');
    document.querySelector('.workspace-shell')?.classList.remove('shelf-mode');
    $('shelf-home').setAttribute('aria-pressed','false');
    $('nav-editor').setAttribute('aria-pressed','true');$('nav-history').setAttribute('aria-pressed','false');
    sidebar.scrollToCurrent();
  }
  function showHistory() {
    $('shelf-page').hidden=true;$('editor-page').hidden=true;$('history-page').hidden=false;
    document.body.classList.remove('is-shelf');
    document.querySelector('.workspace-shell')?.classList.remove('shelf-mode');
    $('shelf-home').setAttribute('aria-pressed','false');
    $('nav-editor').setAttribute('aria-pressed','false');$('nav-history').setAttribute('aria-pressed','true');
    loadHistory();
  }
  function openNameDialog(mode,folder) {
    if(creating)return;
    if(!directoryList.length){notify('请先添加作品，再保存文稿。');openWorkDialog();return;}
    newMode=mode;
    newFolder=folder || selectedFolder;
    if(workList.some(work=>work.path===newFolder))newFolder+='/正文';
    const options=$('document-folder');options.replaceChildren();
    for(const directory of directoryList) {
      const option=document.createElement('option');option.value=directory.path;option.textContent=directory.path;options.append(option);
    }
    if(![...options.options].some(option=>option.value===newFolder)) {
      const option=document.createElement('option');option.value=newFolder;option.textContent=newFolder;options.append(option);
    }
    options.value=newFolder;
    $('document-dialog-heading').textContent=mode==='blank' ? '新建文稿' : '保存为文稿';
    $('document-name').value=mode==='current' && title.value!=='未命名草稿' ? title.value+'.md' : '';
    $('document-error').textContent='';$('document-dialog').showModal();$('document-name').focus();
  }
  async function createDocument() {
    if(creating) return;
    let name=$('document-name').value.trim();
    if(!name || /[\\/]/.test(name)) {$('document-error').textContent='请填写文件名，不要包含路径。';return;}
    if(!/\.(md|txt)$/i.test(name)) name+='.md';
    creating=true;$('document-create').disabled=true;editor.readOnly=true;
    try {
      clearTimeout(saveTimeout);pauseClock();if(newMode==='blank')await flushDocument();await flushRecords();
      const document=await callTool('save_document',{path:$('document-folder').value+'/'+name,body:newMode==='blank' ? '' : editor.value});
      await refreshFiles();loadDocument(document);$('document-dialog').close();showEditor();
    } catch(error) {$('document-error').textContent=error.message;}
    finally {creating=false;$('document-create').disabled=false;editor.readOnly=false;}
  }
  function resetWorkDialogTexts(mode) {
    $('work-heading').textContent=mode==='rename'?'重命名作品':'添加作品';
    $('work-hint').textContent=mode==='rename'
      ? '只改作品文件夹名，里面的“设定”“正文”“草稿”和文稿都不动。'
      : '以作品名创建文件夹，并自动建立“设定”、“正文”和“草稿”三个子文件夹。大纲、人物设定等放在“设定”中。';
    $('work-create').textContent=mode==='rename'?'保存名称':'添加作品';
  }
  function openWorkDialog() {
    if(creating)return;
    workDialogMode='add';workRenameTarget='';
    resetWorkDialogTexts('add');
    $('work-name').value='';$('work-error').textContent=worksReady?'':'添加作品功能已安装，请重启 Codex 后使用。';
    $('work-create').disabled=!worksReady;$('work-dialog').showModal();$('work-name').focus();
  }
  function openWorkRenameDialog(workPath) {
    if(creating)return;
    const work=workList.find(item=>item.path===workPath);
    if(!work){notify('没有找到这个作品，可能已被移动或删除。');return;}
    workDialogMode='rename';workRenameTarget=work.path;
    resetWorkDialogTexts('rename');
    $('work-name').value=work.name;$('work-error').textContent='';
    $('work-create').disabled=false;$('work-dialog').showModal();
    $('work-name').focus();$('work-name').select();
  }
  async function createWork() {
    if(creating)return;
    const name=$('work-name').value.trim();
    if(!name || /[\\/]/.test(name)){$('work-error').textContent='请填写作品名，不要包含路径。';return;}
    if(workDialogMode==='rename') {
      $('work-create').disabled=true;$('work-cancel').disabled=true;$('work-error').textContent='';
      try {
        await renameFolder(workRenameTarget,name);
        $('work-dialog').close();
        shelfStatus(`作品已改名为《${name.replace(/^《(.*)》$/,'$1')}》。`);
      } catch(error){$('work-error').textContent=error.message;}
      finally {$('work-create').disabled=false;$('work-cancel').disabled=false;}
      return;
    }
    if(!worksReady)return;
    creating=true;$('work-create').disabled=true;$('work-cancel').disabled=true;$('work-error').textContent='';
    try {
      const result=await callTool('create_work',{name});
      const onShelf=!$('shelf-page').hidden;
      await refreshFiles();selectedFolder=result.work.path+'/正文';updateStatsWork();$('work-dialog').close();
      notify(onShelf
        ? `已添加作品《${result.work.name.replace(/^《(.*)》$/,'$1')}》，点击书架封面开始写作。`
        : `已添加作品《${result.work.name.replace(/^《(.*)》$/,'$1')}》，可在“设定”、“正文”或“草稿”旁点击 ＋ 新建文稿。`);
    } catch(error){$('work-error').textContent=error.message;}
    finally {creating=false;$('work-create').disabled=false;$('work-cancel').disabled=false;}
  }
  function applyAppearance() {
    const color=settings.background;
    const rgb=[1,3,5].map(index=>parseInt(color.slice(index,index+2),16));
    const linear=rgb.map(value=>{value/=255;return value<=.04045 ? value/12.92 : ((value+.055)/1.055)**2.4;});
    const light=.2126*linear[0]+.7152*linear[1]+.0722*linear[2]>.179;
    const root=document.documentElement;
    const blend=(target,weight)=>'#'+rgb.map((value,i)=>Math.round(value*(1-weight)+target[i]*weight).toString(16).padStart(2,'0')).join('');
    root.style.colorScheme=light ? 'light' : 'dark';
    for(const [key,value] of Object.entries({paper:color,desk:light?'#edf2f8':'#131d2b',ink:light?'#101511':'#ffffff',muted:light?'#28312a':'#e3eee7',line:blend(light?[30,50,35]:[220,240,225],.2),surface:blend(light?[25,90,55]:[170,220,190],.08),accent:light?'#205c41':'#b0e4c5','accent-ink':light?'#ffffff':'#0f291a'})) root.style.setProperty('--'+key,value);
    $('background-color').value=color;$('background-hex').value=color;
    for(const button of $('background-presets').children) button.setAttribute('aria-pressed',String(button.dataset.color===color));
  }
  async function chooseBackground(color) {
    if(!/^#[0-9a-f]{6}$/i.test(color)) {$('appearance-status').textContent='请输入 # 开头的六位颜色值。';return;}
    const previous={...settings};settings={background:color.toLowerCase()};applyAppearance();
    $('appearance-status').textContent='正在保存背景…';
    try {await callTool('save_settings',settings);$('appearance-status').textContent='背景已保存。';}
    catch(error) {settings=previous;applyAppearance();$('appearance-status').textContent='背景保存未完成：'+error.message;}
  }
  for(const [label,color] of presets) {
    const button=document.createElement('button');button.type='button';button.dataset.color=color;button.textContent=label;button.style.background=color;button.style.color=color==='#242825'?'#eef6f0':'#203026';button.setAttribute('aria-pressed','false');button.addEventListener('click',()=>chooseBackground(color));$('background-presets').append(button);
  }
  function selectDay(day) {
    selectedDay=day;
    for(const button of $('calendar-days').querySelectorAll('button')) button.setAttribute('aria-pressed',String(button.dataset.day===day));
    $('day-heading').textContent=day+' · 码字详情';
    const info=historyDays[day] || {added:0,deleted:0,activeMs:0,idleMs:0,records:[]};
    $('day-summary').replaceChildren();
    for(const [label,value] of [['新增',number(info.added)+' 字'],['净增',number(info.added-info.deleted)+' 字'],['删除',number(info.deleted)+' 字'],['码字时间',formatTime(info.activeMs)],['空闲时间',formatTime(info.idleMs)]]) {
      const item=document.createElement('div');const name=document.createElement('span');name.textContent=label;const strong=document.createElement('strong');strong.textContent=value;item.append(name,strong);$('day-summary').append(item);
    }
    const files=$('day-files');files.replaceChildren();
    if(!info.records.length) {const p=document.createElement('p');p.className='subtle';p.textContent='这一天暂无码字记录。';files.append(p);}
    for(const record of info.records) {
      const item=document.createElement('div');item.className='history-file';const name=document.createElement('strong');name.textContent=record.path || record.title+'（草稿）';const detail=document.createElement('p');detail.textContent=`新增 ${number(record.added)} 字 · 删除 ${number(record.deleted)} 字 · 码字 ${formatTime(record.activeMs)}`;item.append(name,detail);files.append(item);
    }
  }
  function renderCalendar() {
    const [year,month]=historyMonth.split('-').map(Number),days=new Date(year,month,0).getDate(),offset=(new Date(year,month-1,1).getDay()+6)%7;
    $('history-month').textContent=`${year} 年 ${month} 月`;
    const grid=$('calendar-days');grid.replaceChildren();
    for(let i=0;i<offset;i++) {const blank=document.createElement('span');blank.setAttribute('aria-hidden','true');grid.append(blank);}
    for(let date=1;date<=days;date++) {
      const day=`${historyMonth}-${String(date).padStart(2,'0')}`,count=historyDays[day]?.added || 0;
      const button=document.createElement('button');button.type='button';button.dataset.day=day;button.className='calendar-day';if(day===dayKey())button.classList.add('today');if(count)button.classList.add('has-writing');button.setAttribute('aria-label',`${day}，新增 ${count} 字`);button.setAttribute('aria-pressed',String(day===selectedDay));
      const label=document.createElement('span');label.textContent=String(date);const words=document.createElement('strong');words.textContent=count ? number(count)+' 字' : '—';button.append(label,words);button.addEventListener('click',()=>selectDay(day));grid.append(button);
    }
    selectDay(selectedDay.startsWith(historyMonth) ? selectedDay : historyMonth+'-01');
  }
  async function loadHistory() {
    const generation=++historyGeneration;
    $('history-status').textContent='正在读取码字记录…';
    try {
      await flushRecords();const result=await callTool('writing_history',{month:historyMonth});if(generation!==historyGeneration) return;
      historyDays=aggregateDays(result.records);renderCalendar();
      $('history-status').textContent='本月新增 '+number(result.records.reduce((sum,record)=>sum+record.added,0))+' 字';
    } catch(error) {if(generation===historyGeneration) $('history-status').textContent='读取未完成：'+error.message;}
  }
  $('refresh-files').addEventListener('click',()=>refreshFiles().catch(error=>notify(error.message)));
  $('delete-confirm').addEventListener('click',confirmDelete);
  $('delete-cancel').addEventListener('click',()=>{if(!creating){++deleteGeneration;pendingDelete=null;$('delete-dialog').close();}});
  $('delete-dialog').addEventListener('cancel',event=>{if(creating)event.preventDefault();else {++deleteGeneration;pendingDelete=null;}});
  function closeTrashDelete(){if(!trashBusy){pendingTrash=null;$('trash-delete-dialog').close();}}
  $('trash-delete-cancel').addEventListener('click',closeTrashDelete);
  $('trash-delete-dialog').addEventListener('cancel',event=>{event.preventDefault();closeTrashDelete();});
  $('trash-delete-confirm').addEventListener('click',async()=>{
    if(trashBusy || !pendingTrash)return;
    const entry=pendingTrash;trashBusy=true;
    $('trash-delete-confirm').disabled=true;$('trash-delete-cancel').disabled=true;$('trash-delete-error').textContent='';
    try {
      await callTool('delete_trash',{id:entry.id});
      pendingTrash=null;$('trash-delete-dialog').close();await renderTrash();
    } catch(error){$('trash-delete-error').textContent=error.message;}
    finally {trashBusy=false;$('trash-delete-confirm').disabled=false;$('trash-delete-cancel').disabled=false;}
  });
  $('trash-open').addEventListener('click',()=>{$('trash-dialog').showModal();renderTrash();});
  $('trash-close').addEventListener('click',()=>{if(!trashBusy)$('trash-dialog').close();});
  $('trash-dialog').addEventListener('cancel',event=>{if(trashBusy)event.preventDefault();});
  $('new-work').addEventListener('click',openWorkDialog);
  $('work-create').addEventListener('click',createWork);
  $('work-cancel').addEventListener('click',()=>{if(!creating)$('work-dialog').close();});
  $('work-dialog').addEventListener('cancel',event=>{if(creating)event.preventDefault();});
  $('work-name').addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();createWork();}});
  async function afterTitleCommit() {if(titleCommit) await titleCommit.catch(()=>{});}
  $('document-save').addEventListener('click',async()=>{
    await afterTitleCommit();
    if(creating) return;
    if(path){await flushDocument().catch(()=>{});await flushRecords().catch(()=>{});}
    else openNameDialog('current');
  });
  $('document-saveas').addEventListener('click',async()=>{await afterTitleCommit();openNameDialog('current');});
  $('document-create').addEventListener('click',createDocument);
  $('document-cancel').addEventListener('click',()=>{if(!creating)$('document-dialog').close();});
  $('document-dialog').addEventListener('cancel',event=>{if(creating)event.preventDefault();});
  $('document-name').addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();createDocument();}});
  title.addEventListener('input',()=>{if(!path)markDirty();});
  title.addEventListener('keydown',event=>{
    if(event.key==='Enter'){event.preventDefault();commitTitleRename();}
    else if(event.key==='Escape' && path){event.preventDefault();title.value=titleSnapshot;title.blur();}
  });
  title.addEventListener('blur',()=>commitTitleRename());
  $('shelf-home').addEventListener('click',showShelf);
  $('nav-editor').addEventListener('click',showEditor);
  $('history-close').addEventListener('click',()=>{showEditor();editor.focus({preventScroll:true});});
  $('nav-history').addEventListener('click',()=>{pauseClock();onLoaded();showHistory();});
  const shelfMenu=$('shelf-menu');
  shelfMenu.addEventListener('click',event=>{
    const button=event.target.closest('button[data-action]');
    if(!button || !shelfMenuTarget)return;
    const item=shelfMenuTarget,action=button.dataset.action;
    closeShelfMenu();
    if(action==='open')void openShelfItem(item);
    else if(action==='rename')openWorkRenameDialog(item.path);
    else if(action==='cover')requestCoverChange(item.path);
    else if(action==='remove-cover')void removeWorkCover(item.path);
  });
  shelfMenu.addEventListener('keydown',event=>{
    if(!['ArrowDown','ArrowUp','Home','End'].includes(event.key))return;
    event.preventDefault();
    const items=[...shelfMenu.querySelectorAll('button[data-action]:not([hidden])')];
    if(!items.length)return;
    const index=items.indexOf(document.activeElement);
    const next=event.key==='ArrowDown'?(index+1)%items.length:event.key==='ArrowUp'?(index-1+items.length)%items.length:event.key==='Home'?0:items.length-1;
    items[next]?.focus();
  });
  document.addEventListener('pointerdown',event=>{if(!shelfMenu.hidden && !shelfMenu.contains(event.target))closeShelfMenu();},true);
  document.addEventListener('scroll',()=>{if(!shelfMenu.hidden)closeShelfMenu();},true);
  window.addEventListener('resize',()=>{if(!shelfMenu.hidden)closeShelfMenu();});
  document.addEventListener('keydown',event=>{if(event.key==='Escape' && !shelfMenu.hidden)closeShelfMenu(true);});
  $('shelf-cover-file').addEventListener('change',event=>{
    const file=event.target.files?.[0];
    event.target.value='';
    void handleShelfCoverFile(file);
  });
  document.addEventListener('workbench:coverchange',event=>{
    const workPath=event.detail?.workPath;
    if(!workPath) return;
    shelfCovers.set(workPath,String(event.detail.coverDataUrl || ''));
    if(!$('shelf-page').hidden) renderShelf();
  });
  for(const [id,direction] of [['month-previous',-1],['month-next',1]]) $(id).addEventListener('click',()=>{const [year,month]=historyMonth.split('-').map(Number);historyMonth=new Date(Date.UTC(year,month-1+direction,1)).toISOString().slice(0,7);loadHistory();});
  $('history-today').addEventListener('click',()=>{historyMonth=dayKey().slice(0,7);selectedDay=dayKey();loadHistory();});
  document.addEventListener('keydown',event=>{
    if(event.key==='Escape' && !$('history-page').hidden && !document.querySelector('dialog[open]')) {
      event.preventDefault();showEditor();editor.focus({preventScroll:true});
    }
  });
  $('appearance-open').addEventListener('click',()=>$('appearance-dialog').showModal());
  $('appearance-close').addEventListener('click',()=>$('appearance-dialog').close());
  $('background-color').addEventListener('change',event=>chooseBackground(event.target.value));
  $('background-apply').addEventListener('click',()=>chooseBackground($('background-hex').value.trim()));
  document.addEventListener('keydown',async event=>{if((event.ctrlKey || event.metaKey) && event.key.toLowerCase()==='s'){event.preventDefault();await afterTitleCommit();if(creating)return;if(path)flushDocument().then(()=>flushRecords()).catch(()=>{});else if(!$('document-dialog').open)openNameDialog('current');}});
  document.addEventListener('visibilitychange',()=>{if(document.hidden){pauseClock();flushDocument().catch(()=>{});flushRecords().catch(()=>{});}});
  return {
    onEdit,collectTime,flushRecords,flushDocument,acceptWritingSuggestion,finishWriting,applyAppearance,get added(){return added;},get path(){return path;},get finishStatus(){return finishStatus;},get canFinish(){return connected && !creating;},
    async connected() {
      try {
        const info=await callTool('workspace_info',{});connected=true;acceptWorkspaceInfo(info);settings=info.settings;applyAppearance();
        // Never replace text typed while the initial disk request was in flight.
        if(!dirty && !editor.value) loadDocument(info.draft);else {renderFiles();if(dirty)await flushDocument();}
      } catch(error) {$('files-status').textContent='本地文件连接未完成';$('document-status').textContent='尚未保存';$('shelf-subtitle').textContent='书架读取未完成，请检查本地文件服务。';notify(error.message);}
    },
  };
}


