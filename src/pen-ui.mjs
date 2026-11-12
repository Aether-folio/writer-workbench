import {attachParagraphEditor} from './paragraph-editor.mjs';
import {rebaseWritingRange,penMessage} from './writing-anchor.mjs';
import {iconButton,decorateButton} from './icons.mjs';
import {attachProposalCaret} from './pen-caret.mjs';

const $=id=>document.getElementById(id);
const uuid=()=>{if(globalThis.crypto?.randomUUID)return crypto.randomUUID();const bytes=new Uint8Array(16);if(globalThis.crypto?.getRandomValues)crypto.getRandomValues(bytes);else for(let i=0;i<16;i++)bytes[i]=Math.floor(Math.random()*256);bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;const hex=[...bytes].map(v=>v.toString(16).padStart(2,'0')).join('');return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;};
const target=item=>item.mode==='replace'?{start:item.offset,end:item.endOffset??item.offset}:{start:item.endOffset??item.offset,end:item.endOffset??item.offset};
export function attachPen({editor,title,workspace,callTool,sendMessage,canMessage,notify,showComparison}) {
  const rows=new Map(),dialog=$('pen-dialog'),input=$('pen-instruction'),toolbar=$('pen-toolbar'),reviewActions=$('pen-review-actions');
  const toolbarHome=toolbar.parentElement;
  const disposeCaret=attachProposalCaret(editor);
  let toolbarHideTimer,versionPicker=false,batchBusy=false,renderedToolbarRow,renderedToolbarState;
  let supported=false,fetching=false,refreshPending=false,epoch=0,current=null,relocating=null,submitting=false,composing=false,sending=false,drafts=[],completed=[],archivable=[],markers=[],projected=false,projectionDirty=false,activeRow=null,historyOpen=false;
  const allRows=()=>[...rows.values()].filter(r=>r.item.path===workspace.path);
  const readyRows=()=>allRows().filter(row=>row.item.status==='ready');
  const reviewButtons=[
    iconButton('全部采纳','check',()=>runBatch('accept')),
    iconButton('全部重新生成','again',()=>runBatch('regenerate')),
    iconButton('全部取消','close',()=>runBatch('discard')),
  ];
  reviewActions.append(...reviewButtons);
  function updateReviewActions(){
    const ready=readyRows();
    reviewActions.hidden=!ready.length;
    const busy=batchBusy||ready.some(row=>row.busy);
    const hasConflict=ready.some(row=>row.conflict);
    reviewButtons[0].disabled=busy||hasConflict;
    reviewButtons[1].disabled=busy||hasConflict||sending||!canMessage();
    reviewButtons[2].disabled=busy;
  }
  function available(){ $('pen-open').disabled=editor.readOnly;$('menu-pen').disabled=editor.readOnly;$('pen-send').disabled=submitting||!canMessage();$('pen-save').disabled=submitting;updateReviewActions(); }
  function setError(error){$('pen-error').textContent=error instanceof Error?error.message:String(error);}
  async function mutate(row,patch){const result=await callTool('update_writing_request',{id:row.item.id,version:row.item.version,...patch});if(result.request)row.item=result.request;epoch++;return result;}
  async function run(row,action){
    if(row.busy||batchBusy) return;
    row.busy=true;
    updateReviewActions();
    try{
      await action();
      await sync(true);
    }catch(error){
      row.notice=error.message;
      notify(error.message);
    }finally{
      row.busy=false;
      if(row.element.isConnected) row.body.readOnly=row.item.status!=='ready'||row.conflict;
      updateToolbar();
      updateReviewActions();
    }
  }
  function sourceRange(item,source=editor.value){const value=item.status==='draft'?{start:item.offset,end:item.endOffset??item.offset}:target(item);return rebaseWritingRange(item.baseBody,source,value.start,value.end);}
  async function acceptRow(row) {
    await saveEdit(row);
    await workspace.acceptWritingSuggestion(row.item);
    toolbar.hidden=true;
    removeRow(row);
    reproject();
  }
  async function discardRow(row){
    if(row.body.value.trim()) await saveEdit(row);
    await mutate(row,{action:'discard'});
    removeRow(row);
    reproject();
  }
  async function runBatch(action,group){
    const ready=group ?? readyRows().sort((a,b)=>a.item.offset-b.item.offset);
    if(batchBusy||!ready.length||ready.some(row=>row.item.status!=='ready'||row.busy||action!=='discard'&&row.conflict))return;
    if(action==='regenerate'&&(sending||!canMessage()))return;
    const path=workspace.path, pending=[];
    let done=0,failure;
    batchBusy=true;toolbar.hidden=true;updateReviewActions();
    for(const row of ready){row.busy=true;row.body.readOnly=true;}
    try{
      if(action==='regenerate')await workspace.flushDocument();
      for(const row of ready){
        if(path!==workspace.path)throw new Error('文稿已切换。');
        if(action==='accept')await acceptRow(row);
        else if(action==='discard')await discardRow(row);
        else {
          if(!sourceRange(row.item))throw new Error('目标原文已改变，请重新定位。');
          await saveEdit(row);
          pending.push((await mutate(row,{action:'regenerate',instruction:row.item.instruction})).request);
        }
        done++;
      }
    }catch(error){failure=error;}
    finally{
      for(const row of ready){row.busy=false;row.body.readOnly=row.item.status!=='ready'||row.conflict;}
      reproject();await sync(true);
      batchBusy=false;updateReviewActions();
    }
    if(pending.length){try{await deliver(pending);}catch(error){notify(error.message);}}
    if(failure)notify(`已处理${done}处，剩余改稿未处理：${failure.message}`);
    else if(action!=='regenerate')notify(`已${action==='accept'?'采纳':'取消'}${group?'这组':'全部'}${done}处改稿。`);
  }
  function toolbarRows(){
    return versionPicker ? [activeRow] : (activeRow?.reviewGroup ?? [activeRow]);
  }
  function showToolbar(row,showVersions=false){
    if(batchBusy)return;
    clearTimeout(toolbarHideTimer);
    if(!toolbar.hidden&&versionPicker===showVersions&&toolbarRows().includes(row))return;
    activeRow=row;
    versionPicker=showVersions;
    toolbar.hidden=false;
    updateToolbar();
    positionToolbar();
  }
  function scheduleToolbarHide(){
    const row=activeRow;
    clearTimeout(toolbarHideTimer);
    toolbarHideTimer=setTimeout(()=>{
      if(activeRow===row&&!toolbarRows().some(item=>item?.body.matches(':hover'))&&!toolbar.matches(':hover')&&!toolbar.contains(document.activeElement)){
        toolbar.hidden=true;
      }
    },toolbar.classList.contains('pen-toolbar-inline')?500:250);
  }
  function positionToolbar(){
    if(toolbar.hidden||toolbar.classList.contains('pen-toolbar-inline')||!activeRow?.element.isConnected)return;
    const box=toolbar.getBoundingClientRect();
    const view=editor.getBoundingClientRect();
    const minX=Math.max(4,view.left+4),maxX=Math.min(innerWidth-4,view.right-4);
    const minY=Math.max(4,view.top+4),maxY=Math.min(innerHeight-4,view.bottom-4);
    const rects=toolbarRows().flatMap(row=>[...(row.body.hidden?row.marker:row.body).getClientRects()]);
    const rect=rects.find(rect=>rect.width>0&&rect.bottom>minY&&rect.top<maxY);
    if(!rect||maxY-minY<box.height){toolbar.hidden=true;return;}
    const gap=5;
    let left,top;
    if(rect.right+gap+box.width<=maxX){
      left=rect.right+gap;top=(rect.top+rect.bottom-box.height)/2;
    }else if(rect.left-gap-box.width>=minX){
      left=rect.left-gap-box.width;top=(rect.top+rect.bottom-box.height)/2;
    }else{
      left=rect.right-box.width;
      top=rect.bottom+gap+box.height<=maxY?rect.bottom+gap:rect.top-gap-box.height;
    }
    toolbar.style.left=Math.max(minX,Math.min(left,maxX-box.width))+'px';
    toolbar.style.top=Math.max(minY,Math.min(top,maxY-box.height))+'px';
  }
  function updateToolbar(){
    if(!activeRow)return;const row=activeRow;
    const group=toolbarRows();
    const inline=row.item.status==='ready'&&!row.conflict&&!versionPicker&&row.inlineHost;
    const host=inline?row.inlineHost:toolbarHome;
    const resendDisabled=row.item.status==='waiting'&&['sending','sent'].includes(row.item.delivery?.state)&&
      Date.now()-Date.parse(row.item.delivery?.startedAt||row.item.updatedAt)<120000;
    const state=JSON.stringify([versionPicker,batchBusy,sending,canMessage(),resendDisabled,
      group.map(item=>[item.item.id,item.item.version,item.item.status,item.busy,item.conflict,item.notice])]);
    // Keep the same buttons through unchanged polls so focus and in-flight clicks survive.
    if(renderedToolbarRow===row&&renderedToolbarState===state&&toolbar.parentElement===host)return;
    renderedToolbarRow=row;renderedToolbarState=state;
    toolbar.replaceChildren();
    toolbar.classList.toggle('pen-toolbar-inline',inline);
    if(toolbar.parentElement!==host)host.append(toolbar);
    if(group.length>1){
      for(const [label,icon,command] of [
        ['采纳这组改稿','check','accept'],
        ['重新生成这组改稿','again','regenerate'],
        ['取消这组改稿','close','discard'],
      ]){
        const button=iconButton(label,icon,()=>runBatch(command,group));
        button.disabled=batchBusy||group.some(item=>item.busy)||
          (command==='regenerate'&&(sending||!canMessage()));
        toolbar.append(button);
      }
      return;
    }
    const action=(label,name,handler,disabled=false)=>{const button=iconButton(label,name,()=>run(row,handler));button.disabled=batchBusy||row.busy||disabled;toolbar.append(button);return button;};
    if(row.item.status==='ready') {
      action('查看对照','compare',()=>showComparison({
        before:row.item.mode==='replace'?row.item.baseBody.slice(row.item.offset,row.item.endOffset):'',
        after:row.body.value,returnFocus:row.body,
      }));
      action('采纳此处','check',()=>acceptRow(row),row.conflict);
      action('重新生成','again',()=>open(row.item,true));
      action('取消','close',()=>discardRow(row));
      const versions=row.item.history||[];
      if(versionPicker&&versions.length>1){const select=document.createElement('select');select.className='pen-version-select';select.setAttribute('aria-label','查看或恢复递笔版本');const option=document.createElement('option');option.value='';option.textContent='历史版本';select.append(option);for(const v of [...versions].reverse()){const o=document.createElement('option');o.value=v.id;o.textContent=`第${v.generation}轮 · ${v.label} · ${new Date(v.createdAt).toLocaleTimeString('zh-CN')}`;select.append(o);}select.addEventListener('change',()=>{if(select.value)void viewVersion(row,select.value);});toolbar.append(select);}
    } else if(row.item.status==='waiting') {
      action('重新发送','send',()=>deliver([row.item],true),resendDisabled);
      action('取消这次递笔','close',async()=>{await mutate(row,{action:'discard'});removeRow(row);reproject();});
    }
    if(row.conflict)action('移到当前选区或光标','pen',async()=>{await mutate(row,{action:'relocate',body:editor.value,offset:editor.selectionStart,endOffset:editor.selectionEnd});projectionDirty=true;reproject();});
    if(row.conflict||row.item.status!=='ready'){const label=document.createElement('span');label.className='pen-toolbar-status';label.textContent=row.notice|| (row.conflict?'原位置已变动，请重新定位':'已发送，等待返回');toolbar.append(label);}
  }
  async function viewVersion(row,key){const {snapshot}=await callTool('writing_version',{id:row.item.id,versionId:key});const panel=$('pen-version-dialog');$('pen-version-before').textContent=snapshot.text;$('pen-version-after').textContent=row.body.value;$('pen-version-title').textContent=`历史第${snapshot.generation}轮 / 当前第${row.item.generation}轮`;$('pen-version-restore').onclick=()=>run(row,async()=>{await saveEdit(row);await mutate(row,{action:'restoreVersion',versionId:key});panel.close();row.body.value=row.item.text;projectionDirty=true;reproject();});panel.showModal();}
  function makeRow(item){
    const element=document.createElement('span');element.className='pen-proposal';element.dataset.requestId=item.id;
    const marker=iconButton('递笔 · 查看操作','pen');marker.classList.add('pen-proposal-marker');
    const body=attachParagraphEditor(document.createElement('span'));body.className='pen-proposal-text';body.setAttribute('aria-label','编辑待采纳建议');body.setAttribute('role','textbox');body.setAttribute('aria-multiline','true');body.spellcheck=false;body.tabIndex=0;
    const original=document.createElement('span');
    original.className='pen-proposal-original';
    original.hidden=true;
    const status=document.createElement('span');status.className='pen-wait-label';
    const statusText=document.createTextNode('');
    const dots=document.createElement('span');
    dots.className='pen-wait-dots';
    dots.textContent='...';
    dots.setAttribute('aria-hidden','true');
    dots.hidden=true;
    status.append(statusText,dots);
    const actionSlot=document.createElement('span');
    actionSlot.className='pen-inline-actions';
    actionSlot.hidden=true;
    const row={item,element,body,original,marker,status,statusText,dots,actionSlot,dirty:false,busy:false,conflict:false,notice:'',editPromise:null,timer:null};
    marker.onclick=event=>{
      event.preventDefault();
      const showVersions=!row.conflict&&row.item.status==='ready'&&row.item.history?.length>1;
      showToolbar(row,showVersions);
      toolbar.querySelector(showVersions?'select':'button:not(:disabled)')?.focus({preventScroll:!toolbar.classList.contains('pen-toolbar-inline')});
    };
    element.append(original,marker,body,status,actionSlot);
    actionSlot.addEventListener('pointerenter',()=>showToolbar(row));
    actionSlot.addEventListener('pointerleave',scheduleToolbarHide);
    body.addEventListener('pointerenter',()=>showToolbar(row));
    body.addEventListener('pointerleave',()=>scheduleToolbarHide());
    body.addEventListener('focusin',()=>showToolbar(row));
    body.addEventListener('focusout',()=>scheduleToolbarHide());
    for(const event of ['input','beforeinput','paste','keydown','compositionstart','compositionend','contextmenu'])element.addEventListener(event,e=>{if(event!=='keydown'||!actionSlot.contains(e.target))e.stopPropagation();});
    body.addEventListener('input',()=>{row.dirty=true;row.notice='修改待保存';clearTimeout(row.timer);row.timer=setTimeout(()=>saveEdit(row).catch(error=>{row.notice=error.message;notify(error.message);}),600);});
    body.addEventListener('blur',()=>{setTimeout(async()=>{if(element.contains(document.activeElement)||toolbar.contains(document.activeElement))return;try{await saveEdit(row);if(projectionDirty)reproject();}catch(e){notify(e.message);}},0);});
    rows.set(item.id,row);return row;
  }
  function setRowStatus(row,label,waiting=false){
    row.statusText.data=label;
    row.status.classList.toggle('pen-wait-active',waiting);
    row.dots.hidden=!waiting;
  }
  function removeRow(row){
    clearTimeout(row.timer);
    row.body.disposeParagraphEditor();
    if(activeRow===row||row.actionSlot.contains(toolbar)){
      toolbar.hidden=true;
      toolbarHome.append(toolbar);
      activeRow=null;
    }
    row.element.remove();
    rows.delete(row.item.id);
    projectionDirty=true;
  }
  async function saveEdit(row){clearTimeout(row.timer);if(row.editPromise){await row.editPromise;return saveEdit(row);}if(!row.dirty)return;const value=row.body.value;if(!value.trim())throw new Error('建议内容为空；可点不采纳移除此条建议。');row.editPromise=mutate(row,{action:'edit',text:value});try{await row.editPromise;row.dirty=row.body.value!==value;row.notice=row.dirty?'有新的修改':'已保存';}finally{row.editPromise=null;updateToolbar();}}
  function reproject(){
    if([...rows.values()].some(row=>row.body.contains(document.activeElement)&&row.dirty)){projectionDirty=true;return;}
    const editing=[...rows.values()].find(row=>row.body.contains(document.activeElement)),editingSelection=editing?{start:editing.body.selectionStart,end:editing.body.selectionEnd}:null;
    const focused=editor===document.activeElement,scroll=editor.scrollTop,start=editor.selectionStart,end=editor.selectionEnd,source=editor.value;
    if(projected){editor.rebuildSource();projected=false;}
    for(const row of rows.values()){
      row.reviewGroup=null;
      row.inlineHost=null;
      row.actionSlot.hidden=true;
      row.element.remove();
    }
    for(const m of markers)m.remove();markers=[];
    const used=[];
    const proposals=allRows()
      .filter(row=>['waiting','ready','accepting'].includes(row.item.status))
      .map(row=>({row,range:sourceRange(row.item,source)}))
      .sort((a,b)=>(a.range?.start??a.row.item.offset)-(b.range?.start??b.row.item.offset));
    let previous=null;
    for(const {row,range} of proposals){
      const item=row.item;
      row.conflict=!range||used.some(r=>Math.max(r.start,range.start)<Math.min(r.end,range.end));
      if(row.conflict){row.notice='原位置已变动或与其他建议重叠，请重新定位';row.original.hidden=row.body.hidden=true;row.status.hidden=false;setRowStatus(row,'定位已变动');editor.placeDecoration(row.element,Math.min(item.offset,source.length));continue;}
      const ready=item.status==='ready';
      const replacing=ready&&item.mode==='replace';
      row.element.dataset.status=item.status;
      row.status.hidden=ready;
      setRowStatus(row,item.status==='waiting'?'递笔中':'正在保存…',item.status==='waiting');
      row.body.hidden=!ready;
      row.original.hidden=!replacing;
      if(!row.dirty&&row.body.value!==item.text)row.body.value=item.text;
      row.body.readOnly=!ready||row.busy;
      if(replacing){
        const original=source.slice(range.start,range.end);
        if(row.original.textContent!==original) row.original.textContent=original;
        editor.previewRange(row.element,range.start,range.end);
        projected=true;
        used.push(range);
      }
      else editor.placeDecoration(row.element,range.start);
      if(ready){
        // The source between the displayed ranges may contain paragraph breaks, but no prose.
        const adjacent=row.item.origin!=='chat'&&previous&&previous.end<=range.start&&!source.slice(previous.end,range.start).trim();
        row.reviewGroup=adjacent?previous.group:[];
        row.reviewGroup.push(row);
        previous=row.item.origin==='chat'?null:{end:range.end,group:row.reviewGroup};
      }else previous=null;
    }
    const lastInGroup=new Map();
    for(const {row} of proposals){
      const group=row.reviewGroup;
      if(!group)continue;
      const last=lastInGroup.get(group);
      if(!last||last.element.compareDocumentPosition(row.element)&Node.DOCUMENT_POSITION_FOLLOWING){
        lastInGroup.set(group,row);
      }
    }
    for(const [group,row] of lastInGroup){
      row.actionSlot.classList.toggle('pen-inline-actions-group',group.length>1);
      row.actionSlot.hidden=false;
      for(const member of group)member.inlineHost=row.actionSlot;
    }
    const groups=new Map();for(const draft of drafts.filter(d=>d.path===workspace.path&&d.status==='draft')){const range=sourceRange(draft,source);if(!range)continue;const point=used.find(r=>range.end>r.start&&range.end<r.end)?.start??range.end;if(!groups.has(point))groups.set(point,[]);groups.get(point).push(draft);}
    for(const [point,items] of groups){const marker=iconButton(items.length>1?`${items.length}条批注`:'查看批注','note',()=>{if(items.length===1)void open(items[0]);else{$('pen-note-picker').replaceChildren();for(const item of items){const b=document.createElement('button');b.textContent=item.instruction;b.onclick=()=>{$('pen-note-picker-dialog').close();void open(item);};$('pen-note-picker').append(b);}$('pen-note-picker-dialog').showModal();}});marker.classList.add('pen-note-marker');marker.dataset.noteIds=items.map(i=>i.id).join(',');if(items.length>1){const count=document.createElement('small');count.textContent=items.length;marker.append(count);}marker.title=items.map(i=>i.instruction).join(' / ').slice(0,240);const highlight=()=>{const range=sourceRange(items[0]);if(range)editor.highlightRange?.(range.start,range.end);};marker.addEventListener('pointerenter',highlight);marker.addEventListener('focus',highlight);marker.addEventListener('pointerleave',()=>editor.highlightRange?.());marker.addEventListener('blur',()=>editor.highlightRange?.());editor.placeDecoration(marker,point);markers.push(marker);}
    if(focused){editor.focus({preventScroll:true});editor.setSelectionRange(start,end);}else if(editing?.body.isConnected&&!editing.body.hidden){editing.body.focus({preventScroll:true});editing.body.setSelectionRange(editingSelection.start,editingSelection.end);}editor.scrollTop=scroll;projectionDirty=false;updateReviewActions();
    if(!toolbar.hidden){updateToolbar();positionToolbar();}
    document.dispatchEvent(new Event('workbench:source-projected'));
  }
  function renderNotes(){const list=$('annotation-list');list.replaceChildren();const panel=list.closest('.writing-sidebar');const empty=drafts.length===0;if(panel.hidden!==empty){panel.hidden=empty;document.dispatchEvent(new CustomEvent('workbench:stats-layout'));}$('annotation-count').textContent=`${drafts.length}条`;
    for(const item of drafts){const card=document.createElement('div');card.className='pen-note-card';card.dataset.id=item.id;const button=document.createElement('button');button.className='pen-note-open';button.title=item.path||item.title;const name=document.createElement('small');name.textContent=item.path?.split('/').slice(-2).join(' / ')||'草稿';const body=document.createElement('span');body.textContent=item.instruction;button.append(name,body);button.onclick=()=>void open(item);const remove=iconButton('删除批注','trash',()=>void deleteDraft(item));remove.classList.add('pen-note-delete');card.append(button,remove);list.append(card);}
    updateBatchButtons();
    if(historyOpen){const list=$('pen-history-list');list.replaceChildren();for(const item of completed){const entry=document.createElement('div');entry.className='pen-history-entry';const text=document.createElement('p');text.textContent=`${new Date(item.updatedAt).toLocaleString('zh-CN')} · ${item.status==='accepted'?'已采纳':item.status==='answered'?'已讨论':'未采纳'} · ${item.instruction}`;entry.append(text);if(item.status==='accepted'){entry.append(iconButton('撤销这次采纳','undo',async()=>{try{await workspace.applyWritingAction(item,'undo');await sync(true);}catch(e){notify(e.message);}}));}const resultText=item.status==='accepted'?(item.acceptance?.inserted??item.text):item.text;if(resultText){const details=document.createElement('details'),summary=document.createElement('summary'),body=document.createElement('pre');summary.textContent='查看结果';body.textContent=resultText;details.append(summary,body);entry.append(details);}list.append(entry);}}
  }
  function updateBatchButtons(){ $('annotations-to-chat').disabled=sending||!canMessage()||!drafts.length;$('annotations-clear').disabled=sending||!drafts.length; }
  async function deleteDraft(item){if(sending)return;try{await callTool('update_writing_request',{id:item.id,version:item.version,action:'discard'});epoch++;await sync(true);}catch(error){notify('删除批注未完成：'+error.message);}}
  async function sync(force=false){if(!supported)return;if(fetching){refreshPending||=force;return;}fetching=true;const path=workspace.path,stamp=epoch;try{const result=await callTool('writing_requests',{path,allDrafts:true,history:historyOpen});if(path!==workspace.path||stamp!==epoch)return;
    workspace.setPendingWritingPaths(result.readyPaths,result.requests.some(item=>['ready','accepting'].includes(item.status)));
    drafts=result.drafts||[];completed=result.completed||[];archivable=result.archivable||[];const found=new Set(result.requests.map(i=>i.id));let change=force;
    for(const row of [...rows.values()])if(row.item.path!==path||!found.has(row.item.id)){if(!row.dirty&&!row.busy){removeRow(row);change=true;}}
    for(const item of result.requests){if(item.status==='draft')continue;let row=rows.get(item.id);if(!row){row=makeRow(item);change=true;}else if(!row.dirty&&!row.busy&&!row.editPromise&&item.version>=row.item.version){if(item.text!==row.item.text||item.status!==row.item.status||item.mode!==row.item.mode)change=true;row.item=item;}}
    $('ai-writing-status').textContent=result.warnings?.length?`${result.warnings.length}条递笔记录异常，其他内容可正常使用。`:'';renderNotes();if(change||projectionDirty)reproject();updateToolbar();
  }catch(error){notify('递笔同步未完成：'+error.message);}finally{fetching=false;available();if(refreshPending){refreshPending=false;void sync(true);}}}
  async function open(item=null,regenerate=false){
    if(editor.readOnly)return;toolbar.hidden=true;$('selection-menu').hidden=true;
    try{
      if(item&&item.path!==workspace.path){if(item.path)await workspace.openDocument(item.path);else await workspace.openDraft();if(workspace.path!==item.path)throw new Error('未能打开批注所属文稿。');const result=await callTool('writing_requests',{path:workspace.path,allDrafts:true});item=result.requests.find(i=>i.id===item.id);if(!item)throw new Error('批注已更新，请刷新列表。');}
      const relocation=!item&&relocating?.path===workspace.path?relocating:null;
      if(relocation){item=relocation.item;regenerate=relocation.regenerate;}
      let range=item&&!relocation?sourceRange(item):{start:editor.selectionStart,end:editor.selectionEnd};
      if(item&&!range){notify('原文位置有变化。请在正文放置新选区后，使用弹窗里的重新定位操作。');range={start:editor.selectionStart,end:editor.selectionEnd};}
      if(item){editor.focus({preventScroll:true});editor.setSelectionRange(range.start,range.end);editor.scrollSelectionIntoView();}
      current={item,regenerate,path:workspace.path,baseBody:editor.value,offset:range.start,endOffset:range.end,clientId:uuid(),relocated:!!relocation};composing=false;input.value=relocation?.instruction??(regenerate?'':item?.instruction||'');$('pen-error').textContent='';$('pen-heading').textContent=regenerate?'再递笔':'递笔';relocating=null;
      const quote=current.baseBody.slice(range.start,range.end);$('pen-context').textContent=quote||current.baseBody.slice(Math.max(0,range.start-90),range.start)+'｜'+current.baseBody.slice(range.end,range.end+90);
      $('pen-delete').hidden=!item;$('pen-relocate').hidden=!item;$('pen-save').hidden=regenerate;
      const choices=$('pen-context-files');choices.replaceChildren();const work=workspace.path.split('/')[0];for(const file of workspace.files.filter(f=>f.path!==workspace.path&&f.path.startsWith(work+'/'))){const label=document.createElement('label'),check=document.createElement('input');check.type='checkbox';check.value=file.path;check.checked=item?.contextPaths?.includes(file.path)||false;label.append(check,document.createTextNode(file.path.slice(work.length+1)));choices.append(label);}
      editor.highlightRange?.();dialog.showModal();input.focus();available();
    }catch(e){notify(e.message);}
  }
  function close(){if(submitting)return;dialog.close();current=null;editor.focus({preventScroll:true});}
  async function saveRecord(){
    if(!supported)throw new Error('递笔后台尚未更新，请保存文稿并重启客户端后再试。');
    const instruction=input.value.trim();if(!instruction)throw new Error('写下希望 AI 帮你做什么。');
    const contextPaths=[...$('pen-context-files').querySelectorAll('input:checked')].map(el=>el.value);if(contextPaths.length>8)throw new Error('最多选择8份参考资料。');
    if(current.path!==workspace.path)throw new Error('文稿已切换，请重新打开递笔。');
    const range=rebaseWritingRange(current.baseBody,editor.value,current.offset,current.endOffset);if(!range)throw new Error('目标原文已改变，请重新定位。');
    await workspace.flushDocument();
    if(current.regenerate){const row=rows.get(current.item.id);if(!row)throw new Error('这条建议已更新。');await saveEdit(row);if(current.relocated)await mutate(row,{action:'relocate',body:editor.value,offset:range.start,endOffset:range.end});return (await mutate(row,{action:'regenerate',instruction,contextPaths})).request;}
    if(current.item){try{return (await callTool('update_writing_request',{id:current.item.id,version:current.item.version,action:'save',instruction,body:editor.value,offset:range.start,endOffset:range.end,contextPaths})).request;}catch(e){if(!/已更新|已发送/.test(e.message))throw e;/* Preserve an edit made while its earlier snapshot was being sent. */}}
    return (await callTool('create_writing_request',{path:workspace.path,title:title.value.trim()||'未命名草稿',body:editor.value,offset:range.start,endOffset:range.end,instruction,draft:true,clientId:current.clientId,contextPaths})).request;
  }
  async function submit(send){if(submitting||!current)return;submitting=true;input.readOnly=true;available();try{const item=await saveRecord();epoch++;dialog.close();current=null;await sync(true);if(send)await deliver([item]);}catch(error){setError(error);}finally{submitting=false;input.readOnly=false;available();}}
  async function deliver(items,retry=false){
    if(sending||!items.length)return;if(!canMessage())throw new Error('当前宿主未开放聊天发送接口，要求仍已暂存。');
    const prepared=[];sending=true;updateBatchButtons();updateReviewActions();
    try{
      await workspace.flushDocument();
      // Identical requirements at different anchors need separate context entries.
      for(const item of items){const result=await callTool('update_writing_request',{id:item.id,version:item.version,action:'prepare',retry});if(!result.alreadySent)prepared.push(result.request);}
      epoch++;await sync(true);if(!prepared.length){notify('这些要求已经发送，正在等待回复。');return;}
      await sendMessage(penMessage(prepared));
      for(const item of prepared){await callTool('update_writing_request',{id:item.id,version:item.version,action:'delivery',deliveryToken:item.delivery.token,deliveryState:'sent'});}
      notify(`已发送${prepared.length}条递笔，等待 AI 返回。`);
    }catch(error){for(const item of prepared){await callTool('update_writing_request',{id:item.id,version:item.version,action:'delivery',deliveryToken:item.delivery.token,deliveryState:'failed'}).catch(()=>{});}notify('发送未完成：'+error.message+' 要求已保留，可从原位置重试。');}
    finally{sending=false;epoch++;await sync(true);updateBatchButtons();updateReviewActions();}
  }
  decorateButton($('pen-open'),'递笔','pen');decorateButton($('pen-save'),'暂存','bookmark');decorateButton($('pen-send'),'发送','send');decorateButton($('pen-cancel'),'取消','close');decorateButton($('pen-delete'),'删除批注','trash');decorateButton($('pen-relocate'),'重新定位到当前光标','pen');
  $('pen-open').onclick=()=>open();$('menu-pen').onclick=()=>open();$('pen-save').onclick=()=>submit(false);$('pen-send').onclick=()=>submit(true);$('pen-cancel').onclick=close;
  $('pen-delete').onclick=async()=>{if(submitting||!current?.item)return;try{await callTool('update_writing_request',{id:current.item.id,version:current.item.version,action:'discard'});close();epoch++;await sync(true);}catch(e){setError(e);}};
  $('pen-relocate').onclick=()=>{if(!current)return;relocating={...current,instruction:input.value};dialog.close();current=null;editor.focus({preventScroll:true});notify('请在正文选择新位置，再点「递笔」。刚才的要求会保留。');};
  dialog.addEventListener('cancel',e=>{e.preventDefault();close();});input.addEventListener('compositionstart',()=>composing=true);input.addEventListener('compositionend',()=>composing=false);input.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing&&!composing&&e.keyCode!==229){e.preventDefault();if(!e.repeat&&canMessage())submit(true);}});
  $('annotations-to-chat').onclick=()=>deliver(drafts);
  $('annotations-clear').onclick=async()=>{
    if(sending||!drafts.length)return;
    sending=true;updateBatchButtons();
    try {for(const item of [...drafts])await callTool('update_writing_request',{id:item.id,version:item.version,action:'discard'});notify('已删除全部批注。');}
    catch(error){notify('删除未完成：'+error.message);}
    finally {sending=false;epoch++;await sync(true);updateBatchButtons();}
  };
  $('pen-history-open').onclick=async()=>{historyOpen=true;$('pen-history-dialog').showModal();await sync(true);};$('pen-history-close').onclick=()=>{$('pen-history-dialog').close();historyOpen=false;};
  $('pen-archive').onclick=async()=>{try{for(const item of archivable)await callTool('update_writing_request',{id:item.id,version:item.version,action:'archive'});notify('已归档处理记录，版本文件仍保留。');await sync(true);}catch(e){notify(e.message);}};
  $('pen-version-close').onclick=()=>$('pen-version-dialog').close();$('pen-note-picker-close').onclick=()=>$('pen-note-picker-dialog').close();
  document.addEventListener('pointerdown',e=>{if(!toolbar.contains(e.target)&&!e.target.closest('.pen-proposal'))toolbar.hidden=true;});
  toolbar.addEventListener('pointerenter',()=>clearTimeout(toolbarHideTimer));
  toolbar.addEventListener('pointerleave',()=>scheduleToolbarHide());
  toolbar.addEventListener('focusin',()=>clearTimeout(toolbarHideTimer));
  toolbar.addEventListener('focusout',()=>scheduleToolbarHide());
  document.addEventListener('workbench:documentchange',()=>{epoch++;projected=false;projectionDirty=true;toolbar.hidden=true;updateReviewActions();void sync(true);});
  document.addEventListener('workbench:source-rebuilt',()=>{projected=false;projectionDirty=true;reproject();});
  document.addEventListener('workbench:protected-range',()=>notify('这处有待采纳的修改，请先采纳或不采纳，再删除跨越该范围的原文。'));
  editor.addEventListener('input',e=>{if(!editor.isDecorationEvent(e))positionToolbar();});
  window.addEventListener('resize',positionToolbar);document.addEventListener('scroll',positionToolbar,true);
  new MutationObserver(positionToolbar).observe(toolbar,{attributes:true,attributeFilter:['hidden']});
  const timer=setInterval(()=>{if(!document.hidden)void sync();},2500);
  return {open,refreshAvailability:available,async connected(value){supported=value;available();await sync(true);},dispose(){clearInterval(timer);clearTimeout(toolbarHideTimer);disposeCaret();}};
}
