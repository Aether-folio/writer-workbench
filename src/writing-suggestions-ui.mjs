import {rebaseWritingAnchor,writingRequestMessage} from './writing-anchor.mjs';
import {attachParagraphEditor} from './paragraph-editor.mjs';

export function attachWritingSuggestions({editor,title,workspace,callTool,sendMessage,canMessage,notify}) {
  const $=id=>document.getElementById(id),dialog=$('ai-writing-dialog'),rows=new Map();
  let enabled=false,fetching=false,epoch=0,form=null,submitting=false,instructionComposing=false;
  const button=(label,action,className='')=>{const element=document.createElement('button');element.type='button';element.textContent=label;element.className=className;element.addEventListener('click',action);return element;};
  function position(row) {
    if(row.item.path!==workspace.path){row.element.remove();return;}
    const offset=rebaseWritingAnchor(row.item.baseBody,editor.value,row.item.offset);
    row.conflict=offset===null;
    row.accept.disabled=row.busy || row.item.status==='waiting' || row.conflict;
    row.relocate.hidden=!row.conflict;
    row.status.textContent=row.conflict?'原文位置有变，请在正文放置光标后点击「移到光标处」。':row.notice || (row.item.status==='waiting'?'等待 AI 返回；如尚未发送，可重新发送请求。':row.item.status==='accepting'?'上次采纳未完成，可重试采纳':'AI 建议 · 可直接编辑');
    const target=offset ?? Math.min(row.item.offset,editor.value.length);
    if(!row.element.isConnected || row.offset!==target) {
      const mainFocused=document.activeElement===editor,start=editor.selectionStart,end=editor.selectionEnd;
      row.element.remove();editor.placeDecoration(row.element,target);row.offset=target;
      if(mainFocused)editor.setSelectionRange(start,end);
    }
  }
  function update(row,item) {
    if(row.item.status!==item.status || row.item.generation!==item.generation){row.notice='';row.delivery='unknown';}
    row.item=item;
    row.body.hidden=!item.text;
    if(!row.dirty && row.body.value!==item.text)row.body.value=item.text;
    row.body.contentEditable=item.status==='ready' && !row.busy?'plaintext-only':'false';
    row.regenerate.disabled=row.busy || item.status==='accepting';
    row.retry.hidden=item.status!=='waiting' || ['sent','sending'].includes(row.delivery);row.retry.disabled=row.busy || !canMessage();
    row.discard.disabled=row.busy;
    position(row);
  }
  function makeRow(item) {
    const element=document.createElement('span');element.className='ai-suggestion';element.dataset.requestId=item.id;
    element.setAttribute('role','group');element.setAttribute('aria-label','AI 待采纳内容');
    const status=document.createElement('span');status.className='ai-suggestion-status';status.setAttribute('role','status');
    const body=attachParagraphEditor(document.createElement('span'));body.className='ai-suggestion-body';body.tabIndex=0;body.setAttribute('role','textbox');body.setAttribute('aria-label','编辑 AI 建议');body.setAttribute('aria-multiline','true');body.spellcheck=false;
    const actions=document.createElement('span');actions.className='ai-suggestion-actions';
    const row={item,element,status,body,dirty:false,busy:false,notice:'',delivery:'unknown',editTimer:null,editPromise:null};
    row.retry=button('重新发送请求',()=>act(row,()=>sendWritingRequest(row)));
    row.relocate=button('移到光标处',()=>act(row,async()=>{await mutate(row,{action:'relocate',body:editor.value,offset:editor.selectionStart});row.notice='已重新定位。';}));
    row.discard=button('不采纳',()=>act(row,async()=>{
      clearTimeout(row.editTimer);
      if(row.editPromise)await row.editPromise.catch(()=>{});
      row.dirty=false;
      await mutate(row,{action:'discard'});remove(row);
    }));
    row.regenerate=button('批注重生成',()=>open({row}));
    row.accept=button('采纳',()=>act(row,async()=>{
      await saveEdit(row);
      await workspace.acceptWritingSuggestion(row.item);
      remove(row);notify('已采纳并保存到文稿。');
      await sync();
    }),'primary');
    actions.append(row.retry,row.relocate,row.discard,row.regenerate,row.accept);
    element.append(status,body,actions);
    // Nested editing must never become a manuscript edit or alter writing totals.
    for(const type of ['input','beforeinput','compositionstart','compositionend','paste','keydown','contextmenu'])element.addEventListener(type,event=>event.stopPropagation());
    body.addEventListener('input',()=>{row.dirty=true;row.notice='建议尚未保存…';position(row);clearTimeout(row.editTimer);row.editTimer=setTimeout(()=>saveEdit(row).catch(error=>{row.notice='建议保存未完成：'+error.message;position(row);}),600);});
    body.addEventListener('blur',()=>{if(row.dirty)saveEdit(row).catch(error=>{row.notice=error.message;position(row);});});
    rows.set(item.id,row);update(row,item);return row;
  }
  function remove(row) {clearTimeout(row.editTimer);row.body.disposeParagraphEditor();row.element.remove();rows.delete(row.item.id);}
  async function mutate(row,patch) {
    const result=await callTool('update_writing_request',{id:row.item.id,version:row.item.version,...patch});
    epoch++;
    update(row,result.request);return result.request;
  }
  async function saveEdit(row) {
    clearTimeout(row.editTimer);
    if(row.editPromise){await row.editPromise;return saveEdit(row);}
    if(!row.dirty)return;
    const value=row.body.value;
    if(!value.trim())throw new Error('建议内容为空，请填写内容或选择不采纳。');
    row.editPromise=mutate(row,{action:'edit',text:value});
    try {await row.editPromise;row.dirty=row.body.value!==value;row.notice=row.dirty?'建议尚未保存…':'建议已保存';}
    finally {row.editPromise=null;position(row);}
  }
  async function act(row,run) {
    if(row.busy)return;
    row.busy=true;update(row,row.item);
    try {await run();}
    catch(error){row.notice=error.message;notify(error.message);}
    finally {row.busy=false;if(rows.has(row.item.id))update(row,row.item);}
  }
  async function sendWritingRequest(row) {
    if(['sent','sending'].includes(row.delivery))return;
    row.delivery='sending';row.notice='正在发送写作请求…';update(row,row.item);
    try {
      await sendMessage(writingRequestMessage(row.item));
      row.delivery='sent';row.notice='写作请求已发送，等待 AI 返回。';
    } catch(error) {
      row.delivery='failed';
      row.notice='发送未完成：'+error.message+' 可点击「重新发送请求」重试。';
      throw new Error(row.notice);
    } finally {update(row,row.item);}
  }
  async function sync() {
    if(!enabled || fetching)return;
    const path=workspace.path,generation=epoch;fetching=true;
    try {
      const {requests}=await callTool('writing_requests',{path});
      if(generation!==epoch || path!==workspace.path)return;
      const found=new Set(requests.map(item=>item.id));
      for(const row of rows.values())if(row.item.path===path && !found.has(row.item.id) && !row.busy && !row.dirty)remove(row);
      for(const item of requests) {
        const row=rows.get(item.id);
        if(row){if(!row.busy && !row.editPromise && !row.dirty && item.version>=row.item.version)update(row,item);else position(row);}
        else makeRow(item);
      }
    } catch(error){$('ai-writing-status').textContent='AI 建议同步未完成：'+error.message;}
    finally {fetching=false;}
  }
  function refreshAvailability() {
    const unavailable=!canMessage() || editor.readOnly;
    $('ai-writing-open').disabled=unavailable;$('menu-ai-writing').disabled=unavailable;
  }
  function open({row}={}) {
    if(editor.readOnly)return;
    if(!canMessage()){notify('当前宿主未开放聊天发送接口。');return;}
    form=row?{row}:{path:workspace.path,body:editor.value,offset:editor.selectionEnd};
    instructionComposing=false;
    $('ai-writing-heading').textContent=row?'添加批注并重新生成':'在光标处插入 AI 内容';
    $('ai-writing-submit').textContent=row?'发送并重新生成':'发送写作请求';
    $('ai-writing-instruction').value='';$('ai-writing-error').textContent='';
    $('ai-writing-context').textContent=row?row.body.value:(form.body.slice(Math.max(0,form.offset-100),form.offset)+'【在此插入】'+form.body.slice(form.offset,form.offset+100));
    dialog.showModal();$('ai-writing-instruction').focus();
  }
  function close(){if(submitting)return;dialog.close();form=null;editor.focus();}
  async function submit() {
    if(submitting || !form)return;
    const instruction=$('ai-writing-instruction').value.trim();
    if(!instruction){$('ai-writing-error').textContent='请填写希望 AI 写什么。';return;}
    const snapshot=form;
    submitting=true;$('ai-writing-submit').disabled=true;$('ai-writing-submit').textContent='正在发送…';$('ai-writing-instruction').readOnly=true;
    try {
      const info=await callTool('workspace_info',{});
      if(!info.features?.writingSuggestions || !info.features?.writingRequestContext)throw new Error('AI 插入后台仍是旧版本。请先保存文稿，完全退出并重新启动 Codex，以加载更新后的插件。');
      enabled=true;
      let row=snapshot.row;
      if(row) {
        await saveEdit(row);
        await mutate(row,{action:'regenerate',instruction:row.item.instruction+'\n\n本轮修改批注：'+instruction});
      } else {
        if(snapshot.path!==workspace.path || snapshot.body!==editor.value)throw new Error('文稿已改变，请回到目标位置重新发起。');
        await workspace.flushDocument();
        const result=await callTool('create_writing_request',{...snapshot,title:title.value.trim() || '未命名草稿',instruction});
        epoch++;
        row=makeRow(result.request);
      }
      // Save the target before sending, so even an immediate answer has a destination.
      try {await sendWritingRequest(row);}
      catch(error){notify(error.message);}
      update(row,row.item);dialog.close();form=null;
      $('ai-writing-status').textContent=row.notice;
    } catch(error){$('ai-writing-error').textContent=error.message;}
    finally {submitting=false;$('ai-writing-submit').disabled=false;$('ai-writing-submit').textContent=snapshot.row?'发送并重新生成':'发送写作请求';$('ai-writing-instruction').readOnly=false;}
  }
  const instructionInput=$('ai-writing-instruction');
  instructionInput.addEventListener('compositionstart',()=>{instructionComposing=true;});
  instructionInput.addEventListener('compositionend',()=>{instructionComposing=false;});
  instructionInput.addEventListener('keydown',event=>{
    if(event.key!=='Enter' || event.shiftKey || event.isComposing || instructionComposing || event.keyCode===229)return;
    event.preventDefault();
    if(!event.repeat)submit();
  });
  $('ai-writing-open').addEventListener('click',()=>open());
  $('menu-ai-writing').addEventListener('click',()=>{$('selection-menu').hidden=true;open();});
  $('ai-writing-submit').addEventListener('click',submit);
  $('ai-writing-cancel').addEventListener('click',close);
  dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
  editor.addEventListener('input',event=>{if(!editor.isDecorationEvent(event))for(const row of rows.values())position(row);});
  document.addEventListener('workbench:documentchange',()=>{
    epoch++;
    for(const row of rows.values())position(row);
    sync();
  });
  setInterval(()=>{if(!document.hidden)sync();},1500);
  return {open,refreshAvailability,async connected(supported){enabled=supported;refreshAvailability();$('ai-writing-status').textContent=supported?'':'AI 插入后台尚未更新，可先填写要求；发送前会检查连接。';await sync();}};
}
