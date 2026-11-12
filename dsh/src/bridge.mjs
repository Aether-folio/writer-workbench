/**
 * MCP Apps（ui://）宿主桥 —— 纯函数，便于单测。
 *
 * 原 Codex 插件的 dist/editor.html 是标准 MCP App：它通过 postMessage 向
 * window.parent 发 JSON-RPC（ui/initialize、tools/call、ui/message …）。
 * DSH 侧没有 MCP Apps 宿主，所以这里实现一个最小但完整的宿主：
 *  - 握手：报告 hostInfo / hostCapabilities / hostContext；
 *  - tools/call：转给 DSH 宿主的 /writer-workbench/api；
 *  - ui/message：写进当前会话的聊天草稿（对应 Codex 的 openai/message 扩展）。
 */

export const MCP_APPS_PROTOCOL_VERSION = '2026-01-26';

const OPENAI_MESSAGE_EXTENSION = 'openai/message';

const ok = (id, result) => ({jsonrpc: '2.0', id, result});
const fail = (id, code, message) => ({jsonrpc: '2.0', id, error: {code, message}});
const textOf = error => (error instanceof Error ? error.message : String(error));

/**
 * @param {object} deps
 * @param {(name: string, args: object) => Promise<unknown>} deps.callTool
 * @param {(params: object) => unknown | Promise<unknown>} deps.insertDraft
 * @param {(url: string) => unknown} [deps.openLink]
 * @param {() => object} deps.getHostContext
 * @returns {(message: unknown) => Promise<object | null>}
 */
export function createHostBridge({callTool, insertDraft, openLink, getHostContext}) {
  if (typeof callTool !== 'function') throw new Error('createHostBridge 需要 callTool。');
  if (typeof insertDraft !== 'function') throw new Error('createHostBridge 需要 insertDraft。');
  if (typeof getHostContext !== 'function') throw new Error('createHostBridge 需要 getHostContext。');

  const context = () => {
    const base = getHostContext() ?? {};
    return {
      theme: base.theme === 'dark' ? 'dark' : 'light',
      displayMode: 'fullscreen',
      availableDisplayModes: ['fullscreen', 'inline'],
      locale: typeof base.locale === 'string' && base.locale ? base.locale : 'zh-CN',
      timeZone: typeof base.timeZone === 'string' && base.timeZone ? base.timeZone : 'Asia/Shanghai',
      platform: 'web',
      deviceCapabilities: {touch: false, hover: true},
      containerDimensions: {
        width: Number.isFinite(base.width) ? Math.max(0, Math.round(base.width)) : 0,
        height: Number.isFinite(base.height) ? Math.max(0, Math.round(base.height)) : 0,
      },
      'openai/interactionCursor': 'pointer',
      styles: {variables: {}},
    };
  };

  const hostCapabilities = {
    serverTools: {listChanged: false},
    serverResources: {listChanged: false},
    openLinks: {},
    downloadFile: {},
    logging: {},
    message: {},
    updateModelContext: {},
    experimental: {[OPENAI_MESSAGE_EXTENSION]: {}},
  };

  return async function handle(message) {
    if (message === null || typeof message !== 'object' || message.jsonrpc !== '2.0') return null;
    const method = message.method;
    if (typeof method !== 'string') return null;
    // 通知（没有 id）不需要应答。
    const isRequest = Object.hasOwn(message, 'id') && message.id !== undefined && message.id !== null;
    if (!isRequest) return null;
    const id = message.id;
    const params = message.params !== null && typeof message.params === 'object' ? message.params : {};

    switch (method) {
      case 'ui/initialize':
        return ok(id, {
          protocolVersion: typeof params.protocolVersion === 'string'
            ? params.protocolVersion
            : MCP_APPS_PROTOCOL_VERSION,
          hostInfo: {name: 'DeepSeek Harness', version: '0.2.1'},
          hostCapabilities,
          hostContext: context(),
        });

      case 'tools/call': {
        const toolName = params.name;
        const toolArgs = params.arguments !== null && typeof params.arguments === 'object'
          ? params.arguments
          : {};
        try {
          const structuredContent = await callTool(toolName, toolArgs);
          return ok(id, {content: [], structuredContent});
        } catch (error) {
          return ok(id, {
            content: [{type: 'text', text: textOf(error)}],
            isError: true,
          });
        }
      }

      case 'ui/message':
        try {
          await insertDraft(params);
          return ok(id, {});
        } catch (error) {
          if (typeof console !== 'undefined') console.warn('[writer-workbench] 草稿写入失败：', error);
          return ok(id, {isError: true});
        }

      case 'ui/request-display-mode':
        return ok(id, {mode: 'fullscreen'});

      case 'ui/open-link':
        try {
          if (typeof openLink === 'function') await openLink(String(params.url ?? ''));
          return ok(id, {});
        } catch {
          return ok(id, {isError: true});
        }

      case 'ui/update-model-context':
        return ok(id, {});

      case 'ping':
        return ok(id, {});

      case 'resources/list':
        return ok(id, {resources: []});

      case 'resources/read':
        return fail(id, -32602, '递笔工作台不提供 MCP resources。');

      default:
        return fail(id, -32601, `不支持的方法：${method}`);
    }
  };
}
