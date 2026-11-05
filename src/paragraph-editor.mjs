// Keep the plain-text storage and selection API while spacing paragraph blocks.
export function attachParagraphEditor(editor) {
  const blocks=new Set(['DIV','P']);
  let locked=false,cachedStart=0,cachedEnd=0,historyBase='',canRedo=false;
  const decoration=node=>node?.nodeType===Node.ELEMENT_NODE && node.hasAttribute('data-editor-decoration');
  const inDecoration=node=>Boolean((node?.nodeType===Node.ELEMENT_NODE?node:node?.parentElement)?.closest('[data-editor-decoration]'));
  function updateLayout(){const first=[...editor.childNodes].find(node=>!decoration(node));editor.dataset.inlineStart=String(Boolean(first && !blocks.has(first.nodeName)));}
  function model() {
    const segments=[];
    const add=(text,node,offset=0)=>{if(text)segments.push({text,node,offset});};
    function visit(parent) {
      const all=[...parent.childNodes],indices=new Map(all.map((node,index)=>[node,index]));
      const children=all.filter(node=>!decoration(node));
      children.forEach((child,index)=>{
        const previous=children[index-1];
        const domIndex=indices.get(child);
        if(index && (blocks.has(child.nodeName) || blocks.has(previous.nodeName)))add('\n',parent,domIndex);
        if(child.nodeType===Node.TEXT_NODE)add(child.data,child);
        else if(child.nodeName==='BR') {
          // Chromium keeps a final BR as a caret placeholder in empty blocks.
          if(children.length>1 && index<children.length-1)add('\n',parent,domIndex+1);
        } else visit(child);
      });
    }
    visit(editor);return segments;
  }
  const text=()=>model().map(segment=>segment.text).join('');
  function pointOffset(node,offset,segments) {
    const point=document.createRange();point.setStart(node,offset);point.collapse(true);
    let total=0;
    for(const segment of segments) {
      if(node===segment.node && node.nodeType===Node.TEXT_NODE)return total+Math.min(offset,segment.text.length);
      const start=document.createRange();start.setStart(segment.node,segment.offset);start.collapse(true);
      if(point.compareBoundaryPoints(Range.START_TO_START,start)<0)return total;
      total+=segment.text.length;
    }
    return total;
  }
  function captureSelection() {
    // Moving focus to a context-menu button may restore Chromium's old caret.
    // Keep the insertion bookmark captured while this editor held focus.
    if(document.activeElement!==editor)return;
    const selection=getSelection();
    if(!selection?.rangeCount || !editor.contains(selection.anchorNode) || !editor.contains(selection.focusNode))return;
    if(inDecoration(selection.anchorNode) || inDecoration(selection.focusNode))return;
    const segments=model();
    const anchor=pointOffset(selection.anchorNode,selection.anchorOffset,segments);
    const focus=pointOffset(selection.focusNode,selection.focusOffset,segments);
    cachedStart=Math.min(anchor,focus);cachedEnd=Math.max(anchor,focus);
  }
  function locate(offset,segments) {
    let total=0;
    for(const segment of segments) {
      if(segment.node.nodeType===Node.TEXT_NODE && offset<=total+segment.text.length)return [segment.node,Math.max(0,offset-total)];
      if(offset<total+segment.text.length)return [segment.node,segment.offset];
      total+=segment.text.length;
    }
    const last=[...editor.childNodes].filter(node=>!decoration(node)).at(-1);
    return last ? [last,last.nodeType===Node.TEXT_NODE?last.data.length:last.childNodes.length] : [editor,0];
  }
  editor.setSelectionRange=(start,end=start)=>{
    const segments=model(),length=segments.reduce((sum,segment)=>sum+segment.text.length,0);
    cachedStart=Math.max(0,Math.min(start,length));cachedEnd=Math.max(cachedStart,Math.min(end,length));
    const range=document.createRange();range.setStart(...locate(cachedStart,segments));range.setEnd(...locate(cachedEnd,segments));
    const selection=getSelection();selection.removeAllRanges();selection.addRange(range);
  };
  editor.select=()=>editor.setSelectionRange(0,text().length);
  editor.setCaretFromPoint=(x,y)=>{
    const bounds=editor.getBoundingClientRect();
    if(x<bounds.left || x>bounds.right || y<bounds.top || y>bounds.bottom)return false;
    const position=document.caretPositionFromPoint?.(x,y);
    let range;
    if(position){range=document.createRange();range.setStart(position.offsetNode,position.offset);range.collapse(true);}
    else range=document.caretRangeFromPoint?.(x,y);
    if(!range || !editor.contains(range.startContainer) || inDecoration(range.startContainer))return false;
    editor.focus({preventScroll:true});
    const selection=getSelection();selection.removeAllRanges();selection.addRange(range);captureSelection();return true;
  };
  editor.placeDecoration=(element,offset)=>{
    element.dataset.editorDecoration='true';element.contentEditable='false';
    const range=document.createRange();range.setStart(...locate(offset,model()));range.collapse(true);range.insertNode(element);
    updateLayout();
  };
  editor.isDecorationEvent=event=>inDecoration(event.target);
  Object.defineProperties(editor,{
    value:{get:text,set(value){
      const fragment=document.createDocumentFragment();
      for(const line of String(value).replace(/\r\n?/g,'\n').split('\n')) {
        const paragraph=document.createElement('div');
        if(line)paragraph.textContent=line;else paragraph.append(document.createElement('br'));
        fragment.append(paragraph);
      }
      editor.replaceChildren(fragment);cachedStart=cachedEnd=0;historyBase=text();canRedo=false;updateLayout();
    }},
    selectionStart:{get(){captureSelection();return cachedStart;}},
    selectionEnd:{get(){captureSelection();return cachedEnd;}},
    readOnly:{get:()=>locked,set(value){locked=Boolean(value);editor.contentEditable=locked?'false':'true';editor.setAttribute('aria-readonly',String(locked));}},
  });
  editor.scrollSelectionIntoView=()=>{
    const selection=getSelection();if(!selection?.rangeCount)return;
    const range=selection.getRangeAt(0),bounds=range.getBoundingClientRect(),viewport=editor.getBoundingClientRect();
    editor.scrollTop+=bounds.top-viewport.top-28;
  };
  editor.addEventListener('beforeinput',event=>{
    if(inDecoration(event.target))return;
    if(locked || ['formatBold','formatItalic','formatUnderline','insertOrderedList','insertUnorderedList','insertLink'].includes(event.inputType))event.preventDefault();
    if(event.inputType==='historyUndo' && text()===historyBase || event.inputType==='historyRedo' && !canRedo)event.preventDefault();
  });
  editor.addEventListener('keydown',event=>{
    if(inDecoration(event.target))return;
    if((event.ctrlKey || event.metaKey) && ['b','i','u'].includes(event.key.toLowerCase()))event.preventDefault();
  });
  editor.addEventListener('paste',event=>{
    if(inDecoration(event.target))return;
    event.preventDefault();if(locked)return;
    const value=event.clipboardData?.getData('text/plain');if(value===undefined)return;
    const escaped=value.replace(/\r\n?/g,'\n').split('\n').map(line=>{
      const div=document.createElement('div');div.textContent=line;return div.innerHTML || '<br>';
    });
    // Native insertion preserves the browser undo history and caret position.
    document.execCommand('insertHTML',false,escaped.map(line=>`<div>${line}</div>`).join(''));
  });
  editor.addEventListener('drop',event=>event.preventDefault());
  editor.addEventListener('copy',event=>{
    if(inDecoration(event.target) || !event.clipboardData)return;
    captureSelection();
    if(cachedStart===cachedEnd)return;
    event.clipboardData.setData('text/plain',text().slice(cachedStart,cachedEnd));event.preventDefault();
  });
  editor.addEventListener('input',updateLayout);
  editor.addEventListener('input',event=>{canRedo=event.inputType==='historyUndo' || event.inputType==='historyRedo';});
  document.addEventListener('selectionchange',captureSelection);
  editor.disposeParagraphEditor=()=>document.removeEventListener('selectionchange',captureSelection);
  editor.value='';return editor;
}
