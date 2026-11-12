import {textDiff} from './text-diff.mjs';
const $=id=>document.getElementById(id);
export function attachWriterTools({editor,workspace,callTool,notify}) {
  let matches=[],selected=-1,searchEpoch=0,backupEpoch=0,backup=null,backupPath='',backupRevision='';
  function showDiff(node,before,after){node.replaceChildren();for(const part of textDiff(before,after)){const span=document.createElement(part.type==='remove'?'del':'span');span.className='diff-'+part.type;span.textContent=part.text;node.append(span);}}
  const searchQuery=$('search-query'), searchWork=$('search-work'), searchStatus=$('search-status');
  let localSearch;
  function chapterMatches(source,query){
    const found=[];
    for(let offset=source.indexOf(query);offset!==-1;offset=source.indexOf(query,offset+query.length)){
      found.push({path:workspace.path,offset,excerpt:source.slice(Math.max(0,offset-30),offset+query.length+40)});
    }
    return found;
  }
  function renderSearchResults(result,append=false){
    matches=append?[...matches,...result.matches]:result.matches;
    selected=-1;
    const list=$('search-results');
    list.replaceChildren();
    for(const [index,item] of matches.entries()){
      const button=document.createElement('button');
      button.type='button';
      button.className='search-result';
      button.textContent=(item.path?.split('/').pop()||'草稿')+' · '+item.excerpt;
      button.onclick=()=>void locate(index);
      list.append(button);
    }
    $('search-more').hidden=!result.hasMore;
  }
  async function locate(index){
    if(!matches.length) return;
    selected=index<0?matches.length-1:index%matches.length;
    const match=matches[selected], query=searchQuery.value, stamp=searchEpoch;
    if(match.path!==workspace.path) await workspace.openDocument(match.path);
    if(stamp!==searchEpoch || match.path!==workspace.path) return;
    if(editor.value.slice(match.offset,match.offset+query.length)!==query){
      searchStatus.textContent='文稿已变化，请重新查找。';
      return;
    }
    editor.focus({preventScroll:true});
    editor.setSelectionRange(match.offset,match.offset+query.length);
    editor.scrollSelectionIntoView();
    searchStatus.textContent=(selected+1)+' / '+matches.length;
  }
  async function search(append=false,feedback=''){
    const query=searchQuery.value, stamp=++searchEpoch;
    localSearch=null;
    if(!query.trim()){
      renderSearchResults({matches:[]});
      searchStatus.textContent='请输入查找内容。';
      return;
    }
    try{
      let result;
      if(searchWork.checked){
        const workPath=workspace.path.split('/')[0];
        if(!workPath) throw new Error('请先打开作品文稿。');
        await workspace.flushDocument();
        result=await callTool('search_documents',{workPath,query,offset:append?matches.length:0,limit:100});
      }else{
        const source=editor.value;
        const found=chapterMatches(source,query);
        result={matches:found,total:found.length};
        localSearch={path:workspace.path,query,source};
      }
      if(stamp!==searchEpoch) return;
      renderSearchResults(result,append);
      searchStatus.textContent=feedback||'找到'+result.total+'处';
    }catch(error){
      if(stamp===searchEpoch) searchStatus.textContent=feedback?feedback+'搜索结果刷新失败：'+error.message:error.message;
    }
  }
  function replace(all=false){
    if(!all&&searchWork.checked){
      searchStatus.textContent='跨章节搜索只定位；打开目标章节后取消整本搜索再替换。';
      return;
    }
    const query=searchQuery.value;
    if(!query.trim()){
      searchStatus.textContent='请输入查找内容。';
      return;
    }
    const source=editor.value, path=workspace.path;
    const found=chapterMatches(source,query);
    if(!found.length){
      if(all)searchStatus.textContent='本章没有找到要替换的内容。';
      else void search();
      return;
    }
    // A result index is valid only for the same query, document and text.
    const selectedMatch=localSearch?.path===path&&localSearch.query===query&&localSearch.source===source?matches[selected]:null;
    const targets=(all?found:[selectedMatch??found[0]]).map(({offset})=>({start:offset,end:offset+query.length}));
    try{
      const ranges=targets.filter(({start,end})=>!editor.hasProtectedRange(start,end));
      const skipped=targets.length-ranges.length;
      if(!ranges.length){
        throw new Error('目标包含待采纳内容，请先处理递笔。');
      }
      const replacement=$('search-replacement').value;
      if(replacement===query){
        searchStatus.textContent='替换内容与查找内容相同。';
        return;
      }
      const caret=editor.replaceRanges(ranges,replacement);
      const remaining=chapterMatches(editor.value,query);
      const feedback='已替换 '+ranges.length+' 处，本章剩余 '+remaining.length+' 处。'+
        (skipped?'其中 '+skipped+' 处涉及待采纳改稿，未替换。':'');
      if(searchWork.checked){
        renderSearchResults({matches:[]});
        searchStatus.textContent=feedback;
        void search(false,feedback);
        return;
      }
      localSearch={path,query,source:editor.value};
      ++searchEpoch;
      renderSearchResults({matches:remaining});
      if(!all && remaining.length){
        const next=remaining.findIndex(match=>match.offset>=caret);
        selected=next<0?0:next;
      }
      searchStatus.textContent=feedback;
    }catch(error){
      searchStatus.textContent=error.message;
    }
  }
  function clearSearch(){
    ++searchEpoch;
    localSearch=null;
    renderSearchResults({matches:[]});
    searchStatus.textContent='';
  }
  searchQuery.addEventListener('input',clearSearch);
  searchWork.addEventListener('change',clearSearch);
  $('search-open').onclick=()=>{if(!$('search-dialog').open)$('search-dialog').show();searchQuery.focus();};
  $('search-close').onclick=()=>$('search-dialog').close();
  $('search-find').onclick=()=>search();
  $('search-more').onclick=()=>search(true);
  $('search-next').onclick=()=>locate(selected+1);
  $('search-previous').onclick=()=>locate(selected-1);
  $('search-replace').onclick=()=>replace();
  $('search-replace-all').onclick=()=>replace(true);
  searchQuery.onkeydown=event=>{if(event.key==='Enter'&&!event.isComposing){event.preventDefault();void search();}};
  document.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='f'&&!document.querySelector('dialog[open]')){e.preventDefault();$('search-dialog').show();$('search-query').focus();}});
  async function backups(){if(!workspace.path){notify('先将草稿保存为文稿，再查看备份。');return;}const stamp=++backupEpoch;try{await workspace.flushDocument();backupPath=workspace.path;backupRevision=workspace.revision;const result=await callTool('list_backups',{path:backupPath});if(stamp!==backupEpoch)return;backup=null;$('backup-target').textContent=backupPath;const list=$('backup-list');list.replaceChildren();for(const entry of result.entries){const option=document.createElement('option');option.value=entry.id;option.textContent=(entry.legacy?'旧版备份（原归属未知） · ':'')+new Date(entry.createdAt).toLocaleString('zh-CN')+` · ${Math.round(entry.bytes/1024)}KB`;list.append(option);}$('backup-after').textContent=editor.value;$('backup-before').textContent='';$('backup-restore').disabled=true;$('backup-status').textContent=result.entries.length?`共${result.entries.length}份。恢复前会自动备份当前正文。`:'当前文稿暂无覆盖前备份。';if(result.warnings?.length)$('backup-status').textContent+=' '+result.warnings.join(' ');if(!$('backup-dialog').open)$('backup-dialog').showModal();}catch(e){notify(e.message);}}
  $('backup-open').onclick=backups;$('backup-close').onclick=()=>{$('backup-dialog').close();backupEpoch++;};
  $('backup-list').onchange=async()=>{const stamp=++backupEpoch;try{const result=await callTool('read_backup',{id:$('backup-list').value});if(stamp!==backupEpoch)return;backup=result;showDiff($('backup-before'),editor.value,result.body);$('backup-after').textContent=editor.value;$('backup-restore').disabled=false;$('backup-status').textContent=result.entry.legacy?'此为旧版备份，恢复目标为当前显示的文稿，请核对内容。':'预览变动：删除线为当前将被替换的内容，淡绿为备份内容。';}catch(e){$('backup-status').textContent=e.message;}};
  $('backup-restore').onclick=async()=>{if(!backup||workspace.path!==backupPath)return;try{const result=await callTool('restore_backup',{id:backup.entry.id,path:backupPath,revision:backupRevision});workspace.loadDocument(result.document);workspace.showEditor();$('backup-dialog').close();notify('已恢复备份，恢复前的正文也已备份。');}catch(e){$('backup-status').textContent=e.message;}};
  $('backup-prune').onclick=async()=>{try{const result=await callTool('prune_backups',{path:backupPath,keep:Number($('backup-keep').value)});await backups();$('backup-status').textContent=`已清理${result.removed}份较早备份。旧版未知归属的备份仍保留。`;}catch(e){$('backup-status').textContent=e.message;}};
}
