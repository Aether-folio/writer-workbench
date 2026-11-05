// Send through the session-scoped conversation service so existing composer
// drafts and attachments are never submitted along with a workbench request.
export async function deliverWorkbenchMessage({params,sessionId,sessions,conversation,focusComposer}) {
  const text=(Array.isArray(params?.content)?params.content:[])
    .filter(item=>item?.type==='text' && typeof item.text==='string').map(item=>item.text).join('\n');
  if(!text.trim())throw new Error('没有可发送的文字。');
  if(sessionId===undefined)throw new Error('没有活动的会话，请先打开一个对话。');
  const scope=sessions?.scope?.(sessionId);
  if(!scope)throw new Error('当前会话尚未就绪，请稍后再试。');
  const meta=params?._meta?.['openai/message'];
  if(meta?.send===true) {
    const scopedConversation=scope.get?.('conversation');
    if(typeof scopedConversation?.send!=='function')throw new Error('当前宿主未提供直接发送接口，请更新客户端后重试。');
    await scopedConversation.send(text);
    return;
  }
  const input=conversation?.input?.for?.(scope);
  if(!input)throw new Error('宿主没有提供聊天输入框。');
  const current=String(input.state?.getSnapshot?.().draft ?? '');
  input.setDraft(current.trim()===''?text:current.replace(/\s+$/,'')+'\n\n'+text);
  focusComposer?.();
}
