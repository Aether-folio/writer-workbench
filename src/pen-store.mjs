import {readFile,readdir,lstat,rename} from 'node:fs/promises';
import {randomUUID,createHash} from 'node:crypto';
import {z} from 'zod';
import {rebaseWritingRange} from './writing-anchor.mjs';

const body=z.string().max(2000000),text=z.string().min(1).max(100000).refine(v=>Boolean(v.trim()));
const instruction=z.string().trim().min(1).max(4000),id=z.string().uuid();
export const createWritingSchema=z.object({path:z.string().max(240),title:z.string().max(80),body,offset:z.number().int().nonnegative(),endOffset:z.number().int().nonnegative().optional(),instruction,draft:z.boolean().optional(),clientId:id.optional(),contextPaths:z.array(z.string().max(240)).max(8).optional()});
export const stageChatEditsSchema=z.object({
  path:z.string().min(1).max(240).describe('码字工作台下的文稿相对路径'),
  instruction:instruction.describe('用户对这批改稿的要求'),
  edits:z.array(z.object({
    original:z.string().max(100000).describe('当前正文中唯一的逐字原文。空文稿补写时可留空'),
    replacement:text.describe('纯正文。删除局部文字时，连同相邻原文一起选作定位，再保留相邻原文作为替换'),
    mode:z.enum(['replace','insert']).default('replace').describe('replace 替换原文；insert 在原文末尾插入'),
  })).min(1).max(40),
});
export const publishWritingSchema=z.object({requestId:id,generation:z.number().int().positive(),text,mode:z.enum(['insert','replace','discussion']).optional()});
export const writingContextSchema=z.object({path:z.string().max(240),instruction,requestId:id.optional()});
export const updateWritingSchema=z.object({id,version:z.number().int().positive(),action:z.enum(['save','prepare','delivery','edit','regenerate','discard','accept','acceptMerged','relocate','restoreVersion','undo','archive']),retry:z.boolean().optional(),mergedText:body.optional(),text:text.optional(),instruction:instruction.optional(),body:body.optional(),offset:z.number().int().nonnegative().optional(),endOffset:z.number().int().nonnegative().optional(),revision:z.string().optional(),deliveryToken:id.optional(),deliveryState:z.enum(['sent','failed']).optional(),versionId:id.optional(),contextPaths:z.array(z.string().max(240)).max(8).optional()});
const historySchema=z.object({id,generation:z.number(),createdAt:z.string(),hash:z.string(),label:z.string()});
const itemSchema=z.object({id,version:z.number().int().positive(),generation:z.number().int().positive(),path:z.string(),title:z.string(),origin:z.literal('chat').optional(),baseBody:body,offset:z.number().int().nonnegative(),endOffset:z.number().int().nonnegative().optional(),instruction,text:z.string().max(100000),status:z.enum(['draft','waiting','ready','accepting','accepted','discarded','answered']),createdAt:z.string(),updatedAt:z.string(),mode:z.enum(['insert','replace','discussion']).default('insert'),originalInstruction:z.string().optional(),feedback:z.array(z.string()).default([]),history:z.array(historySchema).default([]),contextPaths:z.array(z.string()).default([]),delivery:z.object({state:z.enum(['unsent','sending','sent','failed']),token:id.optional(),startedAt:z.string().optional()}).optional(),acceptance:z.object({before:body,after:body,revision:z.string().optional(),start:z.number().optional(),end:z.number().optional(),inserted:z.string().optional(),removed:z.string().optional()}).optional()});
const hash=v=>createHash('sha256').update(v).digest('hex'),norm=v=>v.replace(/\r\n?/g,'\n');
export function replaceEditorRange(source,start,end,addition) {
  const raw=offset=>{let at=0;for(let i=0;i<offset;i++,at++)if(source[at]==='\r' && source[at+1]==='\n')at++;return at;};
  return source.slice(0,raw(start))+(source.includes('\r\n')?addition.replace(/\n/g,'\r\n'):addition)+source.slice(raw(end));
}
export const writingRange=item=>item.mode==='replace'?{start:item.offset,end:item.endOffset??item.offset}:{start:item.endOffset??item.offset,end:item.endOffset??item.offset};

