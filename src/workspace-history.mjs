import {readdir,readFile,lstat,unlink} from 'node:fs/promises';
import {randomUUID,createHash} from 'node:crypto';
import {z} from 'zod';

const digest=b=>createHash('sha256').update(b).digest('hex');
const metadata=z.object({id:z.string().uuid(),path:z.string(),createdAt:z.string(),revision:z.string(),bytes:z.number()});
export function createWorkspaceHistory({checked,atomic,readDocument,saveDocument,sequential,validatePath}) {
  async function all() {
    const entries=[],warnings=[];let files=[];
    try{files=await readdir(await checked('数据/备份'));}catch(e){if(e.code!=='ENOENT')throw e;}
    const indexed=new Set();
    for(const name of files.filter(n=>/^[a-f0-9-]{36}\.json$/.test(n))){try{const entry=metadata.parse(JSON.parse(await readFile(await checked('数据/备份/'+name),'utf8')));if(name!==entry.id+'.json')throw Error();validatePath(entry.path);entries.push(entry);indexed.add(entry.id+'.bak');}catch{warnings.push('有一条备份索引无法读取，原文件已保留。');}}
    for(const name of files.filter(n=>n.endsWith('.bak')&&!indexed.has(n))){try{const stat=await lstat(await checked('数据/备份/'+name));if(stat.isFile())entries.push({id:name,path:'',createdAt:stat.mtime.toISOString(),bytes:stat.size,legacy:true});}catch{warnings.push('有一条旧备份无法读取。');}}
    return {entries:entries.sort((a,b)=>b.createdAt.localeCompare(a.createdAt)),warnings};
  }
  async function read(key) {
    const entry=(await all()).entries.find(e=>e.id===key);if(!entry)throw new Error('备份不存在。');
    const name=entry.legacy?entry.id:entry.id+'.bak',file=await checked('数据/备份/'+name),stat=await lstat(file);
    if(!stat.isFile()||stat.size>5000000)throw new Error('备份不是可读取的文本。');
    const bytes=await readFile(file);if(!entry.legacy&&digest(bytes)!==entry.revision)throw new Error('备份校验未通过，原文件已保留。');
    return {entry,body:new TextDecoder('utf-8',{fatal:true}).decode(bytes)};
  }
  async function viewMap(){try{return JSON.parse(await readFile(await checked('数据/阅读位置.json'),'utf8'));}catch(e){if(e.code==='ENOENT')return {};throw new Error('阅读位置记录无法读取，未覆盖原文件。');}}
  return {
    async backup(path,bytes){const entry={id:randomUUID(),path,createdAt:new Date().toISOString(),revision:digest(bytes),bytes:bytes.length};await atomic(`数据/备份/${entry.id}.bak`,bytes);await atomic(`数据/备份/${entry.id}.json`,JSON.stringify(entry));},
    list:({path})=>sequential(async()=>{validatePath(path);const result=await all();return {...result,entries:result.entries.filter(e=>e.path===path||e.legacy)};}),
    read:key=>sequential(()=>read(key)),
    restore:({id,path,revision})=>sequential(async()=>{validatePath(path);const backup=await read(id);if(!backup.entry.legacy&&backup.entry.path!==path)throw new Error('备份属于其他文稿。');const current=await readDocument(path);if(current.revision!==revision)throw new Error('文稿已改变，请重新查看后恢复。');return {document:await saveDocument({path,body:backup.body,revision})};}),
    prune:({path,keep=100})=>sequential(async()=>{validatePath(path);z.number().int().min(1).max(1000).parse(keep);const entries=(await all()).entries.filter(e=>e.path===path&&!e.legacy);for(const entry of entries.slice(keep)){await read(entry.id);await unlink(await checked(`数据/备份/${entry.id}.json`));await unlink(await checked(`数据/备份/${entry.id}.bak`));}return {removed:Math.max(0,entries.length-keep)};}),
    view:({path,position})=>sequential(async()=>{if(path)validatePath(path);const map=await viewMap();if(position){const value=z.object({start:z.number().int().nonnegative(),end:z.number().int().nonnegative(),scrollTop:z.number().min(0).max(100000000)}).parse(position);map[path]={...value,updatedAt:new Date().toISOString()};await atomic('数据/阅读位置.json',JSON.stringify(map));}return {position:map[path]||null};}),
    async migratePaths(from,to){const result=await all();for(const entry of result.entries)if(!entry.legacy&&(entry.path===from||entry.path.startsWith(from+'/')))await atomic(`数据/备份/${entry.id}.json`,JSON.stringify({...entry,path:to+entry.path.slice(from.length)}));let map;try{map=await viewMap();}catch{return;}for(const key of Object.keys(map))if(key===from||key.startsWith(from+'/')){map[to+key.slice(from.length)]=map[key];delete map[key];}await atomic('数据/阅读位置.json',JSON.stringify(map));},
  };
}
