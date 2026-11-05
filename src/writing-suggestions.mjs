import {readFile,readdir} from 'node:fs/promises';
import {randomUUID,createHash} from 'node:crypto';
import {z} from 'zod';
import {rebaseWritingAnchor} from './writing-anchor.mjs';

const body=z.string().max(2000000),text=z.string().min(1).max(100000).refine(value=>Boolean(value.trim()));
const instruction=z.string().trim().min(1).max(4000);
export const createWritingSchema=z.object({path:z.string().max(240),title:z.string().max(80),body,offset:z.number().int().nonnegative(),instruction});
export const publishWritingSchema=z.object({requestId:z.string().uuid(),generation:z.number().int().positive(),text});
export const writingContextSchema=z.object({path:z.string().max(240),instruction});
export const updateWritingSchema=z.object({id:z.string().uuid(),version:z.number().int().positive(),action:z.enum(['edit','regenerate','discard','accept','relocate']),text:text.optional(),instruction:instruction.optional(),body:body.optional(),offset:z.number().int().nonnegative().optional(),revision:z.string().optional()});
const itemSchema=z.object({id:z.string().uuid(),version:z.number().int().positive(),generation:z.number().int().positive(),path:z.string(),title:z.string(),baseBody:body,offset:z.number().int().nonnegative(),instruction,text:z.string().max(100000),status:z.enum(['waiting','ready','accepting','accepted','discarded']),createdAt:z.string(),updatedAt:z.string(),acceptance:z.object({before:body,after:body,revision:z.string().optional()}).optional()});
const digest=value=>createHash('sha256').update(value).digest('hex');
const normalized=value=>value.replace(/\r\n?/g,'\n');
function insertAtEditorOffset(source,offset,text) {
  let rawOffset=0;
  for(let i=0;i<offset;i++,rawOffset++)if(source[rawOffset]==='\r' && source[rawOffset+1]==='\n')rawOffset++;
  const addition=source.includes('\r\n')?text.replace(/\n/g,'\r\n'):text;
  return source.slice(0,rawOffset)+addition+source.slice(rawOffset);
}

