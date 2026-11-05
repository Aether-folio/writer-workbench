import {readFile} from 'node:fs/promises';
import {McpServer} from '@modelcontextprotocol/server';
import {serveStdio} from '@modelcontextprotocol/server/stdio';
import {OpenAIExtensions} from '@openai/mcp-extensions/server';
import {z} from 'zod';
import {createWorkspace,draftSchema,recordSchema,statsPreferencesSchema} from './workspace.mjs';
import {resolveWorkspaceSetting} from './workspace-config.mjs';
import {createWritingSchema,publishWritingSchema,updateWritingSchema,writingContextSchema} from './writing-suggestions.mjs';

const URI = 'ui://writer-workbench/editor.html';
const VERSION = '0.4.3';
const workspace=createWorkspace(resolveWorkspaceSetting());
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
    description:'在Codex内打开码字工作台，支持文稿编辑和自动保存、AI 定点插入与可编辑待采纳框、批注重生成、选区聊天引用和码字日历。',
    inputSchema:z.object({}),
    annotations:{readOnlyHint:true, destructiveHint:false, openWorldHint:false},
    _meta:meta,
  }, async () => ({
    content:[{type:'text', text:'码字工作台已准备。在正文光标处点击「AI 插入」填写要求，点击发送或按 Enter 直接发送，Shift+Enter 换行。AI 内容会回到原位置的可编辑待采纳框，支持采纳、批注重生成和不采纳。文稿、草稿和待处理 AI 请求保存在「码字工作台」文件夹中，普通批注仅临时保留。'}],
    structuredContent:{version:VERSION, title:'码字工作台', manuscriptAccess:'workbench-folder-only', draftOnly:false,chatMessage:{target:'active',send:true},storageFolder:'码字工作台'},
  }));
  server.registerTool('workbench_status', {
    title:'检查工作台接入声明',
    description:'返回工作台版本及入口声明；不把服务端声明视为客户端已验证成功。',
    inputSchema:z.object({}),
    annotations:{readOnlyHint:true, destructiveHint:false, openWorldHint:false},
  }, async () => ({
    content:[{type:'text',text:JSON.stringify({version:VERSION, declaredEntrypoints:['global','thread'], resource:URI, chatMessage:{target:'active',send:true}, manuscriptAccess:'workbench-folder-only',storageFolder:'码字工作台',autoSave:true,hostValidation:'required'})}],
  }));
  function appTool(name,title,inputSchema,readOnlyHint,run,destructiveHint=false) {
    server.registerTool(name,{title,description:title+'，仅供码字工作台界面调用，文件范围限定为专用数据文件夹。',inputSchema,outputSchema:z.record(z.string(),z.unknown()),annotations:{readOnlyHint,destructiveHint,openWorldHint:false},_meta:{ui:{visibility:['app']}}},async input=>({content:[],structuredContent:await run(input)}));
  }
  appTool('workspace_info','扫描工作台文件',z.object({}),true,()=>workspace.info());
  appTool('create_writing_request','创建光标位置的 AI 插入请求',createWritingSchema,false,input=>workspace.createWritingRequest(input));
  appTool('writing_requests','同步当前文稿的 AI 待采纳内容',z.object({path:z.string().max(240)}),true,input=>workspace.writingRequests(input));
  appTool('update_writing_request','编辑、重生成、采纳或不采纳 AI 内容',updateWritingSchema,false,input=>workspace.updateWritingRequest(input));
  server.registerTool('get_writing_request',{
    title:'读取 AI 插入请求的定位与上下文',
    description:'收到【码字工作台 · AI 插入请求】消息后必须先调用本工具。按消息原样传入文稿 path 和写作要求 instruction（未命名草稿的 path 为空字符串）。返回隐藏的请求 ID、生成轮次、插入位置前后文和上一版文字。按用户要求生成纯正文，再调用 publish_writing_suggestion 原样传入返回的 requestId、generation；段落间用单个换行，不加空白行。不要在聊天里复述这些技术数据或直接写文稿文件。',
    inputSchema:writingContextSchema,
    annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:false},
  },async input=>({content:[{type:'text',text:JSON.stringify(await workspace.getWritingRequest(input))}]}));
  server.registerTool('publish_writing_suggestion',{
    title:'将 AI 写作内容返回工作台',
    description:'仅在用户明确发起码字工作台 AI 插入/重生成请求后调用。先用 get_writing_request 取得 requestId、generation 和上下文，再把纯正文 text 回传到目标位置的待采纳框。段落间用单个换行，不加空白行。不直接改文稿，用户采纳后才合并。旧版带 ID 的请求可直接按原 ID 回传。',
    inputSchema:publishWritingSchema,
    annotations:{readOnlyHint:false,destructiveHint:false,openWorldHint:false},
  },async input=>({content:[{type:'text',text:JSON.stringify(await workspace.publishWritingSuggestion(input))}]}));
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
