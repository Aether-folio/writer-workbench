/**
 * 码字工作台 · DSH 宿主运行时（与 Cordis / MCP 无关，可直接单测）
 *
 * 职责：
 *  - 复用 Codex 插件的 src/workspace.mjs，把同一套 workspace_* 工具暴露成
 *    同源 HTTP 接口（/writer-workbench/api）；
 *  - 提供 /writer-workbench/editor.html，把原 MCP App 的 HTML 直接交给
 *    DSH 客户端 iframe 渲染；
 *  - 维护「打开工作台」请求计数，客户端轮询后打开面板。
 *
 * 这里不 import 任何 @deepseek-ai/*，因此可以在普通 Node 进程里测试；
 * Cordis 的 webServer / tools 注册在 index.mjs 完成。
 */
import {readFile, stat} from 'node:fs/promises';
import {basename} from 'node:path';
import {createWorkspace} from '../../src/workspace.mjs';

/** 与 Codex 版保持一致的存储目录名（不迁移、不改名）。 */
export const STORAGE_FOLDER = '码字工作台';

/** 单次 API 请求体上限：封面约 3 MB、正文上限 2 MB，留足 JSON 余量。 */
export const MAX_BODY_BYTES = 12 * 1024 * 1024;

/** 客户端轮询间隔（毫秒），同时用于判断「页面是否在线」。 */
export const POLL_INTERVAL_MS = 1500;
export const CLIENT_ONLINE_WINDOW_MS = 5000;

/**
 * 允许从界面调用的工具白名单。名称与 Codex 版 server.mjs 完全一致，
 * 因此原 editor.html 里写死的 callTool('workspace_info', …) 等无需改动。
 */
function createApi(workspace) {
  return {
    workspace_info: () => workspace.info(),
    create_writing_request: input => workspace.createWritingRequest(input),
    writing_requests: input => workspace.writingRequests(input),
    get_writing_request: input => workspace.getWritingRequest(input),
    update_writing_request: input => workspace.updateWritingRequest(input),
    publish_writing_suggestion: input => workspace.publishWritingSuggestion(input),
    create_work: input => workspace.createWork(input),
    stats_preferences: input => workspace.statsPreferences(input ?? {}),
    save_stats_preferences: input => workspace.saveStatsPreferences(input),
    read_document: input => workspace.readDocument(input?.path),
    save_document: input => workspace.saveDocument(input),
    rename_document: input => workspace.renameDocument(input),
    rename_folder: input => workspace.renameFolder(input),
    delete_document: input => workspace.deleteDocument(input),
    list_trash: () => workspace.listTrash(),
    delete_trash: input => workspace.deleteTrash(input),
    restore_document: input => workspace.restoreDocument(input),
    save_draft: input => workspace.saveDraft(input),
    save_settings: input => workspace.saveSettings(input),
    save_writing_records: input => workspace.saveRecords(input?.records),
    writing_history: input => workspace.history(input?.month),
  };
}

/** 读取请求体；超过上限时拒绝并停止接收。 */
function readBody(req, limit = MAX_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let settled = false;
    const chunks = [];
    const fail = error => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    req.on('data', chunk => {
      if (settled) return;
      size += chunk.length;
      if (size > limit) {
        const error = new Error('请求内容过大。');
        error.status = 413;
        fail(error);
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks).toString('utf8'));
    });
    req.on('error', fail);
    req.on('aborted', () => fail(Object.assign(new Error('请求已中断。'), {status: 499})));
  });
}

function sendJson(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(body);
}

