/**
 * 码字工作台 · DSH 客户端半侧（浏览器 bundle）
 *
 * 界面仍然复用 Codex 版打包好的 editor.html（标准 MCP App），但不再做全屏
 * 遮罩，而是注册成 **DSH 原生右侧栏的一个标签页**：
 *   - 会话标题栏 utilities 增加「✎ 码字」按钮；
 *   - 右侧栏标签页里用 iframe 加载 /writer-workbench/editor.html；
 *   - open_workbench 工具通过 openCounter 通知页面，页面调用 sidebarRight.openTab；
 *   - 原生标签页自带关闭按钮，右侧栏也可折叠，不会再出现“全屏盖住退不出”。
 *
 * 本文件由 esbuild 打成 IIFE；react 从 __ModuleLoader__ 的 factory require 取得。
 */
import {createHostBridge} from './bridge.mjs';

const PLUGIN_ID = 'dsh-writer-workbench';
const VERSION = '0.3.0-dsh.3';

/** 右侧栏标签类型的稳定标识（同时是 body/title 槽位的 key）。 */
const TAB_ID = 'dsh-writer-workbench:writer-workbench';
const TAB_KIND = 'writer-workbench';

const CSS = `
.dww-header-btn{appearance:none;display:inline-flex;align-items:center;gap:6px;height:28px;padding:0 10px;border:1px solid var(--dsw-alias-border-secondary,rgba(130,140,160,.35));border-radius:7px;background:transparent;color:var(--dsw-alias-label-primary,#e9eaf0);font:12px/1 ui-sans-serif,system-ui,"Microsoft YaHei",sans-serif;cursor:pointer;white-space:nowrap}
.dww-header-btn:hover{background:var(--dsw-alias-bg-layer-3,#2a3040);border-color:var(--dsw-alias-state-business-primary,#4176e6)}
.dww-header-btn:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,#4176e6);outline-offset:1px}
.dww-header-icon{font-size:14px;line-height:1}
.dww-side{height:100%;width:100%;min-height:0;display:flex;background:var(--dsw-alias-bg-base,#111318)}
.dww-side-frame{flex:1 1 auto;width:100%;height:100%;min-height:0;border:0;display:block;background:#fffdf8}
`;

const SAFE_PROTOCOL = /^https?:\/\//i;

function safeGet(ctx, name) {
  try {
    return typeof ctx?.get === 'function' ? ctx.get(name) : undefined;
  } catch {
    return undefined;
  }
}

function isDarkTheme() {
  try {
    if (document.body?.hasAttribute('data-ds-dark-theme')) return true;
    const declared = document.documentElement?.getAttribute('data-theme');
    if (declared === 'dark' || declared === 'light') return declared === 'dark';
    return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches;
  } catch {
    return false;
  }
}

/** 打开右侧栏里的码字工作台标签页；右侧栏会同时展开。 */
function openWorkbenchTab(ctx) {
  const api = safeGet(ctx, 'sidebarRight');
  if (api === undefined || api === null || typeof api.openTab !== 'function') {
    console.warn('[writer-workbench] 当前宿主没有 sidebarRight.openTab，无法打开右侧栏。');
    return false;
  }
  try {
    api.openTab(TAB_KIND);
    return true;
  } catch (error) {
    // 没有活动会话时右侧栏还没有可写 store；等下一次轮询重试，不吞掉原因。
    console.warn('[writer-workbench] 打开右侧栏失败：', error);
    return false;
  }
}

/** 当前屏幕上的会话；DSH 没有「current session」字段，只能读右栏的 mounted 观察值。 */
function currentSessionId(ctx) {
  const right = safeGet(ctx, 'sidebarRight');
  const mounted = right?.mounted?.getSnapshot?.();
  if (typeof mounted === 'string' && mounted !== '') return mounted;
  const sessions = safeGet(ctx, 'sessions');
  const snapshot = sessions?.list?.getSnapshot?.();
  const ids = Array.isArray(snapshot?.ids) ? snapshot.ids : Object.keys(snapshot?.byId ?? {});
  return ids.length === 1 ? ids[0] : undefined;
}

function draftText(params) {
  const content = Array.isArray(params?.content) ? params.content : [];
  return content
    .filter(item => item !== null && typeof item === 'object' && item.type === 'text' && typeof item.text === 'string')
    .map(item => item.text)
    .join('\n');
}

function focusComposer() {
  try {
    const column = document.querySelector('#root [data-slot="conversation"]');
    const target = column?.querySelector('textarea[data-phase]')
      ?? column?.querySelector('[contenteditable="true"]')
      ?? document.querySelector('textarea[data-phase]')
      ?? document.querySelector('[contenteditable="true"]');
    target?.focus?.();
  } catch {
    /* 没有输入框时只保留草稿内容 */
  }
}

