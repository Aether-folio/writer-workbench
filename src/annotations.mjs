import {readFile, writeFile, mkdir, rename, unlink} from 'node:fs/promises';
import {dirname} from 'node:path';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {z} from 'zod';

export const annotationSchema = z.object({
  id:z.string().uuid(), title:z.string().min(1).max(80),
  quote:z.string().min(1).max(24000), body:z.string().trim().min(1).max(4000),
  createdAt:z.string().datetime(), updatedAt:z.string().datetime(),
  path:z.string().max(240).optional(),
});
export const saveAnnotationSchema = z.object({
  id:z.string().uuid().optional(), title:z.string().trim().min(1).max(80),
  quote:z.string().min(1).max(24000).refine(value=>value.trim().length>0), body:z.string().trim().min(1).max(4000),
  path:z.string().max(240).optional(),
});
const documentSchema = z.object({version:z.literal(1), annotations:z.array(annotationSchema).max(2000)});

export function createAnnotationStore(path) {
  if (path instanceof URL) path = fileURLToPath(path);
  let pending = Promise.resolve();
  async function read() {
    try { return documentSchema.parse(JSON.parse(await readFile(path,'utf8'))).annotations; }
    catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  }
  return {
    async list() { await pending; return read(); },
    save(input) {
      const operation = pending.then(async()=>{
        const values = saveAnnotationSchema.parse(input);
        const annotations = await read();
        const index = values.id ? annotations.findIndex(item=>item.id===values.id) : -1;
        if (values.id && index<0) throw new Error('这条批注已不存在，请重新打开工作台。');
        if (!values.id && annotations.length>=2000) throw new Error('批注数量已达上限。');
        const now = new Date().toISOString();
        const previous = annotations[index];
        const annotation = previous
          ? {...previous, body:values.body, updatedAt:now}
          : {...values, id:randomUUID(), createdAt:now, updatedAt:now};
        if (previous) annotations[index] = annotation;
        else annotations.push(annotation);
        await mkdir(dirname(path),{recursive:true});
        const temporary = `${path}.${randomUUID()}.tmp`;
        try {
          await writeFile(temporary,JSON.stringify({version:1, annotations},null,2),'utf8');
          await rename(temporary,path);
        } finally { await unlink(temporary).catch(()=>{}); }
        return annotation;
      });
      pending = operation.then(()=>{},()=>{});
      return operation;
    },
  };
}