function sendText(res, status, text, contentType = 'text/plain; charset=utf-8') {
  res.writeHead(status, {
    'content-type': contentType,
    'content-length': Buffer.byteLength(text),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(text);
}

/** 把原 MCP App 里写死的 Codex 文案换成 DSH，不动源文件。 */
function adaptEditorHtml(html) {
  return html
    .replaceAll('正在连接 Codex…', '正在连接 DSH…')
    .replaceAll('连接 Codex', '连接 DSH')
    .replaceAll('Codex内', 'DSH 内');
}

/**
 * 创建一台工作台运行时。
 * @param {object} options
 * @param {string} options.workspacePath 作品目录（其下写入「码字工作台/」）
 * @param {string} options.editorPath 打包后的 editor.html 绝对路径
 * @param {string} options.version 插件版本（显示/健康检查用）
 * @param {string} [options.routePrefix] 路由前缀，默认 /writer-workbench
 */
export function createWorkbenchRuntime({
  workspacePath,
  editorPath,
  version,
  routePrefix = '/writer-workbench',
} = {}) {
  if (typeof workspacePath !== 'string' || workspacePath.trim() === '') {
    throw new Error('码字工作台缺少 workspace 配置。');
  }
  if (typeof editorPath !== 'string' || editorPath.trim() === '') {
    throw new Error('码字工作台缺少 editorPath 配置。');
  }
  const workspace = createWorkspace(workspacePath);
  const api = createApi(workspace);
  const apiNames = Object.freeze(Object.keys(api));
  const state = {openCounter: 0, openedAt: 0, lastPollAt: 0};
  let editorCache;
  let editorStamp;
  let initPromise;

  const ensureInit = () => {
    initPromise ??= workspace.init().catch(error => {
      initPromise = undefined;
      throw error;
    });
    return initPromise;
  };

  const clientOnline = () => state.lastPollAt > 0 && Date.now() - state.lastPollAt < CLIENT_ONLINE_WINDOW_MS;

  async function loadEditor() {
    // Re-read the HTML when the file changes on disk, so a rebuild only needs a
    // page reload (or a fresh workbench tab) instead of restarting the app.
    let stamp;
    try {
      const info = await stat(editorPath);
      stamp = `${info.mtimeMs}:${info.size}`;
    } catch (error) {
      throw editorError(error);
    }
    if (editorCache === undefined || stamp !== editorStamp) {
      let html;
      try {
        html = await readFile(editorPath, 'utf8');
      } catch (error) {
        throw editorError(error);
      }
      editorCache = adaptEditorHtml(html);
      editorStamp = stamp;
    }
    return editorCache;
  }

  function editorError(cause) {
    const wrapped = new Error(
      `码字工作台编辑器资源缺失：${editorPath}。请先在插件目录运行 npm run build。`,
      {cause},
    );
    wrapped.status = 500;
    return wrapped;
  }

  async function callApi(name, args) {
    if (typeof name !== 'string' || !Object.hasOwn(api, name)) {
      throw Object.assign(new Error(`未知的工作台接口：${String(name)}`), {status: 400});
    }
    if (args !== undefined && args !== null && (typeof args !== 'object' || Array.isArray(args))) {
      throw Object.assign(new Error('接口参数必须是对象。'), {status: 400});
    }
    await ensureInit();
    return await api[name](args ?? {});
  }

  /**
   * 处理一个 HTTP 请求。
   * @param {import('node:http').IncomingMessage} req
   * @param {import('node:http').ServerResponse} res
   * @param {{fence?: (req: import('node:http').IncomingMessage) => number | undefined}} [options]
   */
  async function route(req, res, {fence} = {}) {
    try {
      if (typeof fence === 'function') {
        const rejection = fence(req);
        if (rejection !== undefined) {
          sendText(res, rejection, rejection === 403 ? 'forbidden' : 'unauthorized');
          return;
        }
      }
      const url = new URL(req.url ?? '/', 'http://dsh.internal');
      const rest = url.pathname.startsWith(routePrefix)
        ? url.pathname.slice(routePrefix.length)
        : undefined;
      if (rest === undefined) {
        sendText(res, 404, 'not found');
        return;
      }
      const method = (req.method ?? 'GET').toUpperCase();

      if (method === 'GET' && (rest === '' || rest === '/' || rest === '/editor.html')) {
        sendText(res, 200, await loadEditor(), 'text/html; charset=utf-8');
        return;
      }

      if (method === 'GET' && rest === '/health') {
        sendJson(res, 200, {
          ok: true,
          version,
          storageFolder: STORAGE_FOLDER,
          workspaceName: basename(workspacePath),
          clientOnline: clientOnline(),
        });
        return;
      }

      if (method === 'GET' && rest === '/state') {
        state.lastPollAt = Date.now();
        sendJson(res, 200, {
          version,
          openCounter: state.openCounter,
          pollIntervalMs: POLL_INTERVAL_MS,
          storageFolder: STORAGE_FOLDER,
        });
        return;
      }

      if (method === 'POST' && rest === '/open') {
        state.openCounter += 1;
        state.openedAt = Date.now();
        sendJson(res, 200, {
          ok: true,
          openCounter: state.openCounter,
          delivered: clientOnline(),
        });
        return;
      }

      if (method === 'POST' && rest === '/api') {
        let body;
        try {
          body = JSON.parse(await readBody(req));
        } catch (error) {
          if (error.status === 413) {
            sendJson(res, 413, {ok: false, error: error.message});
          } else {
            sendJson(res, 400, {ok: false, error: '请求内容不是合法 JSON。'});
          }
          return;
        }
        const name = body?.name;
        const args = body?.args;
        try {
          const result = await callApi(name, args);
          sendJson(res, 200, {ok: true, result});
        } catch (error) {
          const status = Number.isInteger(error?.status) ? error.status : 400;
          sendJson(res, status, {
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          });
        }
        return;
      }

      if (rest === '/state' || rest === '/open' || rest === '/api' || rest === '/health' || rest === '/editor.html') {
        sendJson(res, 405, {ok: false, error: 'method not allowed'});
        return;
      }

      sendText(res, 404, 'not found');
    } catch (error) {
      try {
        if (!res.headersSent) {
          sendJson(res, error?.status ?? 500, {
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          });
        } else {
          res.destroy();
        }
      } catch {
        try {
          res.destroy();
        } catch {
          /* 连接已断开，无需再处理 */
        }
      }
    }
  }

  return {
    workspace,
    state,
    route,
    callApi,
    apiNames,
    clientOnline,
    routePrefix,
  };
}