/** 把工作台的选区/批注写进当前会话的聊天草稿（等价于 Codex 的 openai/message, send:false）。 */
function appendDraft(ctx, params) {
  const text = draftText(params);
  if (text.trim() === '') throw new Error('没有可添加的文字。');
  const meta = params?._meta?.['openai/message'];
  if (meta !== null && typeof meta === 'object' && meta.send === true) {
    throw new Error('DSH 版码字工作台只支持添加到聊天草稿，不会自动发送。');
  }
  const sessionId = currentSessionId(ctx);
  if (sessionId === undefined) throw new Error('没有活动的会话，请先打开一个对话。');
  const sessions = safeGet(ctx, 'sessions');
  const scope = sessions?.scope?.(sessionId);
  if (scope === undefined) throw new Error('当前会话尚未就绪，请稍后再试。');
  const conversation = safeGet(ctx, 'conversation');
  const input = conversation?.input?.for?.(scope);
  if (input === undefined || input === null) throw new Error('宿主没有提供聊天输入框。');
  const current = String(input.state?.getSnapshot?.().draft ?? '');
  const next = current.trim() === '' ? text : current.replace(/\s+$/, '') + '\n\n' + text;
  input.setDraft(next);
  focusComposer();
}

function makeFactory() {
  return require => {
    const React = require('react');
    const {useEffect, useMemo, useRef} = React;
    const h = React.createElement;

    /** 右侧栏标签页的正文：只放 iframe，标签条自带关闭按钮。 */
    function WorkbenchTabBody({ctx}) {
      const frameRef = useRef(null);

      const bridge = useMemo(() => createHostBridge({
        callTool: async (name, args) => {
          const response = await fetch('/writer-workbench/api', {
            method: 'POST',
            headers: {'content-type': 'application/json'},
            credentials: 'same-origin',
            cache: 'no-store',
            body: JSON.stringify({name, args}),
          });
          let body;
          try {
            body = await response.json();
          } catch {
            throw new Error(`工作台接口返回了无法解析的内容（HTTP ${response.status}）。`);
          }
          if (!response.ok || body?.ok !== true) {
            throw new Error(typeof body?.error === 'string' ? body.error : `工作台接口失败（HTTP ${response.status}）。`);
          }
          return body.result;
        },
        insertDraft: params => appendDraft(ctx, params),
        openLink: url => {
          if (SAFE_PROTOCOL.test(url)) window.open(url, '_blank', 'noopener,noreferrer');
        },
        getHostContext: () => {
          const frame = frameRef.current;
          return {
            theme: isDarkTheme() ? 'dark' : 'light',
            width: frame?.clientWidth ?? 0,
            height: frame?.clientHeight ?? 0,
            locale: document.documentElement?.lang || 'zh-CN',
            timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          };
        },
      }), [ctx]);

      // iframe 发来的 JSON-RPC：只接受当前 iframe 的消息。
      useEffect(() => {
        const onMessage = async event => {
          const frame = frameRef.current;
          if (frame === null || frame.contentWindow === null) return;
          if (event.source !== frame.contentWindow) return;
          let response;
          try {
            response = await bridge(event.data);
          } catch (error) {
            console.warn('[writer-workbench] 宿主桥处理失败：', error);
            return;
          }
          if (response !== null) frame.contentWindow.postMessage(response, window.location.origin);
        };
        window.addEventListener('message', onMessage);
        return () => window.removeEventListener('message', onMessage);
      }, [bridge]);

      useEffect(() => {
        const frame=frameRef.current;if(!frame)return undefined;
        let previous;
        const send=()=>{
          const bounds=frame.getBoundingClientRect();
          const active=bounds.width>=window.innerWidth-32 && bounds.height>=window.innerHeight-120;
          if(active===previous)return;previous=active;
          frame.contentWindow?.postMessage({method:'workbench/fullscreen',params:{active}},window.location.origin);
        };
        const observer=new ResizeObserver(send);observer.observe(frame);
        const onLoad=()=>{previous=undefined;send();};
        frame.addEventListener('load',onLoad);window.addEventListener('resize',send);
        return ()=>{observer.disconnect();frame.removeEventListener('load',onLoad);window.removeEventListener('resize',send);};
      }, []);

      // 跟随 DSH 明暗主题。
      useEffect(() => {
        if (typeof MutationObserver !== 'function') return undefined;
        const send = () => {
          const frame = frameRef.current;
          if (frame === null || frame.contentWindow === null) return;
          frame.contentWindow.postMessage({
            jsonrpc: '2.0',
            method: 'ui/notifications/host-context-changed',
            params: {theme: isDarkTheme() ? 'dark' : 'light'},
          }, window.location.origin);
        };
        const observer = new MutationObserver(send);
        observer.observe(document.body, {attributes: true, attributeFilter: ['data-ds-dark-theme', 'class']});
        return () => observer.disconnect();
      }, []);

      return h('div', {className: 'dww-side'},
        h('iframe', {
          ref: frameRef,
          className: 'dww-side-frame',
          title: '码字工作台',
          src: '/writer-workbench/editor.html?v=' + encodeURIComponent(VERSION),
          allow: 'clipboard-write',
        }),
      );
    }

    /** 输入框右侧的入口按钮。 */
    function EntryButton({ctx}) {
      return h('button', {
        type: 'button',
        className: 'dww-header-btn',
        title: '在右侧栏打开码字工作台',
        'aria-label': '打开码字工作台',
        onClick: () => { openWorkbenchTab(ctx); },
      },
      h('span', {className: 'dww-header-icon', 'aria-hidden': 'true'}, '✎'),
      h('span', null, '码字'),
      );
    }

    /**
     * 无界面的打开请求观察器：open_workbench 工具递增 openCounter，
     * 这里轮询到变化就调用 sidebarRight.openTab。没有会话时保留计数，
     * 下一拍重试（打开会话后仍然能自动展开）。
     */
    function OpenWatcher({ctx}) {
      useEffect(() => {
        let stopped = false;
        let seen = null;
        const tick = async () => {
          if (stopped || document.visibilityState === 'hidden') return;
          try {
            const response = await fetch('/writer-workbench/state', {
              credentials: 'same-origin',
              cache: 'no-store',
            });
            if (!response.ok) return;
            const snapshot = await response.json();
            const counter = Number(snapshot?.openCounter);
            if (!Number.isFinite(counter)) return;
            if (seen === null) {
              seen = counter;
              return;
            }
            if (counter > seen) {
              // 打不开（例如当前没有活动会话）就保留 seen，下一拍重试。
              if (openWorkbenchTab(ctx)) seen = counter;
            } else if (counter < seen) {
              // 宿主重启过：只同步基线，不误开。
              seen = counter;
            }
          } catch {
            /* 网络抖动下一拍再试 */
          }
        };
        void tick();
        const timer = setInterval(tick, 1500);
        return () => {
          stopped = true;
          clearInterval(timer);
        };
      }, [ctx]);
      return null;
    }

    const name = PLUGIN_ID;
    const inject = ['slots'];

    function apply(ctx) {
      // 样式只注入一次；HMR/插件卸载时移除。
      ctx.effect(() => {
        if (typeof document === 'undefined') return () => {};
        const style = document.createElement('style');
        style.setAttribute('data-dsh-writer-workbench', '');
        style.textContent = CSS;
        document.head.appendChild(style);
        return () => style.remove();
      }, 'writer-workbench: styles');

      // 页面上没有视觉元素，只负责轮询宿主工具发出的打开请求。
      ctx.slots.inject('shell.overlay', function* () {
        yield ctx.slots.register(
          {name: 'shell.overlay', id: 'writer-workbench-watcher', order: 900},
          () => h(OpenWatcher, {ctx}),
        );
      });

      // 输入框右侧入口：新会话/已有会话都渲染，不依赖标题栏是否出现。
      ctx.slots.inject('conversation.input.right', function* () {
        yield ctx.slots.register(
          {
            name: 'conversation.input.right',
            id: 'writer-workbench-entry',
            order: 10,
            registrant: 'dsh-writer-workbench',
          },
          () => h(EntryButton, {ctx}),
        );
      });

      // 等服务出现后再注册右侧栏标签类型；body 槽位与类型一起释放。
      ctx.inject(['sidebarRightTabs'], scoped => {
        const tabs = scoped.get('sidebarRightTabs');
        if (tabs === undefined || tabs === null || typeof tabs.register !== 'function') return;
        ctx.effect(() => {
          const disposeType = tabs.register({
            id: TAB_ID,
            kind: TAB_KIND,
            keepMounted: true,
            priority: 'extension',
            title: () => '码字工作台',
            guide: [{
              id: 'writer-workbench',
              order: 20,
              title: () => '码字工作台',
              description: () => '写作、批注与码字日历',
            }],
          });
          let disposeBody;
          try {
            disposeBody = ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
              name: 'sidebar.right.pane.tab',
              key: TAB_ID,
            }, () => h(WorkbenchTabBody, {ctx})));
          } catch (error) {
            if (typeof disposeType === 'function') disposeType();
            throw error;
          }
          return () => {
            if (typeof disposeBody === 'function') disposeBody();
            if (typeof disposeType === 'function') disposeType();
          };
        }, 'writer-workbench: native sidebar tab');
      });
    }

    return {name, inject, apply};
  };
}

window.__ModuleLoader__.load({
  id: PLUGIN_ID,
  factory: makeFactory(),
});
