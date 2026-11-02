export function countWords(value) {
  const body = value.replace(/^#{1,6}[ \t]+.*$/gm, '');
  return (body.match(/[\p{L}\p{N}]/gu) || []).length;
}

export function draftMessage(text, title = '未命名草稿') {
  if (typeof text !== 'string' || !text.trim()) throw new Error('请先选中文字。');
  if (text.length > 24000) throw new Error('本次选区过长，请分段引用。');
  return {
    role: 'user',
    content: [{type:'text', text:`【${title} · 正文选区】\n${text.split('\n').map(line => '> ' + line).join('\n')}\n`}],
    _meta: {'openai/message': {target:'active', send:false}},
  };
}

export function annotationBatchMessage(annotations) {
  if(!Array.isArray(annotations) || !annotations.length)throw new Error('暂无批注，请先添加批注。');
  for(const annotation of annotations) {
    if(!annotation || typeof annotation.quote!=='string' || !annotation.quote.trim() || typeof annotation.body!=='string' || !annotation.body.trim())throw new Error('批注内容不完整，请重新读取后再试。');
  }
  const groups=new Map();
  for(const annotation of [...annotations].sort((a,b)=>(b.updatedAt || '').localeCompare(a.updatedAt || ''))) {
    const source=annotation.path || (annotation.title || '未命名草稿')+'（草稿）';
    const key=JSON.stringify([annotation.path || '',annotation.path ? '' : annotation.title || '未命名草稿']);
    if(!groups.has(key))groups.set(key,{source,items:[]});
    groups.get(key).items.push(annotation);
  }
  let index=0;
  const sections=[...groups.values()].map(({source,items})=>`文稿：${source}\n\n`+items.map(annotation=>`批注 ${++index}\n原文快照：\n${annotation.quote.split('\n').map(line=>'> '+line).join('\n')}\n\n批注内容：\n${annotation.body}`).join('\n\n'));
  return {
    role:'user',
    content:[{type:'text',text:`\n\n【批注汇总 · 共 ${annotations.length} 条】\n\n${sections.join('\n\n────────\n\n')}\n`}],
    _meta:{'openai/message':{target:'active',send:false}},
  };
}

export class WritingClock {
  constructor(idleThreshold = 5000) {
    this.idleThreshold = idleThreshold;
    this.activeMs = 0;
    this.idleMs = 0;
    this.running = false;
    this.started = false;
    this.lastInput = 0;
    this.lastTick = 0;
  }
  advance(now) {
    if (!this.running || now < this.lastTick) return;
    const elapsed = now - this.lastTick;
    const active = Math.max(0, Math.min(now, this.lastInput + this.idleThreshold) - this.lastTick);
    this.activeMs += active;
    this.idleMs += elapsed - active;
    this.lastTick = now;
  }
  input(now) {
    this.advance(now);
    this.started = this.running = true;
    this.lastInput = this.lastTick = now;
  }
  pause(now) { this.advance(now); this.running = false; }
}

export function formatTime(milliseconds) {
  const total = Math.floor(milliseconds / 1000);
  return [Math.floor(total / 3600), Math.floor(total % 3600 / 60), total % 60]
    .map(value => String(value).padStart(2, '0')).join(':');
}