export function createWritingStore({checked,atomic,validatePath,readDocument,saveDocument,readDraft,commitDraft}) {
  let pending=Promise.resolve();
  const sequential=run=>{const operation=pending.then(run);pending=operation.catch(()=>{});return operation;};
  const location=id=>`数据/AI辅助/${z.string().uuid().parse(id)}.json`;
  async function read(id) {return itemSchema.parse(JSON.parse(await readFile(await checked(location(id)),'utf8')));}
  async function write(item) {await atomic(location(item.id),JSON.stringify(item,null,2));return item;}
  const active=item=>!['accepted','discarded'].includes(item.status);
  function next(item,patch) {return {...item,...patch,version:item.version+1,updatedAt:new Date().toISOString()};}
  async function current(item) {return item.path ? readDocument(item.path) : readDraft();}
  async function list(path) {
    if(path)validatePath(path);
    let files;
    try {files=await readdir(await checked('数据/AI辅助'));}
    catch(error){if(error.code==='ENOENT')return [];throw error;}
    const items=[];
    for(const file of files) {
      if(!/^[a-f0-9-]{36}\.json$/.test(file))continue;
      let item=await read(file.slice(0,-5));
      if(item.path!==path || !active(item))continue;
      // If the process stopped after committing the manuscript, finish the receipt.
      if(item.status==='accepting') {
        try {if((await current(item)).body===item.acceptance.after)item=await write(next(item,{status:'accepted'}));}
        catch { /* Deleted/conflicting manuscripts keep their recoverable proposal. */ }
      }
      if(active(item))items.push(item);
    }
    return items.sort((a,b)=>a.createdAt.localeCompare(b.createdAt));
  }
  return {
    list:path=>sequential(async()=>({requests:await list(path)})),
    context:input=>sequential(async()=>{
      const values=writingContextSchema.parse(input);
      const matches=(await list(values.path)).filter(item=>item.status==='waiting' && item.instruction===values.instruction);
      if(matches.length!==1)throw new Error(matches.length?'有多条相同要求的待处理请求，请在工作台中保留一条后重试。':'未找到对应的待生成请求，可能已经生成或被取消。');
      const item=matches[0];
      return {requestId:item.id,generation:item.generation,path:item.path,title:item.title,instruction:item.instruction,previousText:item.text,
        context:{before:item.baseBody.slice(Math.max(0,item.offset-3000),item.offset),after:item.baseBody.slice(item.offset,item.offset+3000)},
        responseTool:'publish_writing_suggestion',paragraphSeparator:'single-newline'};
    }),
    create:input=>sequential(async()=>{
      const values=createWritingSchema.parse(input);
      if(values.path)validatePath(values.path);
      if(values.offset>values.body.length)throw new Error('插入位置超出正文范围。');
      if((await list(values.path)).length>=30)throw new Error('当前文稿待处理的 AI 请求过多，请先采纳或不采纳。');
      const now=new Date().toISOString();
      const item={id:randomUUID(),version:1,generation:1,path:values.path,title:values.title,baseBody:values.body,offset:values.offset,instruction:values.instruction,text:'',status:'waiting',createdAt:now,updatedAt:now};
      return {request:await write(item)};
    }),
    publish:input=>sequential(async()=>{
      const values=publishWritingSchema.parse(input),item=await read(values.requestId);
      if(item.status!=='waiting' || item.generation!==values.generation)throw new Error('该轮请求已结束或已重新生成，未覆盖现有内容。');
      // Prose paragraphs use one stored newline; visual paragraph spacing is CSS.
      const prose=values.text.replace(/\r\n?/g,'\n').replace(/\n(?:[ \t\u3000]*\n)+/g,'\n');
      await write(next(item,{status:'ready',text:prose}));
      return {delivered:true,requestId:item.id,generation:item.generation,message:'内容已保存为待采纳建议；打开目标文稿后工作台会自动显示文本框，尚未写入正文。'};
    }),
    update:input=>sequential(async()=>{
      const values=updateWritingSchema.parse(input);
      let item=await read(values.id);
      if(item.version!==values.version)throw new Error('这条建议已更新，请等待同步后重试。');
      if(!active(item))throw new Error('这条建议已处理。');
      if(values.action==='relocate') {
        if(item.status==='accepting')throw new Error('上次采纳尚未完成，请先重试采纳。');
        const baseBody=body.parse(values.body),offset=z.number().int().min(0).max(baseBody.length).parse(values.offset);
        return {request:await write(next(item,{baseBody,offset}))};
      }
      if(values.action==='discard')return {request:await write(next(item,{status:'discarded'}))};
      if(values.action==='edit') {
        if(item.status!=='ready')throw new Error('请等待 AI 返回内容后再编辑。');
        return {request:await write(next(item,{text:text.parse(values.text).replace(/\r\n?/g,'\n')}))};
      }
      if(values.action==='regenerate') {
        if(item.status==='accepting')throw new Error('上次采纳尚未完成，请先重试采纳。');
        return {request:await write(next(item,{status:'waiting',generation:item.generation+1,instruction:instruction.parse(values.instruction)}))};
      }
      if(item.status!=='ready' && item.status!=='accepting')throw new Error('尚无可采纳的内容。');
      const snapshot=await current(item);
      if(normalized(snapshot.body)!==values.body || item.path && snapshot.revision!==values.revision)throw new Error('正文已改变，请先保存并重试采纳。');
      if(!item.acceptance) {
        const offset=rebaseWritingAnchor(item.baseBody,normalized(snapshot.body),item.offset);
        if(offset===null)throw new Error('插入位置附近的原文已改变，请先在目标位置重新定位。');
        const after=insertAtEditorOffset(snapshot.body,offset,item.text);
        body.parse(after);
        item=await write(next(item,{status:'accepting',acceptance:{before:snapshot.body,after,revision:snapshot.revision}}));
      }
      const receipt=item.acceptance;
      if(snapshot.body!==receipt.before && snapshot.body!==receipt.after)throw new Error('正文与上次采纳快照不一致，未重复插入。请保留建议并检查文稿。');
      let document=snapshot;
      if(snapshot.body!==receipt.after) {
        document=item.path
          ? await saveDocument({path:item.path,body:receipt.after,revision:receipt.revision})
          : await commitDraft({title:item.title,body:receipt.after},digest(receipt.before));
      }
      return {request:await write(next(item,{status:'accepted'})),document};
    }),
  };
}
