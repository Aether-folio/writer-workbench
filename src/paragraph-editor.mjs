// Keep the plain-text storage and selection API while spacing paragraph blocks.
export function attachParagraphEditor(editor) {
  const blocks=new Set(['DIV','P']);
  let locked=false,cachedStart=0,cachedEnd=0,historyBase='',canRedo=false,modelCache=null,history=[''],historyIndex=0,historyTime=0,restoring=false;
  const invalidate=()=>{modelCache=null;};
  const decoration=node=>node?.nodeType===Node.ELEMENT_NODE && node.hasAttribute('data-editor-decoration');
  const decorationOf=node=>(node?.nodeType===Node.ELEMENT_NODE?node:node?.parentElement)?.closest('[data-editor-decoration]');
  const inDecoration=node=>{const owner=decorationOf(node);return Boolean(owner&&editor.contains(owner));};
  function updateLayout(){const first=[...editor.childNodes].find(node=>!decoration(node));editor.dataset.inlineStart=String(Boolean(first && !blocks.has(first.nodeName)));}
  function model() {
    if(modelCache)return modelCache;
    const segments=[];
    const add=(text,node,offset=0)=>{if(text)segments.push({text,node,offset});};
    function visit(parent) {
      const all=[...parent.childNodes],indices=new Map(all.map((node,index)=>[node,index]));
      const children=all.filter(node=>!decoration(node));
      children.forEach((child,index)=>{
        const previous=children[index-1];
        const domIndex=indices.get(child);
        if(index && !child.dataset?.modelJoin && (blocks.has(child.nodeName) || blocks.has(previous.nodeName)))add('\n',parent,domIndex);
        if(child.nodeType===Node.ELEMENT_NODE && child.hasAttribute('data-editor-original'))add(child.dataset.editorOriginal,child);
        else if(child.nodeType===Node.TEXT_NODE)add(child.data,child);
        else if(child.nodeName==='BR') {
          // Chromium keeps a final BR as a caret placeholder in empty blocks.
          if(children.length>1 && index<children.length-1)add('\n',parent,domIndex+1);
        } else visit(child);
      });
    }
    visit(editor);return modelCache=segments;
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
      if(segment.text==='\n'&&offset===total+1&&!segment.node.hasAttribute?.('data-editor-original')){const next=segment.node.childNodes[segment.offset];if(next&&!decoration(next))return [next,0];return [segment.node,segment.offset];}
      if(offset<total+segment.text.length)return segment.node.hasAttribute?.('data-editor-original')?[segment.node.parentNode,[...segment.node.parentNode.childNodes].indexOf(segment.node)]:[segment.node,segment.offset];
      total+=segment.text.length;
    }
    const last=[...editor.childNodes].filter(node=>!decoration(node)).at(-1);
    return last ? [last,last.nodeType===Node.TEXT_NODE?last.data.length:last.childNodes.length] : [editor,0];
  }
  editor.setSelectionRange=(start,end=start,updateDOM=true)=>{
    const segments=model(),length=segments.reduce((sum,segment)=>sum+segment.text.length,0);
    cachedStart=Math.max(0,Math.min(start,length));cachedEnd=Math.max(cachedStart,Math.min(end,length));
    if(!updateDOM)return;
    const range=document.createRange();range.setStart(...locate(cachedStart,segments));range.setEnd(...locate(cachedEnd,segments));
    const selection=getSelection();selection.removeAllRanges();selection.addRange(range);
  };
  editor.select=()=>editor.setSelectionRange(0,text().length);
  editor.replaceRanges=(ranges,replacement)=>{
    if(locked) throw new Error('文稿暂时无法编辑。');
    const source=text(), inserted=replacement.replace(/\r\n?/g,'\n');
    const parts=[];
    let offset=0, caret=0;
    for(const {start,end} of ranges){
      const prefix=source.slice(offset,start);
      parts.push(prefix,inserted);
      caret+=prefix.length+inserted.length;
      offset=end;
    }
    const updated=parts.join('')+source.slice(offset);
    if(updated===source) return caret;
    const savedHistory=history, savedIndex=historyIndex, scroll=editor.scrollTop;
    restoring=true;
    try{editor.value=updated;}
    finally{restoring=false;history=savedHistory;historyIndex=savedIndex;}
    editor.focus({preventScroll:true});
    editor.setSelectionRange(caret);
    editor.scrollTop=scroll;
    editor.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertReplacementText'}));
    document.dispatchEvent(new CustomEvent('workbench:source-rebuilt'));
    return caret;
  };
  editor.highlightRanges=(name,ranges)=>{
    if(!globalThis.CSS?.highlights||!globalThis.Highlight)return;
    CSS.highlights.delete(name);
    if(!ranges.length)return;
    const highlight=new Highlight();
    const sorted=[...ranges].sort((a,b)=>a.start-b.start);
    let offset=0,index=0;
    for(const segment of model()){
      const end=offset+segment.text.length;
      while(index<sorted.length && sorted[index].end<=offset)index++;
      if(segment.node.nodeType===Node.TEXT_NODE){
        for(let i=index;i<sorted.length && sorted[i].start<end;i++){
          const range=document.createRange();
          range.setStart(segment.node,Math.max(sorted[i].start-offset,0));
          range.setEnd(segment.node,Math.min(sorted[i].end,end)-offset);
          highlight.add(range);
        }
      }
      offset=end;
    }
    if(highlight.size)CSS.highlights.set(name,highlight);
  };
  editor.highlightRange=(start,end)=>{if(!globalThis.CSS?.highlights||!globalThis.Highlight)return;CSS.highlights.delete('pen-note-target');if(start===undefined||start===end)return;const range=document.createRange(),segments=model();range.setStart(...locate(start,segments));range.setEnd(...locate(end,segments));CSS.highlights.set('pen-note-target',new Highlight(range));};
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
    invalidate();updateLayout();
  };
  editor.previewRange=(element,start,end)=>{
    if(end===start){editor.placeDecoration(element,start);return;}
    const original=text().slice(start,end),segments=model(),range=document.createRange();range.setStart(...locate(start,segments));range.setEnd(...locate(end,segments));
    const block=node=>{let element=node.nodeType===Node.ELEMENT_NODE?node:node.parentElement;while(element?.parentElement!==editor&&element!==editor)element=element?.parentElement;return element===editor?null:element;};
    const from=range.startContainer===editor?editor.childNodes[range.startOffset-1]:block(range.startContainer),to=range.endContainer===editor?editor.childNodes[range.endOffset]:block(range.endContainer),wrapper=document.createElement('span');
    wrapper.dataset.editorOriginal=original;wrapper.dataset.modelJoin='true';wrapper.contentEditable='false';wrapper.hidden=true;wrapper.append(range.extractContents());range.insertNode(wrapper);
    element.dataset.editorDecoration='true';element.contentEditable='false';wrapper.after(element);
    if(to&&from!==to&&to.isConnected){to.dataset.modelJoin='true';to.classList.add('pen-source-tail');if(from?.nodeType===Node.ELEMENT_NODE)from.classList.add('pen-source-start');}
    invalidate();updateLayout();
  };
  editor.rebuildSource=()=>{const value=text(),start=cachedStart,end=cachedEnd,scroll=editor.scrollTop,savedHistory=history,savedIndex=historyIndex;restoring=true;editor.value=value;history=savedHistory;historyIndex=savedIndex;restoring=false;editor.setSelectionRange(start,end);editor.scrollTop=scroll;};
  editor.isDecorationEvent=event=>inDecoration(event.target);
  editor.hasProtectedRange=(start,end)=>{let offset=0;for(const segment of model()){if(segment.node.hasAttribute?.('data-editor-original')&&Math.max(start,offset)<Math.min(end,offset+segment.text.length))return true;offset+=segment.text.length;}return false;};
  Object.defineProperties(editor,{
    value:{get:text,set(value){
      invalidate();
      const fragment=document.createDocumentFragment();
      for(const line of String(value).replace(/\r\n?/g,'\n').split('\n')) {
        const paragraph=document.createElement('div');
        if(line)paragraph.textContent=line;else paragraph.append(document.createElement('br'));
        fragment.append(paragraph);
      }
      editor.replaceChildren(fragment);invalidate();cachedStart=cachedEnd=0;historyBase=text();canRedo=false;if(!restoring){history=[historyBase];historyIndex=0;}updateLayout();
    }},
    selectionStart:{get(){captureSelection();return cachedStart;}},
    selectionEnd:{get(){captureSelection();return cachedEnd;}},
    readOnly:{get:()=>locked,set(value){locked=Boolean(value);editor.contentEditable=locked?'false':'true';editor.setAttribute('aria-readonly',String(locked));}},
  });
  editor.scrollSelectionIntoView=()=>{
    const selection=getSelection();if(!selection?.rangeCount)return;
    const range=selection.getRangeAt(0),bounds=range.getBoundingClientRect(),viewport=editor.getBoundingClientRect();
    if(bounds.top<viewport.top+28)editor.scrollTop-=viewport.top+28-bounds.top;
    else if(bounds.bottom>viewport.bottom-28)editor.scrollTop+=bounds.bottom-viewport.bottom+28;
  };
  editor.addEventListener('beforeinput',event=>{
    if(inDecoration(event.target))return;
    if(locked || ['formatBold','formatItalic','formatUnderline','insertOrderedList','insertUnorderedList','insertLink'].includes(event.inputType))event.preventDefault();
    invalidate();
    if(event.inputType==='historyUndo'||event.inputType==='historyRedo'){event.preventDefault();restoreHistory(event.inputType==='historyUndo'?-1:1);return;}
    const selection=getSelection();if(selection?.rangeCount){const range=selection.getRangeAt(0);if([...editor.querySelectorAll('[data-editor-original]')].some(node=>range.intersectsNode(node))){event.preventDefault();document.dispatchEvent(new CustomEvent('workbench:protected-range'));}}
  });
  function restoreHistory(direction){const index=historyIndex+direction;if(locked||index<0||index>=history.length)return;const saved=history;historyIndex=index;const position=Math.min(cachedStart,saved[index].length);restoring=true;editor.value=saved[index];history=saved;historyIndex=index;editor.setSelectionRange(position);editor.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:direction<0?'historyUndo':'historyRedo'}));restoring=false;if(!decorationOf(editor))document.dispatchEvent(new CustomEvent('workbench:source-rebuilt'));}
  editor.addEventListener('keydown',event=>{
    if(inDecoration(event.target))return;
    if(decorationOf(editor)&&!event.isComposing&&['Home','End'].includes(event.key)){
      const selection=getSelection();
      if(!selection?.rangeCount||!editor.contains(selection.anchorNode)||!editor.contains(selection.focusNode))return;
      event.preventDefault();
      const toEnd=event.key==='End';
      const {anchorNode,anchorOffset}=selection;
      // The visual line can start before the suggestion. Keep its caret inside the editable text.
      if(!event.ctrlKey&&!event.metaKey){
        selection.modify(event.shiftKey?'extend':'move',toEnd?'forward':'backward','lineboundary');
        if(editor.contains(selection.focusNode))return;
      }
      const [node,offset]=locate(toEnd?text().length:0,model());
      editor.focus({preventScroll:true});
      if(event.shiftKey)selection.setBaseAndExtent(anchorNode,anchorOffset,node,offset);
      else selection.collapse(node,offset);
      return;
    }
    if((event.ctrlKey || event.metaKey) && ['b','i','u'].includes(event.key.toLowerCase()))event.preventDefault();
    if((event.ctrlKey||event.metaKey)&&['z','y'].includes(event.key.toLowerCase())){event.preventDefault();restoreHistory(event.key.toLowerCase()==='y'||event.shiftKey?1:-1);}
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
  editor.addEventListener('input',event=>{invalidate();updateLayout();if(restoring)return;const value=text();if(value===history[historyIndex])return;history=history.slice(0,historyIndex+1);const now=performance.now();if(event.inputType==='insertText'&&history.length>1&&historyTime&&now-historyTime<600)history[historyIndex]=value;else{history.push(value);historyIndex++;}historyTime=event.inputType==='insertText'?now:0;while(history.length>120||history.reduce((n,v)=>n+v.length,0)>16000000&&history.length>2){history.shift();historyIndex--;} });
  editor.addEventListener('input',event=>{canRedo=event.inputType==='historyUndo' || event.inputType==='historyRedo';});
  const observer=new MutationObserver(invalidate);observer.observe(editor,{subtree:true,childList:true,characterData:true});
  document.addEventListener('selectionchange',captureSelection);
  editor.disposeParagraphEditor=()=>{observer.disconnect();document.removeEventListener('selectionchange',captureSelection);};
  editor.value='';return editor;
}
