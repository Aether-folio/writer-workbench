// Offsets are UTF-16 offsets, matching the editor selection API.
// Rebase only when the original insertion boundary is still unambiguous.
export function rebaseWritingAnchor(before, after, offset) {
  if(before===after)return offset;
  let start=0,end=0;
  while(start<before.length && start<after.length && before[start]===after[start])start++;
  while(end<before.length-start && end<after.length-start && before[before.length-1-end]===after[after.length-1-end])end++;
  if(offset<=start)return offset;
  if(offset>=before.length-end)return offset+after.length-before.length;
  return null;
}

export function rebaseWritingRange(before,after,start,end=start) {
  if(start<0 || end<start || end>before.length)return null;
  if(before===after)return {start,end};
  let prefix=0,suffix=0;
  while(prefix<before.length && prefix<after.length && before[prefix]===after[prefix])prefix++;
  while(suffix<before.length-prefix && suffix<after.length-prefix && before.at(-suffix-1)===after.at(-suffix-1))suffix++;
  if(end<=prefix)return {start,end};
  if(start>=before.length-suffix){const shift=after.length-before.length;return {start:start+shift,end:end+shift};}
  const selected=before.slice(start,end),left=before.slice(Math.max(0,start-48),start),right=before.slice(end,end+48);
  const needle=left+selected+right;
  if(!needle)return null;
  const found=after.indexOf(needle);
  if(found<0 || after.indexOf(needle,found+1)>=0)return null;
  return {start:found+left.length,end:found+left.length+selected.length};
}

export function penMessage(items) {
  const parts=items.map(item=>`文稿：${item.path || item.title+'（草稿）'}\n\n我的要求：\n${item.instruction}`);
  return {role:'user',content:[{type:'text',text:`【递笔工作台 · 递笔】\n${parts.join('\n\n——\n\n')}`}],_meta:{'openai/message':{target:'active',send:true}}};
}

export function writingRequestMessage(item) {
  return {
    role:'user',
    content:[{type:'text',text:`【递笔工作台 · AI 插入请求】\n文稿：${item.path || item.title+'（草稿）'}\n\n写作要求：\n${item.instruction}`}],
    _meta:{'openai/message':{target:'active',send:true}},
  };
}
