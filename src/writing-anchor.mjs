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

export function writingRequestMessage(item) {
  return {
    role:'user',
    content:[{type:'text',text:`【码字工作台 · AI 插入请求】\n文稿：${item.path || item.title+'（草稿）'}\n\n写作要求：\n${item.instruction}`}],
    _meta:{'openai/message':{target:'active',send:true}},
  };
}