export function createWritingStore({checked,atomic,validatePath,readDocument,saveDocument,readDraft,commitDraft,sequential:sharedQueue,resolvePath=async p=>p}) {
  let pending=Promise.resolve();
  const sequential=sharedQueue || (run=>{const op=pending.then(run);pending=op.catch(()=>{});return op;});
  const cache=new Map(),active=item=>['draft','waiting','ready','accepting'].includes(item.status);
  const location=(key,archive=false)=>`数据/${archive?'递笔归档':'AI辅助'}/${id.parse(key)}.json`;
  async function read(key,archiveOnly=false) {
    let file=await checked(location(key,archiveOnly));
    if(!archiveOnly)try{await lstat(file);}catch(error){if(error.code!=='ENOENT')throw error;file=await checked(location(key,true));}
    const stat=await lstat(file),stamp=`${stat.mtimeMs}:${stat.size}`;
    if(stat.size>32000000)throw new Error('递笔记录过大，原文件已保留。');
    const old=cache.get(file);
    if(old?.stamp===stamp)return structuredClone(old.item);
    const item=itemSchema.parse(JSON.parse(await readFile(file,'utf8')));
    if(item.id!==key)throw new Error('递笔编号与文件不匹配。');
    item.endOffset??=item.offset;
    cache.set(file,{stamp,item});return structuredClone(item);
  }
  async function write(item){await atomic(location(item.id),JSON.stringify(item,null,2));cache.delete(await checked(location(item.id)));return item;}
  const next=(item,patch)=>({...item,...patch,version:item.version+1,updatedAt:new Date().toISOString()});
  const current=item=>item.path?readDocument(item.path):readDraft();
  async function entries(archive=false) {
    const results=[],warnings=[];
    let files;try{files=await readdir(await checked(`数据/${archive?'递笔归档':'AI辅助'}`));}catch(e){if(e.code==='ENOENT')return {results,warnings};throw e;}
    for(const file of files){if(!/^[a-f0-9-]{36}\.json$/.test(file))continue;try{results.push(await read(file.slice(0,-5),archive));}catch(error){warnings.push({file,message:'此条递笔记录无法读取，原文件已保留。'});}}
    return {results,warnings};
  }
  async function list(path,{history=false,allDrafts=false}={}) {
    if(path)validatePath(path);path=await resolvePath(path);
    const {results,warnings}=await entries();
    if(history){const archived=await entries(true);results.push(...archived.results.filter(a=>!results.some(r=>r.id===a.id)).map(a=>({...a,archived:true})));warnings.push(...archived.warnings);}
    for(let i=0;i<results.length;i++){let item=results[i];if(item.status==='accepting'){try{if((await current(item)).body===item.acceptance.after)results[i]=await write(next(item,{status:'accepted'}));}catch{}}}
    const same=results.filter(item=>item.path===path);
    const unsent=i=>i.status==='draft'||i.status==='waiting'&&i.delivery?.state!=='sent';
    const readyPaths=[...new Set(results.filter(item=>item.path && ['ready','accepting'].includes(item.status)).map(item=>item.path))];
    return {readyPaths,requests:same.filter(active).sort((a,b)=>a.createdAt.localeCompare(b.createdAt)),drafts:(allDrafts?results:same).filter(unsent),archivable:history?same.filter(i=>!active(i)&&!i.archived).map(i=>({id:i.id,version:i.version})):[],completed:history?same.filter(i=>!active(i)).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)).slice(0,100):[],warnings};
  }
  async function remember(item,label) {
    if(!item.text || item.history.at(-1)?.hash===hash(item.text)&&item.history.at(-1)?.generation===item.generation)return item;
    const versionId=randomUUID(),createdAt=new Date().toISOString();
    await atomic(`数据/递笔历史/${item.id}/${versionId}.json`,JSON.stringify({id:versionId,text:item.text,mode:item.mode,instruction:item.instruction,generation:item.generation,createdAt,label}));
    return {...item,history:[...item.history,{id:versionId,generation:item.generation,createdAt,hash:hash(item.text),label}]};
  }
  async function version(key,versionId){const item=await read(id.parse(key));if(!item.history.some(v=>v.id===versionId))throw new Error('未找到该版本。');const snapshot=JSON.parse(await readFile(await checked(`数据/递笔历史/${item.id}/${id.parse(versionId)}.json`),'utf8'));return {snapshot};}
  async function context(item) {
    const sources=[],sourceWarnings=[];let remaining=24000;
    for(const path of item.contextPaths){if(!remaining)break;if(!item.path || path.split('/')[0]!==item.path.split('/')[0])continue;try{const doc=await readDocument(path);const excerpt=doc.body.slice(0,Math.min(6000,remaining));sources.push({path,text:excerpt,truncated:excerpt.length<doc.body.length});remaining-=excerpt.length;}catch(error){sourceWarnings.push({path,message:'参考资料不可读取，未使用该资料。'});}}
    return {requestId:item.id,generation:item.generation,path:item.path,title:item.title,instruction:item.instruction,originalInstruction:item.originalInstruction||item.instruction,feedback:item.feedback.slice(-8),previousText:item.text,selection:{start:item.offset,end:item.endOffset,text:item.baseBody.slice(item.offset,item.endOffset)},context:{before:item.baseBody.slice(Math.max(0,item.offset-3000),item.offset),after:item.baseBody.slice(item.endOffset,item.endOffset+3000)},sources,sourceWarnings,responseTool:'publish_writing_suggestion',responseModes:['discussion','insert','replace'],paragraphSeparator:'single-newline'};
  }
  async function update(input) {
    const values=updateWritingSchema.parse(input);let item=await read(values.id);
    if(values.action==='delivery') {
      if(!values.deliveryToken || values.deliveryToken!==item.delivery?.token)throw new Error('发送回执已过期。');
      return {request:await write(next(item,{delivery:{...item.delivery,state:values.deliveryState||'failed'}}))};
    }
    if(item.version!==values.version)throw new Error('这条递笔已更新，请等待同步后重试。');
    if(values.action==='archive') {
      if(active(item))throw new Error('请先处理此条递笔。');
      const target=location(item.id,true);await atomic(target,JSON.stringify(item,null,2));
      // The archive is committed before removing the active copy.
      const {unlink}=await import('node:fs/promises');await unlink(await checked(location(item.id))).catch(error=>{if(error.code!=='ENOENT')throw error;});return {archived:true};
    }
    if(values.action==='undo') {
      if(item.status!=='accepted' || !item.acceptance)throw new Error('此条内容尚未采纳或已经撤销。');
      const doc=await current(item),receipt=item.acceptance;
      if(receipt.start===undefined)throw new Error('这是旧版采纳记录，请从文稿备份恢复。');
      const range=rebaseWritingRange(norm(receipt.after),norm(doc.body),receipt.start,receipt.start+receipt.inserted.length);
      if(!range)throw new Error('已采纳的内容后来有修改，未覆盖。可查看备份或手动处理。');
      const restored=replaceEditorRange(doc.body,range.start,range.end,receipt.removed);
      const document=item.path?await saveDocument({path:item.path,body:restored,revision:doc.revision}):await commitDraft({title:item.title,body:restored},hash(doc.body));
      const request=await write(next(item,{status:'ready',baseBody:norm(restored),offset:range.start,endOffset:range.start+receipt.removed.length,acceptance:undefined}));return {request,document};
    }
    if(!active(item))throw new Error('这条递笔已处理。');
    if(values.action==='save') {
      if(item.status!=='draft'&&!(item.status==='waiting'&&item.delivery?.state==='failed'))throw new Error('已发送的要求请通过再递笔继续修改。');
      const patch={instruction:instruction.parse(values.instruction),contextPaths:values.contextPaths??item.contextPaths,status:'draft',delivery:{state:'unsent'},generation:item.status==='waiting'?item.generation+1:item.generation};
      if(values.body!==undefined){patch.baseBody=body.parse(values.body);patch.offset=values.offset??item.offset;patch.endOffset=values.endOffset??patch.offset;if(patch.endOffset>patch.baseBody.length||patch.offset>patch.endOffset)throw new Error('批注范围不正确。');}
      return {request:await write(next(item,patch))};
    }
    if(values.action==='prepare') {
      if(item.status==='waiting' && ['sending','sent'].includes(item.delivery?.state)&&!values.retry)return {request:item,alreadySent:true};
      if(!['draft','waiting'].includes(item.status))throw new Error('此条递笔已有结果。');
      const source=norm((await current(item)).body),range=rebaseWritingRange(item.baseBody,source,item.offset,item.endOffset);
      if(!range)throw new Error('目标原文已改变，请从批注列表重新定位后发送。');
      return {request:await write(next(item,{baseBody:source,offset:range.start,endOffset:range.end,status:'waiting',generation:values.retry?item.generation+1:item.generation,delivery:{state:'sending',token:randomUUID(),startedAt:new Date().toISOString()}}))};
    }
    if(values.action==='relocate') {
      if(item.status==='accepting')throw new Error('请先处理上次采纳。');
      const baseBody=body.parse(values.body),offset=z.number().int().min(0).max(baseBody.length).parse(values.offset),endOffset=values.endOffset??offset;
      if(endOffset<offset||endOffset>baseBody.length)throw new Error('目标范围不正确。');
      return {request:await write(next(item,{baseBody,offset,endOffset}))};
    }
    if(values.action==='discard')return {request:await write(next(item,{status:'discarded'}))};
    if(values.action==='edit') {
      if(item.status!=='ready')throw new Error('请等待 AI 返回内容后再编辑。');
      item=await remember({...item,text:norm(text.parse(values.text))},'手动编辑');return {request:await write(next(item,{}))};
    }
    if(values.action==='restoreVersion') {
      const {snapshot}=await version(item.id,values.versionId);item=await remember(item,'切换前');
      return {request:await write(next(item,{status:'ready',generation:item.generation+1,text:snapshot.text,mode:snapshot.mode||item.mode,delivery:{state:'unsent'}}))};
    }
    if(values.action==='regenerate') {
      if(item.status==='accepting')throw new Error('请先完成上次采纳。');
      item=await remember(item,'上一轮');
      return {request:await write(next(item,{status:'waiting',generation:item.generation+1,instruction:instruction.parse(values.instruction),contextPaths:values.contextPaths??item.contextPaths,originalInstruction:item.originalInstruction||item.instruction,feedback:[...item.feedback,values.instruction],delivery:{state:'unsent'}}))};
    }
    if(item.status!=='ready' && item.status!=='accepting')throw new Error('尚无可采纳的正文。');
    if(item.mode==='discussion')throw new Error('讨论结果无需写入正文。');
    if(values.action==='acceptMerged' && (item.mode!=='replace' || values.mergedText===undefined))throw new Error('缺少可采纳的段落改动。');
    const doc=await current(item);
    if(norm(doc.body)!==values.body || item.path&&doc.revision!==values.revision)throw new Error('正文已改变，请先保存再采纳。');
    if(!item.acceptance) {
      const target=writingRange(item),range=rebaseWritingRange(item.baseBody,norm(doc.body),target.start,target.end);
      if(!range)throw new Error('目标原文已改变，请重新定位后采纳。');
      const inserted=values.action==='acceptMerged' ? norm(values.mergedText) : item.text;
      const after=replaceEditorRange(doc.body,range.start,range.end,inserted);body.parse(after);
      item=await write(next(item,{status:'accepting',acceptance:{before:doc.body,after,revision:doc.revision,start:range.start,end:range.end,inserted,removed:norm(doc.body).slice(range.start,range.end)}}));
    }
    const receipt=item.acceptance;
    if(doc.body!==receipt.before && doc.body!==receipt.after)throw new Error('正文与上次采纳快照不一致，未重复插入。');
    const document=doc.body===receipt.after?doc:item.path?await saveDocument({path:item.path,body:receipt.after,revision:receipt.revision}):await commitDraft({title:item.title,body:receipt.after},hash(receipt.before));
    return {request:await write(next(item,{status:'accepted'})),document};
  }
  async function stageChatEdits(input) {
    const values=stageChatEditsSchema.parse(input);
    validatePath(values.path);
    const doc=await readDocument(await resolvePath(values.path));
    const source=norm(doc.body);
    const {requests}=await list(doc.path);
    const pendingEdits=requests.filter(item=>item.status!=='draft').map(item=>{
      const {start,end}=writingRange(item);
      return {item,range:rebaseWritingRange(item.baseBody,source,start,end)};
    });
    const overlaps=(a,b)=>a.start===b.start || (a.start<b.end && b.start<a.end);
    const prepared=[];
    for(const [index,edit] of values.edits.entries()){
      const original=norm(edit.original),replacement=norm(edit.replacement);
      const found=source.indexOf(original);
      const emptyInsertion=!source && !original && edit.mode==='insert';
      if(!emptyInsertion && (!original.trim() || found<0 || source.indexOf(original,found+1)>=0)){
        throw new Error(`第 ${index+1} 处原文无法唯一定位，请核对当前正文或扩大引用范围。`);
      }
      if(edit.mode==='replace' && replacement===original)throw new Error(`第 ${index+1} 处改稿与原文相同。`);
      const end=found+original.length,start=edit.mode==='insert'?end:found;
      const range={start,end};
      if(prepared.some(entry=>overlaps(range,entry.range)))throw new Error('本批改稿的位置有重叠，请分别提交不重叠的原文。');
      const touching=pendingEdits.filter(entry=>entry.range && overlaps(range,entry.range));
      const duplicate=touching.length===1 && touching.find(({item,range:prior})=>
        item.origin==='chat' && item.status==='ready' && item.mode===edit.mode
        && prior.start===start && prior.end===end && item.text===replacement)?.item;
      if(touching.length && !duplicate)throw new Error(`第 ${index+1} 处与现有待处理递笔重叠，请先处理原来的递笔。`);
      prepared.push({range,replacement,mode:edit.mode,duplicate});
    }
    if(requests.length+prepared.filter(entry=>!entry.duplicate).length>200)throw new Error('当前文稿的递笔过多，请先处理或归档。');
    if((await readDocument(doc.path)).revision!==doc.revision)throw new Error('正文刚刚有更新，请核对后再提交建议。');
    const now=new Date().toISOString(),suggestions=[];
    for(const {range,replacement,mode,duplicate} of prepared){
      const item=duplicate || await write(await remember(itemSchema.parse({
        id:randomUUID(),version:1,generation:1,path:doc.path,title:doc.title,origin:'chat',
        baseBody:source,offset:range.start,endOffset:range.end,mode,text:replacement,
        instruction:values.instruction,originalInstruction:values.instruction,status:'ready',
        createdAt:now,updatedAt:now,
      }),'聊天改稿'));
      suggestions.push({id:item.id,mode:item.mode});
    }
    return {path:doc.path,suggestions,message:'已放入递笔待采纳，正文未改动。'};
  }
  return {
    stageChatEdits:input=>sequential(()=>stageChatEdits(input)),
    list:(path,options)=>sequential(()=>list(path,options)),
    context:input=>sequential(async()=>{const v=writingContextSchema.parse(input);const matches=v.requestId?[await read(v.requestId)]:(await list(v.path)).requests.filter(i=>i.status==='waiting'&&i.instruction===v.instruction);if(!matches.length)throw new Error('未找到对应的待生成递笔。');if(matches.some(i=>i.status!=='waiting'))throw new Error('这轮递笔已结束。');if(matches.length>1)return {requests:await Promise.all(matches.map(context)),message:'逐条按各自选区和定位处理，不合并或猜测目标。'};return context(matches[0]);}),
    create:input=>sequential(async()=>{const v=createWritingSchema.parse(input);if(v.path)validatePath(v.path);const endOffset=v.endOffset??v.offset;if(v.offset>endOffset||endOffset>v.body.length)throw new Error('插入位置超出正文范围。');if(v.clientId){try{const existing=await read(v.clientId);if(existing.path!==v.path||existing.instruction!==v.instruction)throw new Error('此条递笔已建立，请从批注列表继续编辑。');return {request:existing};}catch(error){if(error.code!=='ENOENT')throw error;}}const existing=await list(v.path);if(existing.requests.length>=200)throw new Error('当前文稿的递笔过多，请先处理或归档。');const now=new Date().toISOString();const item=itemSchema.parse({id:v.clientId||randomUUID(),version:1,generation:1,path:v.path,title:v.title,baseBody:v.body,offset:v.offset,endOffset,instruction:v.instruction,originalInstruction:v.instruction,text:'',status:v.draft?'draft':'waiting',mode:endOffset>v.offset?'replace':'insert',contextPaths:v.contextPaths||[],delivery:{state:'unsent'},createdAt:now,updatedAt:now});return {request:await write(item)};}),
    publish:input=>sequential(async()=>{const v=publishWritingSchema.parse(input);let item=await read(v.requestId);if(item.status!=='waiting'||item.generation!==v.generation)throw new Error('该轮请求已结束或已重新生成，未覆盖现有内容。');const mode=v.mode||item.mode;if(mode==='replace'&&item.endOffset===item.offset)throw new Error('未提供选区，无法替换正文。');item=await remember({...item,mode,text:norm(v.text).replace(/\n(?:[ \t\u3000]*\n)+/g,'\n')},'AI 结果');await write(next(item,{status:mode==='discussion'?'answered':'ready'}));return {delivered:true,requestId:item.id,generation:item.generation,mode,message:mode==='discussion'?'讨论已完成，正文未修改。':'已回填为待采纳建议，正文尚未修改。'};}),
    update:input=>sequential(()=>update(input)),
    version:(key,versionId)=>sequential(()=>version(key,versionId)),
    // Called inside the workspace's shared mutation queue during rename recovery.
    async migratePaths(from,to){for(const archived of [false,true]){const {results}=await entries(archived);for(const item of results)if(item.path===from||item.path.startsWith(from+'/')||item.contextPaths.some(p=>p===from||p.startsWith(from+'/'))){const map=p=>p===from||p.startsWith(from+'/')?to+p.slice(from.length):p;const changed=next(item,{path:map(item.path),contextPaths:item.contextPaths.map(map)});await atomic(location(item.id,archived),JSON.stringify(changed,null,2));cache.delete(await checked(location(item.id,archived)));}}},
  };
}
