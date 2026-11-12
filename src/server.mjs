import {readFile} from 'node:fs/promises';
import {McpServer} from '@modelcontextprotocol/server';
import {serveStdio} from '@modelcontextprotocol/server/stdio';
import {OpenAIExtensions} from '@openai/mcp-extensions/server';
import {z} from 'zod';
import {createWorkspace,draftSchema,recordSchema,statsPreferencesSchema,settingsSchema} from './workspace.mjs';
import {resolveWorkspaceSetting} from './workspace-config.mjs';
import {createWritingSchema,publishWritingSchema,stageChatEditsSchema,updateWritingSchema,writingContextSchema} from './writing-suggestions.mjs';
import {progressWorkSchema,progressJobSchema,progressAgentTools} from './work-progress.mjs';
import {handwritingFontSchema,readHandwritingFont} from './handwriting-fonts.mjs';

const URI = 'ui://writer-workbench/editor.html';
const VERSION = '0.5.2';
const workspace=createWorkspace(resolveWorkspaceSetting());
await workspace.init();
const meta = {
  ui: {resourceUri:URI},
  'openai/ui': {entrypoints:[{type:'global'}, {type:'thread'}]},
};

serveStdio(() => {
  const server = new McpServer({name:'writer-workbench', title:'递笔工作台', version:VERSION});
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
    title:'递笔工作台',
    description:'在Codex内打开递笔工作台，支持文稿自动保存、递笔与持久批注、原位补写和改写对照、历史恢复、整本搜索和码字日历。',
    inputSchema:z.object({}),
    annotations:{readOnlyHint:true, destructiveHint:false, openWorldHint:false},
    _meta:meta,
  }, async () => ({
    content:[{type:'text', text:'递笔工作台已准备。选区或光标处点击「递笔」填写要求，可以暂存为原位批注，或发送到聊天。Enter 发送，Shift+Enter 换行。补写和改写返回原位淡背景建议，可编辑、对照、采纳或再递笔；讨论不改正文。批注与历史保存在本地。'}],
    structuredContent:{version:VERSION, title:'递笔工作台', manuscriptAccess:'workbench-folder-only', draftOnly:false,chatMessage:{target:'active',send:true},storageFolder:'码字工作台',workProgress:true},
  }));
  server.registerTool('workbench_status', {
    title:'检查工作台接入声明',
    description:'返回工作台版本及入口声明；不把服务端声明视为客户端已验证成功。',
    inputSchema:z.object({}),
    annotations:{readOnlyHint:true, destructiveHint:false, openWorldHint:false},
  }, async () => ({
    content:[{type:'text',text:JSON.stringify({version:VERSION, declaredEntrypoints:['global','thread'], resource:URI, chatMessage:{target:'active',send:true}, manuscriptAccess:'workbench-folder-only',storageFolder:'码字工作台',autoSave:true,workProgress:true,hostValidation:'required'})}],
  }));
  function appTool(name,title,inputSchema,readOnlyHint,run,destructiveHint=false) {
    server.registerTool(name,{title,description:title+'，仅供递笔工作台界面调用，文件范围限定为专用数据文件夹。',inputSchema,outputSchema:z.record(z.string(),z.unknown()),annotations:{readOnlyHint,destructiveHint,openWorldHint:false},_meta:{ui:{visibility:['app']}}},async input=>({content:[],structuredContent:await run(input)}));
  }
  appTool('workspace_info','扫描工作台文件',z.object({}),true,()=>workspace.info());
  appTool('read_handwriting_font','载入本地手写字体',handwritingFontSchema,true,readHandwritingFont);
  appTool('start_work_progress','对比正文与已有章节进度',progressWorkSchema,false,workspace.progress.start);
  appTool('work_progress_status','查看章节整理进度',progressWorkSchema,true,workspace.progress.status);
  appTool('cancel_work_progress','停止章节整理',progressJobSchema,false,workspace.progress.cancel);
  for(const {name,description,schema,method,readOnly} of progressAgentTools)
    server.registerTool(name,{description,inputSchema:schema,annotations:{readOnlyHint:readOnly,destructiveHint:false,openWorldHint:false}},
      async input=>({content:[{type:'text',text:JSON.stringify(await workspace.progress[method](input))}]}));
  appTool('create_writing_request','创建递笔或暂存批注',createWritingSchema,false,input=>workspace.createWritingRequest(input));
  appTool('writing_requests','同步递笔、暂存批注与建议',z.object({path:z.string().max(240),history:z.boolean().optional(),allDrafts:z.boolean().optional()}),true,input=>workspace.writingRequests(input));
  appTool('update_writing_request','编辑、重生成、采纳或不采纳 AI 内容',updateWritingSchema,false,input=>workspace.updateWritingRequest(input));
  server.registerTool('get_writing_request',{
    title:'读取递笔的定位与上下文',
    description:'收到【递笔工作台 · 递笔】、旧标题「【码字工作台 · 递笔】」或旧 AI 插入消息后，逐项按文稿 path 和要求 instruction 调用本工具（草稿 path 为空）。读取隐藏定位、选区、前后文、参考资料和上一版。同一路径和要求对应多处时返回 requests 数组，逐个使用各自 requestId/generation 处理，不合并结果。仅讨论时用 mode=discussion 回传讨论结果并在聊天正常回答；明确要求补写用 mode=insert，明确要求改写选区用 mode=replace。生成正文时只回传纯正文，段落单换行；原样使用 requestId 与 generation，不直接写文件、不向聊天贴技术数据。',
    inputSchema:writingContextSchema,
    annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:false},
  },async input=>({content:[{type:'text',text:JSON.stringify(await workspace.getWritingRequest(input))}]}));
  server.registerTool('publish_writing_suggestion',{
    title:'将 AI 写作内容返回工作台',
    description:'完成递笔后回传结果。必须先读取定位，按用户意图设置 mode：discussion 仅讨论，不改正文；insert 在光标或选区末尾补写；replace 改写选中范围。仅用户明确要求正文补写/改写才返回正文建议，用户采纳后保存。text 为纯正文或讨论答复，段落单换行，requestId/generation 原样回传。',
    inputSchema:publishWritingSchema,
    annotations:{readOnlyHint:false,destructiveHint:false,openWorldHint:false},
  },async input=>({content:[{type:'text',text:JSON.stringify(await workspace.publishWritingSuggestion(input))}]}));
  server.registerTool('stage_chat_edits',{
    title:'从聊天把正文改稿放入递笔',
    description:'用户在聊天里要求修改递笔工作台正文时，读取现稿并调用本工具。无需用户先选中文字。按文稿传入每处唯一的逐字原文与纯正文改稿，保留其他原文。每处在工作台独立标红、对照、采纳或取消。这里只保存待采纳建议，不写正文文件；禁止用直接写文件代替。用户只讨论或审查时不提交。',
    inputSchema:stageChatEditsSchema,
    annotations:{readOnlyHint:false,destructiveHint:false,openWorldHint:false},
  },async input=>({content:[{type:'text',text:JSON.stringify(await workspace.stageChatEdits(input))}]}));
  appTool('create_work','添加作品并创建设定、正文与草稿文件夹',z.object({name:z.string().trim().min(1).max(80)}),false,input=>workspace.createWork(input));
  appTool('create_volume','在作品正文下新建卷',z.object({workPath:z.string().max(80),name:z.string().trim().min(1).max(80)}),false,input=>workspace.createVolume(input));
  appTool('prepare_work_volumes','将散放的正文章节归入第一卷',z.object({workPath:z.string().max(80)}),false,input=>workspace.prepareWorkVolumes(input));
  appTool('stats_preferences','读取码字统计设置与作品封面',z.object({workPath:z.string().max(80).optional()}),true,input=>workspace.statsPreferences(input));
  appTool('save_stats_preferences','保存码字统计设置与作品封面',statsPreferencesSchema,false,input=>workspace.saveStatsPreferences(input));
  appTool('read_document','打开工作台文稿',z.object({path:z.string().max(240)}),true,({path})=>workspace.readDocument(path));
  appTool('save_document','保存工作台文稿',z.object({path:z.string().max(240),body:z.string().max(2000000),revision:z.string().regex(/^[a-f0-9]{64}$/).optional()}),false,input=>workspace.saveDocument(input));
  appTool('rename_document','重命名工作台文稿',z.object({path:z.string().max(240),name:z.string().trim().min(1).max(120),revision:z.string().regex(/^[a-f0-9]{64}$/).optional()}),false,input=>workspace.renameDocument(input));
  appTool('rename_folder','重命名工作台文件夹',z.object({path:z.string().max(240),name:z.string().trim().min(1).max(120)}),false,input=>workspace.renameFolder(input));
  appTool('delete_document','将文稿移至回收站',z.object({path:z.string().max(240),revision:z.string().regex(/^[a-f0-9]{64}$/)}),false,input=>workspace.deleteDocument(input),true);
  appTool('list_trash','读取文稿回收站',z.object({}),true,()=>workspace.listTrash());
  appTool('delete_trash','彻底删除回收站文稿',z.object({id:z.string().uuid()}),false,input=>workspace.deleteTrash(input),true);
  appTool('restore_document','恢复回收站文稿',z.object({id:z.string().uuid()}),false,input=>workspace.restoreDocument(input));
  appTool('save_draft','保存未命名草稿',draftSchema,false,input=>workspace.saveDraft(input));
  appTool('save_settings','保存阅读排版设置',settingsSchema.partial(),false,input=>workspace.saveSettings(input));
  appTool('writing_version','读取递笔历史版本',z.object({id:z.string().uuid(),versionId:z.string().uuid()}),true,input=>workspace.writingVersion(input));
  appTool('list_backups','查看当前文稿备份',z.object({path:z.string().max(240)}),true,input=>workspace.listBackups(input));
  appTool('read_backup','预览备份',z.object({id:z.string().max(240)}),true,input=>workspace.readBackup(input));
  appTool('restore_backup','恢复备份并备份当前正文',z.object({id:z.string().max(240),path:z.string().max(240),revision:z.string()}),false,input=>workspace.restoreBackup(input));
  appTool('prune_backups','按保留数量清理当前文稿备份',z.object({path:z.string().max(240),keep:z.number().int().min(1).max(1000)}),false,input=>workspace.pruneBackups(input),true);
  appTool('reading_position','保存或恢复阅读位置',z.object({path:z.string().max(240),position:z.object({start:z.number().int().nonnegative(),end:z.number().int().nonnegative(),scrollTop:z.number().nonnegative()}).optional()}),false,input=>workspace.readingPosition(input));
  appTool('search_documents','搜索整部作品',z.object({workPath:z.string().max(240).optional(),query:z.string().min(1).max(200),offset:z.number().int().nonnegative().optional(),limit:z.number().int().min(1).max(200).optional()}),true,input=>workspace.searchDocuments(input));
  appTool('save_writing_records','保存每日码字记录',z.object({records:z.array(recordSchema).max(200)}),false,({records})=>workspace.saveRecords(records));
  appTool('writing_history','读取码字日历',z.object({month:z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/)}),true,({month})=>workspace.history(month));
  return server;
});
