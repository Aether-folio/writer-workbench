import {statsMediaWidth} from './stats-media.mjs';

const chineseDigits={'零':0,'〇':0,'一':1,'二':2,'两':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9};
const chineseUnits={'十':10,'百':100,'千':1000,'万':10000,'亿':100000000};

function ordinalNumber(text) {
  if(/^\d+$/.test(text))return String(Number(text));
  if([...text].every(char=>char in chineseDigits))return [...text].map(char=>chineseDigits[char]).join('');
  let total=0,section=0,digit=0;
  for(const char of text) {
    if(char in chineseDigits){digit=chineseDigits[char];continue;}
    const unit=chineseUnits[char];
    if(unit<10000) section+=(digit || 1)*unit;
    else {
      section+=digit;
      total=unit===100000000?(total+section)*unit:total+section*unit;
      section=0;
    }
    digit=0;
  }
  return String(total+section+digit);
}

function ordinalSortKey(name) {
  // Collation's numeric option handles Arabic digits only; normalize chapter and volume numbers first.
  return name.replace(/^(\s*第\s*)([0-9零〇一二两三四五六七八九十百千万亿]+)(\s*[章回节卷部集篇])/,(_,prefix,number,suffix)=>prefix+ordinalNumber(number)+suffix)
    .replace(/^(\s*[卷部集篇]\s*)([0-9零〇一二两三四五六七八九十百千万亿]+)(?=$|[\s._、:：-])/,(_,prefix,number)=>prefix+ordinalNumber(number));
}

export function fileTree(files,directories=[],chapterOrders={}) {
  const root=new Map();
  for(const file of [...directories.map(folder=>({...folder,directory:true})),...files]) {
    const parts=file.path.split('/');let branch=root,prefix='';
    for(const [index,name] of parts.entries()) {
      prefix+=(prefix?'/':'')+name;
      if(!branch.has(name)) branch.set(name,{name,path:prefix,...(index<parts.length-1 || file.directory?{children:new Map()}: {})});
      branch=branch.get(name).children;
    }
  }
  const folderOrder=new Map([['正文',0],['设定',1],['草稿',2]]);
  function sort(branch,order=null) {
    const workFolders=branch.get('正文')?.children && branch.get('设定')?.children;
    const priority=node=>!node.children ? 4 : workFolders ? (folderOrder.get(node.name) ?? 3) : node.name==='正文' ? 0 : 3;
    return [...branch.values()]
      .sort((a,b)=>priority(a)-priority(b) || (order==='desc'?-1:1)*compareChapterNames(a.name,b.name))
      .map(node=>{
        if(!node.children)return node;
        const inherited=node.name==='正文'?'desc':order;
        const childOrder=inherited&&Object.hasOwn(chapterOrders,node.path)?chapterOrders[node.path]:inherited;
        return {...node,chapterOrder:childOrder,children:sort(node.children,childOrder)};
      });
  }
  return sort(root);
}

export function compareChapterNames(a,b) {
  return ordinalSortKey(a).localeCompare(ordinalSortKey(b),'zh-CN',{numeric:true}) || a.localeCompare(b,'zh-CN',{numeric:true});
}

