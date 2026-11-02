import {readFile} from 'node:fs/promises';
import {McpServer} from '@modelcontextprotocol/server';
import {serveStdio} from '@modelcontextprotocol/server/stdio';
import {OpenAIExtensions} from '@openai/mcp-extensions/server';
import {z} from 'zod';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {createWorkspace,draftSchema,recordSchema,statsPreferencesSchema} from './workspace.mjs';

const URI = 'ui://writer-workbench/editor.html';
const VERSION = '0.3.0';
const workspace=createWorkspace(process.env.WORKBENCH_WORKSPACE || join(homedir(),'.writer-workbench'));
await workspace.init();
const meta = {
  ui: {resourceUri:URI},
  'openai/ui': {entrypoints:[{type:'global'}, {type:'thread'}]},
};

serveStdio(() => {
  const server = new McpServer({name:'writer-workbench', title:'码字工作台', version:VERSION});
  new OpenAIExtensions(server);
  server.registerResource('workbench-editor', URI, {mimeType:'text/html;profile=mcp-app'}, async () => ({
    contents:[{
      uri:URI,
      mimeType:'text/html;profile=mcp-app',
      text:await readFile(new URL('./editor.html', import.meta.url), 'utf8'),
      _meta:{
        ui:{csp:{connectDomains:[], resourceDomains:[]}},
        'openai/ui':{availableDisplayModes:['fullscreen','inline'], preferredDisplayMode:'fullscreen'},
      },
    }],
  }));
  server.registerTool('open_workbench', {
    title:'码字工作台',
    description:'在Codex内打开码字工作台，支持工作区文稿编辑和自动保存、码字日历、背景设置、选区聊天引用与批注记录。',
    inputSchema:z.object({}),
    annotations:{readOnlyHint:true, destructiveHint:false, openWorldHint:false},
    _meta:meta,
  }, async () => ({
    content:[{type:'text', text:'码字工作台已准备。文稿、草稿、背景设置和每日码字记录保存在工作区的「码字工作台」文件夹中。批注仅临时保留，可汇总添加到聊天草稿。'}],
    structuredContent:{version:VERSION, title:'码字工作台', manuscriptAccess:'workbench-folder-only', draftOnly:true,storageFolder:'码字工作台'},
  }));
  server.registerTool('workbench_status', {
    title:'检查工作台接入声明',
    description:'返回工作台版本及入口声明；不把服务端声明视为客户端已验证成功。',
    inputSchema:z.object({}),
    annotations:{readOnlyHint:true, destructiveHint:false, openWorldHint:false},
  }, async () => ({
    content:[{type:'text',text:JSON.stringify({version:VERSION, declaredEntrypoints:['global','thread'], resource:URI, draftMessage:{target:'active',send:false}, manuscriptAccess:'workbench-folder-only',storageFolder:'码字工作台',autoSave:true,hostValidation:'required'})}],
  }));
  function appTool(name,title,inputSchema,readOnlyHint,run,destructiveHint=false) {
    server.registerTool(name,{title,description:title+'，仅供码字工作台界面调用，文件范围限定为专用数据文件夹。',inputSchema,outputSchema:z.record(z.string(),z.unknown()),annotations:{readOnlyHint,destructiveHint,openWorldHint:false},_meta:{ui:{visibility:['app']}}},async input=>({content:[],structuredContent:await run(input)}));
  }
  appTool('workspace_info','扫描工作台文件',z.object({}),true,()=>workspace.info());
  appTool('create_work','添加作品并创建设定、正文与草稿文件夹',z.object({name:z.string().trim().min(1).max(80)}),false,input=>workspace.createWork(input));
  appTool('stats_preferences','读取码字悬浮窗设置与作品封面',z.object({workPath:z.string().max(80).optional()}),true,input=>workspace.statsPreferences(input));
  appTool('save_stats_preferences','保存码字悬浮窗设置与作品封面',statsPreferencesSchema,false,input=>workspace.saveStatsPreferences(input));
  appTool('read_document','打开工作台文稿',z.object({path:z.string().max(240)}),true,({path})=>workspace.readDocument(path));
  appTool('save_document','保存工作台文稿',z.object({path:z.string().max(240),body:z.string().max(2000000),revision:z.string().regex(/^[a-f0-9]{64}$/).optional()}),false,input=>workspace.saveDocument(input));
  appTool('rename_document','重命名工作台文稿',z.object({path:z.string().max(240),name:z.string().trim().min(1).max(120),revision:z.string().regex(/^[a-f0-9]{64}$/).optional()}),false,input=>workspace.renameDocument(input));
  appTool('rename_folder','重命名工作台文件夹',z.object({path:z.string().max(240),name:z.string().trim().min(1).max(120)}),false,input=>workspace.renameFolder(input));
  appTool('delete_document','将文稿移至回收站',z.object({path:z.string().max(240),revision:z.string().regex(/^[a-f0-9]{64}$/)}),false,input=>workspace.deleteDocument(input),true);
  appTool('list_trash','读取文稿回收站',z.object({}),true,()=>workspace.listTrash());
  appTool('delete_trash','彻底删除回收站文稿',z.object({id:z.string().uuid()}),false,input=>workspace.deleteTrash(input),true);
  appTool('restore_document','恢复回收站文稿',z.object({id:z.string().uuid()}),false,input=>workspace.restoreDocument(input));
  appTool('save_draft','保存未命名草稿',draftSchema,false,input=>workspace.saveDraft(input));
  appTool('save_settings','保存背景设置',z.object({background:z.string().regex(/^#[0-9a-f]{6}$/i)}),false,input=>workspace.saveSettings(input));
  appTool('save_writing_records','保存每日码字记录',z.object({records:z.array(recordSchema).max(200)}),false,({records})=>workspace.saveRecords(records));
  appTool('writing_history','读取码字日历',z.object({month:z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/)}),true,({month})=>workspace.history(month));
  return server;
});
