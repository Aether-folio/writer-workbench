import {readFile,writeFile,mkdir,readdir,lstat,rename,unlink,copyFile,rm} from 'node:fs/promises';
import {constants} from 'node:fs';
import {resolve,dirname,join,relative,isAbsolute,extname,basename} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {z} from 'zod';

export const draftSchema=z.object({title:z.string().max(80),body:z.string().max(2000000)});
export const defaultStatsFields=['work','cover','words','speed','active','idle','status'];
const statsFieldsSchema=z.array(z.enum(defaultStatsFields)).max(defaultStatsFields.length).refine(fields=>new Set(fields).size===fields.length);
const defaultPet={enabled:false,character:'dragon'};
const petSchema=z.object({enabled:z.boolean(),character:z.enum(['dragon','fish'])});
export const statsPreferencesSchema=z.object({fields:statsFieldsSchema,workPath:z.string().max(80).optional(),coverDataUrl:z.string().max(3000000).nullable().optional(),pet:petSchema.optional()});
const coverTypes={'image/png':'png','image/jpeg':'jpg','image/webp':'webp'};
const storedStatsSchema=z.object({version:z.literal(1),fields:statsFieldsSchema,covers:z.record(z.string(),z.object({id:z.string().uuid(),mime:z.enum(['image/png','image/jpeg','image/webp'])})),pet:petSchema.default(defaultPet)});
export const recordSchema=z.object({id:z.string().min(1).max(100),day:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),path:z.string().max(240),title:z.string().max(80),added:z.number().int().min(0).max(10000000),deleted:z.number().int().min(0).max(10000000),activeMs:z.number().min(0).max(86400000),idleMs:z.number().min(0).max(86400000),startedAt:z.string().datetime(),updatedAt:z.string().datetime()});
const settingsSchema=z.object({background:z.string().regex(/^#[0-9a-f]{6}$/i)});
const trashSchema=z.object({id:z.string().uuid(),path:z.string().max(240),deletedAt:z.string().datetime(),revision:z.string().regex(/^[a-f0-9]{64}$/),restoredAt:z.string().datetime().optional()});
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const missing=error=>error.code==='ENOENT';

export function createWorkspace(workspacePath) {
  const root=resolve(workspacePath,'码字工作台');
  let pending=Promise.resolve();
  function sequential(task) {const next=pending.then(task);pending=next.then(()=>{},()=>{});return next;}
  async function checked(path) {
    const target=resolve(root,path);
    const rel=relative(root,target);
    if(rel.startsWith('..') || isAbsolute(rel)) throw new Error('只能访问码字工作台文件夹内的文件。');
    const parts=rel ? rel.split(/[\\/]/) : [];
    let current=root;
    for(const part of ['',...parts]) {
      if(part) current=join(current,part);
      try {if((await lstat(current)).isSymbolicLink()) throw new Error('不支持链接文件或链接目录。');}
      catch(error) {if(!missing(error)) throw error;}
    }
    return target;
  }
  async function init() {
    await checked('');await mkdir(root,{recursive:true});
    for(const folder of ['数据','数据/备份']) {await mkdir(await checked(folder),{recursive:true});}
  }
  async function readJSON(name,fallback) {
    try {return JSON.parse(await readFile(await checked(`数据/${name}.json`),'utf8'));}
    catch(error) {if(missing(error)) return fallback;throw new Error(`无法读取${name}数据，已保留原文件：${error.message}`);}
  }
  async function atomic(path,content) {
    const target=await checked(path);
    const temp=`${target}.${randomUUID()}.tmp`;
    await mkdir(dirname(target),{recursive:true});
    try {await writeFile(temp,content);await rename(temp,target);}
    finally {await unlink(temp).catch(()=>{});}
  }
  const writeJSON=(name,value)=>atomic(`数据/${name}.json`,JSON.stringify(value,null,2));
  function documentPath(path) {
    if(typeof path!=='string' || path.length>240 || !path || isAbsolute(path) || /[<>:"|?*\x00-\x1f]/.test(path)) throw new Error('文稿路径不正确。');
    const parts=path.replace(/\\/g,'/').split('/');
    if(parts.some(part=>!part || part==='.' || part==='..' || part.startsWith('.') || /[ .]$/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)) || parts[0]==='数据') throw new Error('文稿路径不正确。');
    if(!['.md','.txt'].includes(extname(path).toLowerCase())) throw new Error('目前支持 Markdown 和 TXT 文稿。');
    return parts.join('/');
  }
  function documentStem(value) {
    const name=String(value ?? '').trim();
    if(!name) throw new Error('文稿名称不能为空。');
    if(/[\\/:*?"<>|\x00-\x1f]/.test(name)) throw new Error('文稿名称不能包含 \\ / : * ? " < > | 等字符。');
    const stem=name.replace(/\.(md|txt)$/i,'').trim();
    if(!stem || stem==='.' || stem==='..' || stem.startsWith('.')) throw new Error('文稿名称不正确。');
    if(/[ .]$/.test(stem)) throw new Error('文稿名称不能以空格或句点结尾。');
    if(stem.length>80) throw new Error('文稿名称过长，最多 80 个字符。');
    return stem;
  }
  function folderPath(path) {
    if(typeof path!=='string' || path.length>240 || !path || isAbsolute(path) || /[<>:"|?*\x00-\x1f]/.test(path)) throw new Error('文件夹路径不正确。');
    const parts=path.replace(/\\/g,'/').split('/');
    if(parts.length>6 || parts.some(part=>!part || part==='.' || part==='..' || part==='数据' || part.startsWith('.') || /[ .]$/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) throw new Error('文件夹路径不正确。');
    return parts.join('/');
  }
  function folderName(value) {
    const name=String(value ?? '').trim();
    if(!name) throw new Error('文件夹名称不能为空。');
    if(name.length>80) throw new Error('文件夹名称过长，最多 80 个字符。');
    if(/[\\/:*?"<>|\x00-\x1f]/.test(name)) throw new Error('文件夹名称不能包含 \\ / : * ? " < > | 等字符。');
    if(name==='.' || name==='..' || name==='数据' || name.startsWith('.')) throw new Error('文件夹名称不正确。');
    if(/[ .]$/.test(name)) throw new Error('文件夹名称不能以空格或句点结尾。');
    if(/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) throw new Error('文件夹名称不正确。');
    return name;
  }
  async function scanTree() {
    const files=[],directories=[];
    async function visit(folder,depth=0) {
      if(depth>6 || files.length>=1000 || directories.length>=1000) return;
      for(const entry of await readdir(await checked(folder),{withFileTypes:true})) {
        if(files.length>=1000 || directories.length>=1000)break;
        if(entry.name.startsWith('.') || entry.name==='数据' || entry.isSymbolicLink()) continue;
        const path=folder ? `${folder}/${entry.name}` : entry.name;
        if(entry.isDirectory()) {directories.push({path,name:entry.name});await visit(path,depth+1);}
        else if(entry.isFile() && /\.(md|txt)$/i.test(entry.name)) {
          const info=await lstat(await checked(path));
          files.push({path,name:entry.name,size:info.size,updatedAt:info.mtime.toISOString()});
          if(files.length>=1000) return;
        }
      }
    }
    await visit('');return {files:files.sort((a,b)=>a.path.localeCompare(b.path,'zh-CN')),directories:directories.sort((a,b)=>a.path.localeCompare(b.path,'zh-CN'))};
  }
  async function scan() {return (await scanTree()).files;}
  async function readDocument(path) {
    path=documentPath(path);
    const target=await checked(path);
    const info=await lstat(target);
    if(!info.isFile() || info.size>5000000) throw new Error('文稿必须是 5 MB 以内的 UTF-8 文本文件。');
    const bytes=await readFile(target);
    let body;
    try {body=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}
    catch {throw new Error('文稿不是 UTF-8 编码，请转换后再打开。');}
    return {path,title:basename(path,extname(path)).slice(0,80),body,revision:hash(bytes)};
  }
  async function trashEntry(id) {
    z.string().uuid().parse(id);
    const folder=`数据/回收站/${id}`;
    const entry=trashSchema.parse(JSON.parse(await readFile(await checked(`${folder}/entry.json`),'utf8')));
    if(entry.id!==id) throw new Error('回收站记录不匹配。');
    entry.path=documentPath(entry.path);
    return {entry,folder,file:await checked(`${folder}/${basename(entry.path)}`)};
  }
  async function readStatsPreferences() {
    return storedStatsSchema.parse(await readJSON('悬浮窗',{version:1,fields:defaultStatsFields,covers:{}}));
  }
  async function checkedWork(path) {
    if(typeof path!=='string' || !path || /[\\/]/.test(path))throw new Error('请选择一个作品。');
    documentPath(`${path}/正文/未命名.md`);
    for(const folder of [path,path+'/设定',path+'/正文'])if(!(await lstat(await checked(folder))).isDirectory())throw new Error('作品目录不完整。');
    return path;
  }
  async function migrateCover(from,to) {
    try {
      const preferences=await readStatsPreferences();
      if(!Object.hasOwn(preferences.covers,from)) return;
      const covers={...preferences.covers};
      covers[to]=covers[from];delete covers[from];
      await writeJSON('悬浮窗',{...preferences,covers});
    } catch {
      // 封面配置损坏或不可写时，不影响文件夹改名本身。
    }
  }
  async function statsInfo(preferences,workPath) {
    let coverDataUrl=null;
    if(workPath) {
      await checkedWork(workPath);
      const cover=Object.hasOwn(preferences.covers,workPath)?preferences.covers[workPath]:null;
      if(cover) {
        const file=await checked(`数据/封面/${cover.id}.${coverTypes[cover.mime]}`);
        if((await lstat(file)).size>2097152)throw new Error('封面超过 2 MB，请重新上传。');
        coverDataUrl=`data:${cover.mime};base64,${(await readFile(file)).toString('base64')}`;
      }
    }
    return {fields:preferences.fields,coverDataUrl,pet:preferences.pet};
  }
  return {
    root,init,scan,readDocument,
    async info() {
      await init();
      const settings=settingsSchema.parse(await readJSON('外观',{background:'#fffdf8'}));
      const draft=draftSchema.parse(await readJSON('草稿',{title:'未命名草稿',body:''}));
      const tree=await scanTree(),paths=new Set(tree.directories.map(folder=>folder.path));
      const works=tree.directories.filter(folder=>!folder.path.includes('/') && paths.has(folder.path+'/设定') && paths.has(folder.path+'/正文'));
      return {folder:'码字工作台',...tree,works,settings,draft,features:{trash:true,works:true,statsPreferences:true}};
    },
    createWork(input) {return sequential(async()=>{
      const name=z.string().trim().min(1).max(80).parse(input.name);
      if(/[\\/]/.test(name))throw new Error('请填写作品名，不要包含路径。');
      documentPath(`${name}/正文/未命名.md`);
      const target=await checked(name);
      try {await mkdir(target);}
      catch(error){if(error.code==='EEXIST')throw new Error('同名作品或文件夹已存在，请换一个作品名。');throw error;}
      const folders=['设定','正文','草稿'];
      for(const folder of folders)await mkdir(await checked(`${name}/${folder}`));
      return {work:{name,path:name},directories:folders.map(folder=>({name:folder,path:`${name}/${folder}`}))};
    });},
    async statsPreferences({workPath}={}) {
      await pending;return statsInfo(await readStatsPreferences(),workPath);
    },
    saveStatsPreferences(input) {return sequential(async()=>{
      const values=statsPreferencesSchema.parse(input),previous=await readStatsPreferences();
      if(values.workPath)await checkedWork(values.workPath);
      let covers=previous.covers;
      if(values.coverDataUrl!==undefined) {
        const workPath=await checkedWork(values.workPath);
        covers=Object.fromEntries(Object.entries(covers).filter(([path])=>path!==workPath));
        if(values.coverDataUrl!==null) {
          const match=values.coverDataUrl.match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/);
          if(!match)throw new Error('请选择 PNG、JPG 或 WebP 格式的封面。');
          const [,mime,data]=match,bytes=Buffer.from(data,'base64');
          if(!bytes.length || bytes.length>2097152 || bytes.toString('base64')!==data)throw new Error('请选择 2 MB 以内的有效封面。');
          const signature=mime==='image/png'?bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex')):mime==='image/jpeg'?bytes.subarray(0,3).equals(Buffer.from('ffd8ff','hex')):bytes.subarray(0,4).toString()==='RIFF' && bytes.subarray(8,12).toString()==='WEBP';
          if(!signature)throw new Error('图片格式与文件内容不符，请重新选择封面。');
          const id=randomUUID();await atomic(`数据/封面/${id}.${coverTypes[mime]}`,bytes);
          covers=Object.fromEntries([...Object.entries(covers),[workPath,{id,mime}]]);
        }
      }
      const preferences={version:1,fields:values.fields,covers,pet:values.pet ?? previous.pet};
      // Commit the preferences only after the optional cover file is ready.
      await writeJSON('悬浮窗',preferences);
      return statsInfo(preferences,values.workPath);
    });},
    saveDocument(input) {return sequential(async()=>{
      const path=documentPath(input.path);
      const target=await checked(path);
      let old;
      try {old=await readFile(target);}catch(error){if(!missing(error)) throw error;}
      if(old && (!input.revision || hash(old)!==input.revision)) throw new Error('文件已在其他地方修改，未覆盖。请先保留编辑区内容，再重新打开文件。');
      if(!old && input.revision) throw new Error('原文件已被移动或删除，未另行覆盖。请保留编辑区内容。');
      if(old) await atomic(`数据/备份/${basename(path)}.${Date.now()}.${randomUUID()}.bak`,old);
      await atomic(path,input.body);
      return readDocument(path);
    });},
    renameDocument(input) {return sequential(async()=>{
      const path=documentPath(input.path);
      const current=await readDocument(path);
      if(input.revision && current.revision!==input.revision) throw new Error('文件已在其他地方修改，未重命名。请重新打开后再操作。');
      const stem=documentStem(input.name),ext=extname(path),folder=dirname(path);
      const nextPath=documentPath(`${folder==='.'?'':folder.replace(/\\/g,'/')+'/'}${stem}${ext}`);
      if(nextPath===path) return {document:current,previousPath:path};
      const target=await checked(nextPath);
      let exists=false;
      try {await lstat(target);exists=true;}
      catch(error){if(!missing(error)) throw error;}
      if(exists) throw new Error('同名文稿或文件夹已存在，请换一个名称。');
      await rename(await checked(path),target);
      return {document:await readDocument(nextPath),previousPath:path};
    });},
    renameFolder(input) {return sequential(async()=>{
      const path=folderPath(input.path);
      const info=await lstat(await checked(path));
      if(!info.isDirectory()) throw new Error('只能重命名文件夹。');
      const name=folderName(input.name),parent=dirname(path);
      const nextPath=`${parent==='.'?'':parent.replace(/\\/g,'/')+'/'}${name}`;
      if(nextPath===path) return {folder:{name:basename(path),path},previousPath:path};
      let exists=false;
      try {await lstat(await checked(nextPath));exists=true;}
      catch(error){if(!missing(error)) throw error;}
      if(exists) throw new Error('同名文件或文件夹已存在，请换一个名称。');
      await rename(await checked(path),await checked(nextPath));
      // 作品封面按作品目录名保存；作品目录改名后把封面迁移到新名字。
      if(!path.includes('/')) await migrateCover(path,nextPath);
      return {folder:{name,path:nextPath},previousPath:path};
    });},
    deleteDocument(input) {return sequential(async()=>{
      const document=await readDocument(input.path);
      if(document.revision!==input.revision) throw new Error('文件已在其他地方修改，未删除。请重新打开后再操作。');
      const entry={id:randomUUID(),path:document.path,deletedAt:new Date().toISOString(),revision:document.revision};
      const folder=`数据/回收站/${entry.id}`;
      await atomic(`${folder}/entry.json`,JSON.stringify(entry,null,2));
      await rename(await checked(document.path),await checked(`${folder}/${basename(document.path)}`));
      return {deleted:true,entry};
    });},
    async listTrash() {
      await pending;
      const folder=await checked('数据/回收站');let directories;
      try {directories=await readdir(folder,{withFileTypes:true});}catch(error){if(missing(error))return {entries:[]};throw error;}
      const entries=[];
      for(const directory of directories) {
        if(!directory.isDirectory() || directory.isSymbolicLink() || !z.string().uuid().safeParse(directory.name).success)continue;
        try {
          const {entry,file}=await trashEntry(directory.name);
          if(!entry.restoredAt && (await lstat(file)).isFile())entries.push(entry);
        } catch(error) {if(!missing(error))throw error;}
      }
      return {entries:entries.sort((a,b)=>b.deletedAt.localeCompare(a.deletedAt))};
    },
    deleteTrash({id}) {return sequential(async()=>{
      const {entry,folder}=await trashEntry(id);
      if(entry.restoredAt)throw new Error('此文稿已恢复，不能从回收站删除。');
      const target=await checked(folder);
      // Only a validated UUID entry with its two ordinary archive files may be removed.
      for(const child of await readdir(target)) {
        if(!['entry.json',basename(entry.path)].includes(child))throw new Error('回收站记录包含未知文件，未删除。');
        if(!(await lstat(await checked(`${folder}/${child}`))).isFile())throw new Error('回收站记录不完整，未删除。');
      }
      await rm(target,{recursive:true});
      return {deleted:true,id};
    });},
    restoreDocument({id}) {return sequential(async()=>{
      const {entry,folder,file}=await trashEntry(id);
      if(entry.restoredAt)throw new Error('此文稿已恢复。');
      const target=await checked(entry.path);
      await mkdir(dirname(target),{recursive:true});
      try {await copyFile(file,target,constants.COPYFILE_EXCL);}
      catch(error){if(error.code==='EEXIST')throw new Error('原位置已有同名文稿，未覆盖。请先重命名或移走同名文件。');throw error;}
      // Keep the archived copy, even after restoring, as an additional backup.
      await atomic(`${folder}/entry.json`,JSON.stringify({...entry,restoredAt:new Date().toISOString()},null,2));
      return {restored:true,path:entry.path};
    });},
    saveDraft(input) {return sequential(async()=>{const draft=draftSchema.parse(input);await writeJSON('草稿',draft);return {saved:true};});},
    saveSettings(input) {return sequential(async()=>{const settings=settingsSchema.parse(input);await writeJSON('外观',settings);return {settings};});},
    saveRecords(input) {return sequential(async()=>{
      const document=z.object({version:z.literal(1),records:z.array(recordSchema)}).parse(await readJSON('码字记录',{version:1,records:[]}));
      const byId=new Map(document.records.map(item=>[item.id,item]));
      for(const item of input.map(record=>recordSchema.parse(record))) {
        const previous=byId.get(item.id);
        if(previous && (previous.day!==item.day || previous.path!==item.path)) throw new Error('码字记录标识冲突。');
        byId.set(item.id,previous ? {...item,added:Math.max(previous.added,item.added),deleted:Math.max(previous.deleted,item.deleted),activeMs:Math.max(previous.activeMs,item.activeMs),idleMs:Math.max(previous.idleMs,item.idleMs)} : item);
      }
      await writeJSON('码字记录',{version:1,records:[...byId.values()]});return {saved:true};
    });},
    async history(month) {
      await pending;
      const document=z.object({version:z.literal(1),records:z.array(recordSchema)}).parse(await readJSON('码字记录',{version:1,records:[]}));
      return {month,records:document.records.filter(item=>item.day.startsWith(month+'-'))};
    },
  };
}