export function documentHeadings(body) {
  const headings=[];let offset=0,fence=null,previous=null;
  for(const raw of body.split('\n')) {
    const line=raw.replace(/\r$/,''),start=offset;offset+=raw.length+1;
    const marker=line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if(fence) {
      if(marker && marker[1][0]===fence.char && marker[1].length>=fence.length && !marker[2].trim()) fence=null;
      continue;
    }
    if(marker) {fence={char:marker[1][0],length:marker[1].length};previous=null;continue;}
    const atx=line.match(/^ {0,3}(#{1,6})(?:[\t ]+(.+?)|[\t ]*)$/);
    if(atx) {
      const text=(atx[2] || '').replace(/[\t ]+#+[\t ]*$/,'').trim();
      if(text) headings.push({text,level:atx[1].length,start,end:start+line.length});
      previous=null;continue;
    }
    if(previous && /^ {0,3}(=+|-+)[\t ]*$/.test(line)) {
      headings.push({...previous,level:line.trim()[0]==='='?1:2});previous=null;continue;
    }
    previous=line.trim() && !/^(?: {4}|\t| {0,3}(?:>|[-+*][\t ]|\d+[.)][\t ]))/.test(line) ? {text:line.trim(),start,end:start+line.length}:null;
  }
  return headings;
}

export function attachSidebar({onOpen,onDelete,onCreate,onCreateVolume,onOrder,onRename,onRenameFolder,onSelectFolder}) {
  const $=id=>document.getElementById(id),openFolders=new Set();
  let currentPath='';
  const fileStem=name=>name.replace(/\.(md|txt)$/i,'');
  function startRename(row,button,node) {
    if(typeof onRename!=='function') return;
    const input=document.createElement('input');
    input.type='text';input.className='file-rename-input';input.maxLength=80;
    input.value=fileStem(node.name);input.title='回车确认，Esc 取消';
    input.setAttribute('aria-label',`重命名 ${node.name}`);
    row.replaceChild(input,button);input.focus();input.select();
    let settled=false;
    const restore=()=>{if(input.isConnected)row.replaceChild(button,input);};
    const commit=async()=>{
      if(settled)return;settled=true;
      const next=input.value.trim();
      if(!next || next===fileStem(node.name)){restore();return;}
      try {await onRename(node.path,next);}
      catch(error){if(input.isConnected){input.focus();input.select();}else restore();}
    };
    input.addEventListener('keydown',event=>{
      event.stopPropagation();
      if(event.key==='Enter'){event.preventDefault();commit();}
      else if(event.key==='Escape'){event.preventDefault();settled=true;restore();button.focus();}
    });
    input.addEventListener('blur',()=>{commit();});
    input.addEventListener('click',event=>event.stopPropagation());
    input.addEventListener('dblclick',event=>event.stopPropagation());
  }
  function startFolderRename(summary,label,node) {
    if(typeof onRenameFolder!=='function') return;
    const input=document.createElement('input');
    input.type='text';input.className='folder-rename-input';input.maxLength=80;
    input.value=node.name;input.title='回车确认，Esc 取消';
    input.setAttribute('aria-label',`重命名文件夹 ${node.name}`);
    summary.replaceChild(input,label);input.focus();input.select();
    let settled=false;
    const restore=()=>{if(input.isConnected)summary.replaceChild(label,input);};
    const commit=async()=>{
      if(settled)return;settled=true;
      const next=input.value.trim();
      if(!next || next===node.name){restore();return;}
      try {await onRenameFolder(node.path,next);}
      catch(error){if(input.isConnected){input.focus();input.select();}else restore();}
    };
    input.addEventListener('pointerdown',event=>event.stopPropagation());
    input.addEventListener('click',event=>event.stopPropagation());
    input.addEventListener('keydown',event=>{
      event.stopPropagation();
      if(event.key==='Enter'){event.preventDefault();commit();}
      else if(event.key==='Escape'){event.preventDefault();settled=true;restore();summary.focus();}
    });
    input.addEventListener('blur',()=>commit());
  }
  const menu=$('file-menu');
  let menuTarget=null;
  function closeFileMenu() {if(menu)menu.hidden=true;menuTarget=null;}
  function showFileMenu(x,y,target) {
    if(!menu) return;
    menuTarget=target;
    const folder=target.kind==='folder';
    for(const button of menu.querySelectorAll('button[data-action]')) {
      const action=button.dataset.action;
      if(action==='asc'||action==='desc'){
        button.hidden=!target.order;
        button.setAttribute('aria-checked',String(target.order===action));
        continue;
      }
      button.hidden=folder ? !['rename','create'].includes(action) : !['open','rename','delete'].includes(action);
      if(action==='create')button.textContent=target.volumeRoot?'在此新建卷':'在此新建文稿';
    }
    menu.hidden=false;menu.style.left='0px';menu.style.top='0px';
    const bounds=menu.getBoundingClientRect();
    menu.style.left=Math.max(8,Math.min(x,innerWidth-bounds.width-8))+'px';
    menu.style.top=Math.max(8,Math.min(y,innerHeight-bounds.height-8))+'px';
    menu.querySelector('button[data-action]:not([hidden])')?.focus({preventScroll:true});
  }
  if(menu) {
    menu.addEventListener('click',event=>{
      const button=event.target.closest('button[data-action]');
      if(!button || !menuTarget) return;
      const target=menuTarget,action=button.dataset.action;
      closeFileMenu();
      if(action==='open')onOpen(target.path);
      else if(action==='rename')target.rename();
      else if(action==='create')(target.volumeRoot?onCreateVolume:onCreate)(target.path);
      else if(action==='delete')onDelete(target.path);
      else if(action==='asc'||action==='desc')onOrder(target.sortPath,action);
    });
    menu.addEventListener('keydown',event=>{
      if(!['ArrowDown','ArrowUp','Home','End'].includes(event.key)) return;
      event.preventDefault();
      const items=[...menu.querySelectorAll('button[data-action]:not([hidden])')];
      if(!items.length)return;
      const index=items.indexOf(document.activeElement);
      const next=event.key==='ArrowDown'?(index+1)%items.length:event.key==='ArrowUp'?(index-1+items.length)%items.length:event.key==='Home'?0:items.length-1;
      items[next]?.focus();
    });
    document.addEventListener('pointerdown',event=>{if(!menu.hidden && !menu.contains(event.target))closeFileMenu();},true);
    document.addEventListener('scroll',closeFileMenu,true);
    window.addEventListener('resize',closeFileMenu);
    document.addEventListener('keydown',event=>{if(event.key==='Escape' && !menu.hidden)closeFileMenu();});
  }
  function scrollToCurrent() {
    const list=$('file-list');
    if(!list || list.clientHeight<=0) return;
    const active=list.querySelector('.file-entry[aria-current="true"]');
    if(!active) return;
    const row=active.getBoundingClientRect(),view=list.getBoundingClientRect();
    if(row.top<view.top)list.scrollTop-=view.top-row.top;
    else if(row.bottom>view.bottom)list.scrollTop+=row.bottom-view.bottom;
  }
  function updateFileBadges(unreadFiles,pendingFiles) {
    for(const button of $('file-list').querySelectorAll('.file-entry[data-path]')){
      const path=button.dataset.path;
      const reasons=[];
      if(pendingFiles.has(path))reasons.push('有待采纳改稿');
      if(unreadFiles.has(path))reasons.push('有未查看的外部改动');
      button.classList.toggle('file-entry-unread',reasons.length>0);
      button.title=[path,'右键重命名（F2）',...reasons].join('\n');
      if(reasons.length)button.setAttribute('aria-label',[button.textContent,...reasons].join('，'));
      else button.removeAttribute('aria-label');
    }
  }
  function renderFiles(files,path,directories=[],unreadFiles=new Set(),pendingFiles=new Set(),wordTotals={},chapterOrders={}) {
    const changed=path!==currentPath;currentPath=path;
    const list=$('file-list');list.replaceChildren();
    function append(nodes,parent,chapterFolder=null) {
      for(const node of nodes) {
        if(node.children) {
          const folder=document.createElement('details');folder.className='file-folder';folder.dataset.path=node.path;
          if(changed && path.startsWith(node.path+'/'))openFolders.add(node.path);
          folder.open=openFolders.has(node.path);
          const heading=document.createElement('summary');heading.title=node.path+'\n右键重命名（F2）';
          const label=document.createElement('span');label.className='folder-name';label.textContent=node.name;heading.append(label);
          if(Object.hasOwn(wordTotals,node.path)){
            const words=wordTotals[node.path],total=document.createElement('span');total.className='folder-word-total';
            total.textContent=words===null?'— 字':words.toLocaleString('zh-CN')+' 字';
            total.title=words===null?'部分正文无法读取，暂不能统计总字数':'正文总字数：'+total.textContent;
            total.setAttribute('aria-label',total.title);heading.append(total);
          }
          heading.addEventListener('click',()=>onSelectFolder(node.path));
          const volumeRoot=node.name==='正文'&&node.path.split('/').length===2;
          heading.addEventListener('contextmenu',event=>{
            event.preventDefault();closeFileMenu();
            showFileMenu(event.clientX,event.clientY,{kind:'folder',path:node.path,volumeRoot,sortPath:node.path,order:node.chapterOrder,rename:()=>startFolderRename(heading,label,node)});
          });
          heading.addEventListener('keydown',event=>{if(event.key==='F2'){event.preventDefault();startFolderRename(heading,label,node);}});
          const create=document.createElement('button');create.type='button';create.className='folder-create icon-button';create.textContent='＋';
          const createLabel=volumeRoot?'新建卷':'新建文稿';
          create.title=createLabel;create.setAttribute('aria-label',`在 ${node.path} ${createLabel}`);
          create.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();(volumeRoot?onCreateVolume:onCreate)(node.path);});
          const children=document.createElement('div');children.className='folder-children';
          // Keep summary as the first child for native disclosure and keyboard support.
          heading.append(create);folder.append(heading,children);parent.append(folder);append(node.children,children,node.chapterOrder?node:null);
          folder.addEventListener('toggle',()=>{if(folder.isConnected){if(folder.open)openFolders.add(node.path);else openFolders.delete(node.path);}});
        } else {
          const row=document.createElement('div');row.className='file-row';
          const button=document.createElement('button');button.type='button';button.className='file-entry';button.textContent=node.name;button.title=node.path+'\n右键重命名（F2）';button.setAttribute('aria-current',String(node.path===path));
          button.dataset.path=node.path;
          button.addEventListener('click',()=>onOpen(node.path));
          button.addEventListener('contextmenu',event=>{
            event.preventDefault();closeFileMenu();
            showFileMenu(event.clientX,event.clientY,{kind:'file',path:node.path,sortPath:chapterFolder?.path,order:chapterFolder?.chapterOrder,rename:()=>startRename(row,button,node)});
          });
          button.addEventListener('keydown',event=>{if(event.key==='F2'){event.preventDefault();startRename(row,button,node);}});
          const remove=document.createElement('button');remove.type='button';remove.className='file-delete icon-button';remove.setAttribute('aria-label',`删除 ${node.name}`);remove.title='移至回收站';
          remove.innerHTML='<svg viewBox="0 0 20 20" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true"><path d="M3.5 5.5h13M7 5.5V3h6v2.5M5 5.5l.7 11h8.6l.7-11M8 8v6m4-6v6"/></svg>';
          remove.addEventListener('click',()=>onDelete(node.path));row.append(button,remove);parent.append(row);
        }
      }
    }
    append(fileTree(files,directories,chapterOrders),list);
    updateFileBadges(unreadFiles,pendingFiles);
    if(changed) scrollToCurrent();
    $('files-status').textContent=files.length ? '' : '暂无文稿，可在文件夹旁点击 ＋ 新建。';
    $('files-status').hidden=Boolean(files.length);
  }
  /** 打开作品时展开对应文件夹，避免它此前被手动收起后仍保持折叠。 */
  function reveal(folderPath) {if(typeof folderPath==='string' && folderPath)openFolders.add(folderPath);}
  function initSidebarResize() {
    const shell=document.querySelector('.workspace-shell'),pane=$('workbench-sidebar'),handle=$('sidebar-resizer');
    if(!shell || !pane || !handle) return;
    const root=document.documentElement,panel=$('stats-float'),media=$('stats-media');
    const cover=$('stats-cover-block'),petImage=$('stats-pet-image'),statsPanel=panel.querySelector('.stats-panel');
    const KEY='writer-workbench:sidebar-width',MIN=220,STEP=16;
    let limit=248,gutter=0;
    let stored=0;
    try {const value=Number(localStorage.getItem(KEY));if(Number.isFinite(value)&&value>=MIN)stored=value;} catch {}
    const paneWidth=()=>pane.getBoundingClientRect().width || MIN;
    const sum=(style,...keys)=>keys.reduce((total,key)=>total+(parseFloat(style[key])||0),0);
    function updateLimit() {
      if(!panel.classList.contains('is-detached')){
        const frame=getComputedStyle(panel),sidebar=getComputedStyle(pane);
        const panelBorder=sum(frame,'borderLeftWidth','borderRightWidth');
        if(panel.offsetWidth)gutter=Math.max(0,panel.offsetWidth-panel.clientWidth-panelBorder);
        const width=statsMediaWidth(cover,petImage,media)+gutter+panelBorder
          + sum(frame,'marginLeft','marginRight')
          + sum(getComputedStyle(statsPanel),'paddingLeft','paddingRight')
          + sum(sidebar,'borderLeftWidth','borderRightWidth');
        if(Number.isFinite(width))limit=Math.max(MIN,Math.min(Math.ceil(width),shell.clientWidth?shell.clientWidth-360:Infinity));
      }
      const cssLimit=limit+'px';
      if(root.style.getPropertyValue('--wb-sidebar-limit')!==cssLimit)root.style.setProperty('--wb-sidebar-limit',cssLimit);
      handle.setAttribute('aria-valuemax',String(limit));
      handle.setAttribute('aria-valuenow',String(Math.min(limit,Math.round(paneWidth()))));
    }
    const clampWidth=value=>Math.round(Math.max(MIN,Math.min(limit,value)));
    // 侧栏放到正文右边时，分隔条在左侧，向左拖才是变宽。
    const onRight=()=>document.body.dataset.sidebarSide==='right';
    // 同步到根元素，工作台外框（#writing-desk）按「侧栏 + 正文宽度」计算最大宽度。
    const apply=value=>{const width=clampWidth(value);root.style.setProperty('--wb-sidebar-width',width+'px');handle.setAttribute('aria-valuenow',String(width));return width;};
    const remember=value=>{try {localStorage.setItem(KEY,String(value));} catch {}};
    if(stored)root.style.setProperty('--wb-sidebar-width',Math.round(stored)+'px');
    updateLimit();
    let drag=null;
    handle.addEventListener('pointerdown',event=>{
      if(event.button!==0)return;
      event.preventDefault();
      drag={id:event.pointerId,startX:event.clientX,startWidth:paneWidth()};
      shell.classList.add('is-resizing');
      try {handle.setPointerCapture(event.pointerId);} catch {}
      handle.focus({preventScroll:true});
    });
    handle.addEventListener('pointermove',event=>{
      if(!drag || event.pointerId!==drag.id)return;
      apply(drag.startWidth+(onRight()?drag.startX-event.clientX:event.clientX-drag.startX));
    });
    const endDrag=event=>{
      if(!drag || event.pointerId!==drag.id)return;
      drag=null;shell.classList.remove('is-resizing');
      try {if(handle.hasPointerCapture(event.pointerId))handle.releasePointerCapture(event.pointerId);} catch {}
      remember(clampWidth(paneWidth()));
    };
    handle.addEventListener('pointerup',endDrag);
    handle.addEventListener('pointercancel',endDrag);
    handle.addEventListener('dblclick',()=>{root.style.removeProperty('--wb-sidebar-width');try {localStorage.removeItem(KEY);} catch {}updateLimit();});
    handle.addEventListener('keydown',event=>{
      if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
      event.preventDefault();
      const delta=event.key==='ArrowLeft'?-STEP:STEP;
      const next=event.key==='Home'?MIN:event.key==='End'?limit:paneWidth()+(onRight()?-delta:delta);
      remember(apply(next));
    });
    window.addEventListener('resize',updateLimit);
    document.addEventListener('workbench:stats-layout',updateLimit);
    const observer=new ResizeObserver(updateLimit);
    observer.observe(pane);
    observer.observe($('stats-content'));
  }
  initSidebarResize();
  const compactFilesToggle=$('compact-files-toggle');
  const narrow=matchMedia('(max-width:780px)');
  function setCompactFiles(open){
    compactFilesToggle.setAttribute('aria-expanded',String(open));
    document.body.classList.toggle('compact-files-open',open);
  }
  compactFilesToggle.addEventListener('click',()=>{
    setCompactFiles(compactFilesToggle.getAttribute('aria-expanded')==='false');
  });
  document.addEventListener('workbench:documentchange',()=>setCompactFiles(false));
  narrow.addEventListener('change',()=>setCompactFiles(false));
  document.addEventListener('keydown',event=>{
    if(event.key==='Escape'&&!event.defaultPrevented&&!event.isComposing&&compactFilesToggle.offsetWidth&&document.body.classList.contains('compact-files-open')&&!document.querySelector('dialog[open]')){
      event.preventDefault();
      setCompactFiles(false);
      compactFilesToggle.focus({preventScroll:true});
    }
  });
  return {renderFiles,updateFileBadges,reveal,scrollToCurrent};
}
