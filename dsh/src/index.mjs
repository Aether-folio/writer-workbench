/**
 * 码字工作台 · DSH 宿主半侧（Cordis 插件）
 *
 * 只做三件事：
 *  1. 把 /writer-workbench 路由挂到 DSH webServer；
 *  2. 注册 open_workbench / workbench_status 两个模型可见工具；
 *  3. 通过 context 里的 config.workspace 绑定作品目录。
 *
 * 真正的文件读写与打开状态在 runtime.mjs（可单测），本文件不碰业务逻辑。
 */
import {existsSync, readFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createWorkbenchRuntime, STORAGE_FOLDER} from './runtime.mjs';
import {tool} from './tool.mjs';

export const name = 'writer-workbench';
export const inject = ['webServer', 'tools'];

const PACKAGE_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

function readVersion() {
  try {
    const manifest = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8'));
    return typeof manifest.version === 'string' ? manifest.version : '0.0.0';
  } catch {
    return '0.0.0';
  }
}

export const VERSION = readVersion();

export function apply(ctx, config = {}) {
  const workspacePath = typeof config?.workspace === 'string' && config.workspace.trim() !== ''
    ? resolve(config.workspace)
    : resolve(process.env.WORKBENCH_WORKSPACE || join(PACKAGE_ROOT, '..'));
  const editorPath = typeof config?.editorFile === 'string' && config.editorFile.trim() !== ''
    ? resolve(PACKAGE_ROOT, config.editorFile)
    : join(PACKAGE_ROOT, 'assets', 'editor.html');

  const runtime = createWorkbenchRuntime({workspacePath, editorPath, version: VERSION});
  const dataFolder = join(workspacePath, STORAGE_FOLDER);

  // 同源 + 宿主自身的 Host/Origin 信任围栏；没有 connection 服务时退化为
  // 「只依赖同源浏览器请求」，不影响桌面/Web 两种部署。
  const connection = ctx.get('connection');
  const fence = typeof connection?.requestRejection === 'function'
    ? req => connection.requestRejection(req)
    : undefined;

  ctx.effect(
    () => ctx.webServer.register({
      kind: 'prefix',
      path: runtime.routePrefix,
      handler: (req, res) => runtime.route(req, res, {fence}),
    }),
    'writer-workbench: HTTP routes',
  );

  ctx.effect(() => {
    const disposers = [];

    disposers.push(ctx.tools.register(tool({
      name: 'open_workbench',
      description:
        '在 DeepSeek Harness 中打开「码字工作台」：稿件侧栏与自动保存、选区批注、每日码字日历、'
        + '背景设置和码字悬浮窗。工作台只读写作品目录下的「码字工作台」文件夹，不会改动原有正文。'
        + '打开后会在页面右侧栏新增「码字工作台」标签页，不会遮住对话；用户说“打开码字工作台/写作工作台”时调用本工具。',
      parameters: {type: 'object', properties: {}, additionalProperties: false},
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            opened: {type: 'boolean', description: '是否已登记打开请求。'},
            delivered: {type: 'boolean', description: '页面当前是否在线并会立即打开。'},
            storageFolder: {type: 'string', description: '数据所在的文件夹名。'},
            message: {type: 'string', description: '给用户看的一句话结果。'},
          },
          required: ['opened', 'delivered', 'storageFolder', 'message'],
        },
        render: (_args, value) => [{type: 'text', text: value.message}],
      },
      execute: async (_args, exec) => {
        exec.signal.throwIfAborted();
        const delivered = runtime.clientOnline();
        runtime.state.openCounter += 1;
        runtime.state.openedAt = Date.now();
        return {
          opened: true,
          delivered,
          storageFolder: STORAGE_FOLDER,
          message: delivered
            ? '码字工作台正在打开。数据保存在作品目录的「码字工作台」文件夹。'
            : '已登记打开请求；页面在线后会自动打开码字工作台。',
        };
      },
    })));

    disposers.push(ctx.tools.register(tool({
      name: 'workbench_status',
      description:
        '检查码字工作台在 DeepSeek Harness 中的接入状态：版本、绑定的作品目录、数据文件夹、'
        + '编辑器资源是否存在、页面是否在线，以及工作台里现有的作品和文稿数量。'
        + '不修改任何文件。',
      parameters: {type: 'object', properties: {}, additionalProperties: false},
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            version: {type: 'string'},
            workspace: {type: 'string', description: '作品目录绝对路径。'},
            dataFolder: {type: 'string', description: '「码字工作台」数据目录绝对路径。'},
            storageFolder: {type: 'string'},
            editorReady: {type: 'boolean', description: '编辑器 HTML 资源是否就绪。'},
            clientOnline: {type: 'boolean', description: '页面是否正在轮询工作台状态。'},
            fileCount: {type: 'number', description: '工作台可见的 .md/.txt 数量。'},
            workNames: {type: 'string', description: '作品名，逗号分隔；没有作品时为空。'},
            message: {type: 'string'},
          },
          required: [
            'version',
            'workspace',
            'dataFolder',
            'storageFolder',
            'editorReady',
            'clientOnline',
            'fileCount',
            'workNames',
            'message',
          ],
        },
        render: (_args, value) => [{type: 'text', text: value.message}],
      },
      execute: async (_args, exec) => {
        exec.signal.throwIfAborted();
        const info = await runtime.callApi('workspace_info', {});
        const works = Array.isArray(info?.works) ? info.works : [];
        const files = Array.isArray(info?.files) ? info.files : [];
        const editorReady = existsSync(editorPath);
        const online = runtime.clientOnline();
        const workNames = works.map(work => String(work?.name ?? '')).filter(Boolean).join('、');
        const message = [
          `码字工作台 ${VERSION}`,
          `作品目录：${workspacePath}`,
          `数据目录：${dataFolder}`,
          `编辑器资源：${editorReady ? '就绪' : '缺失（请重新构建插件）'}`,
          `页面连接：${online ? '在线' : '未连接'}`,
          `作品：${works.length ? workNames : '暂无'}；文稿：${files.length} 个`,
        ].join('\n');
        return {
          version: VERSION,
          workspace: workspacePath,
          dataFolder,
          storageFolder: STORAGE_FOLDER,
          editorReady,
          clientOnline: online,
          fileCount: files.length,
          workNames,
          message,
        };
      },
    })));

    return () => {
      for (const dispose of disposers) {
        try {
          if (typeof dispose === 'function') dispose();
        } catch {
          /* 卸载路径不阻塞其它工具释放 */
        }
      }
    };
  }, 'writer-workbench: tools');
}
