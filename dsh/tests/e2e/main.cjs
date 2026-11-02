/**
 * 真实 Chromium 冒烟测试（Electron 24，不需要 Playwright）。
 *
 * 验证链路：
 *   editor.html（原 Codex MCP App）
 *     → postMessage JSON-RPC
 *     → dsh/src/bridge.mjs（DSH 的 MCP Apps 宿主）
 *     → /writer-workbench/api
 *     → workspace.mjs
 *     → 界面渲染 + 聊天草稿写入
 *
 * 运行：
 *   electron tests/e2e/main.cjs
 */
const {app, BrowserWindow} = require('electron');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs/promises');
const {pathToFileURL} = require('node:url');

const HERE = __dirname;
const ROOT = path.resolve(HERE, '..', '..');
const EDITOR = path.join(ROOT, 'assets', 'editor.html');
const BRIDGE = path.join(ROOT, 'src', 'bridge.mjs');

function page() {
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>DSH writer-workbench e2e</title>
<style>html,body{margin:0;height:100%;background:#222}iframe{width:100%;height:100vh;border:0;background:#fff}</style>
</head><body>
<iframe id="wb" src="/writer-workbench/editor.html"></iframe>
<script type="module">
import {createHostBridge} from '/bridge.mjs';
window.__inserted = [];
const frame = document.getElementById('wb');
const bridge = createHostBridge({
  callTool: async (name, args) => {
    const response = await fetch('/writer-workbench/api', {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({name, args}),
    });
    const body = await response.json();
    if (!response.ok || body.ok !== true) throw new Error(body.error || ('HTTP ' + response.status));
    return body.result;
  },
  insertDraft: params => { window.__inserted.push(params); },
  openLink: url => { window.__opened = url; },
  getHostContext: () => ({theme: 'light', width: frame.clientWidth, height: frame.clientHeight, locale: 'zh-CN', timeZone: 'Asia/Shanghai'}),
});
window.addEventListener('message', async event => {
  if (event.source !== frame.contentWindow) return;
  const response = await bridge(event.data);
  if (response !== null) frame.contentWindow.postMessage(response, location.origin);
});
window.__bridgeReady = true;
</script>
</body></html>`;
}

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function waitFor(check, timeoutMs, label) {
  const started = Date.now();
  let last;
  while (Date.now() - started < timeoutMs) {
    try {
      last = await check();
      if (last) return last;
    } catch (error) {
      last = error;
    }
    await delay(200);
  }
  throw new Error(`等待超时：${label}；最后结果：${last instanceof Error ? last.message : JSON.stringify(last)}`);
}

async function main() {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-ww-e2e-'));
  app.setPath('userData', path.join(temp, 'electron-user-data'));

  const runtimeModule = await import(pathToFileURL(path.join(ROOT, 'src', 'runtime.mjs')).href);
  const runtime = runtimeModule.createWorkbenchRuntime({
    workspacePath: temp,
    editorPath: EDITOR,
    version: 'e2e',
  });
  await runtime.workspace.init();
  await fs.mkdir(path.join(temp, '码字工作台', '测试作品', '正文'), {recursive: true});
  await fs.writeFile(
    path.join(temp, '码字工作台', '测试作品', '正文', '第001章.md'),
    '# 第一章\n\n这是一段已经存在的正文。\n',
    'utf8',
  );

  const bridgeSource = await fs.readFile(BRIDGE, 'utf8');
  const html = page();
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (url.pathname === '/test.html') {
      res.writeHead(200, {'content-type': 'text/html; charset=utf-8'});
      res.end(html);
      return;
    }
    if (url.pathname === '/bridge.mjs') {
      res.writeHead(200, {'content-type': 'application/javascript; charset=utf-8'});
      res.end(bridgeSource);
      return;
    }
    await runtime.route(req, res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;

  const win = new BrowserWindow({
    show: false,
    width: 1440,
    height: 960,
    webPreferences: {contextIsolation: true, nodeIntegration: false, backgroundThrottling: false},
  });
  const logs = [];
  win.webContents.on('console-message', event => {
    logs.push(`[${event.level}] ${event.message} (${event.sourceId}:${event.lineNumber})`);
  });

  const failures = [];
  try {
    await win.loadURL(`${origin}/test.html`);
    await waitFor(
      () => win.webContents.executeJavaScript('window.__bridgeReady === true'),
      8000,
      '父页面桥就绪',
    );
    const status = await waitFor(async () => {
      const value = await win.webContents.executeJavaScript(
        "document.getElementById('wb').contentDocument?.getElementById('host-status')?.textContent ?? ''",
      );
      return value === '已连接宿主' ? value : undefined;
    }, 25000, 'MCP App 连接 DSH 宿主');
    console.log('✓ MCP App 已连接宿主');

    // workspace_info 是一次真实的 fetch + 文件扫描，等界面把结果渲染出来再断言。
    await waitFor(async () => {
      const value = await win.webContents.executeJavaScript(
        "document.getElementById('wb').contentDocument?.querySelectorAll('.file-entry').length ?? 0",
      );
      return value===1;
    }, 15000, 'workspace_info 渲染文件树');

    await waitFor(async () => {
      const disabled = await win.webContents.executeJavaScript(
        "document.getElementById('wb').contentDocument?.getElementById('stats-pet-enabled')?.disabled ?? true",
      );
      return disabled === false;
    }, 10000, 'stats_preferences 启用萌宠设置');

    const snapshot = await win.webContents.executeJavaScript(`(() => {
      const doc = document.getElementById('wb').contentDocument;
      return {
        status: doc.getElementById('host-status').textContent,
        files: [...doc.querySelectorAll('.file-entry')].map(node => node.textContent),
        filesStatus: doc.getElementById('files-status').textContent,
        wordTotal: doc.getElementById('word-total').textContent,
        petDisabled: doc.getElementById('stats-pet-enabled').disabled,
        petChoiceDisabled: doc.getElementById('stats-pet-choice').disabled,
      };
    })()`);
    console.log('  ' + JSON.stringify(snapshot));
    if (!snapshot.files.includes('第001章.md')) failures.push('文件树没有渲染出第001章.md');
    if (snapshot.filesStatus) failures.push('文件计数提示仍在显示：' + snapshot.filesStatus);
    if (snapshot.petDisabled) failures.push('萌宠设置未启用（stats_preferences 未返回 pet）');

    // 打开文稿，确认正文与大纲链路。
    const opened = await win.webContents.executeJavaScript(`(async () => {
      const doc = document.getElementById('wb').contentDocument;
      doc.querySelector('.file-entry').click();
      await new Promise(resolve => setTimeout(resolve, 600));
      return {
        title: doc.getElementById('draft-title').value,
        body: doc.getElementById('draft-body').value,
        documentStatus: doc.getElementById('document-status').textContent,
      };
    })()`);
    console.log('  ' + JSON.stringify(opened));
    if (!opened.body.includes('这是一段已经存在的正文')) failures.push('打开文稿后正文没有加载');

    // 打开文稿后标题输入框应可编辑，回车重命名会改文件名。
    const editable = await win.webContents.executeJavaScript(`(() => {
      const doc = document.getElementById('wb').contentDocument;
      const input = doc.getElementById('draft-title');
      return {readOnly: input.readOnly, value: input.value};
    })()`);
    if (editable.readOnly) failures.push('打开文稿后标题仍为只读，无法重命名');

    const renamedByTitle = await win.webContents.executeJavaScript(`(async () => {
      const doc = document.getElementById('wb').contentDocument;
      const input = doc.getElementById('draft-title');
      input.focus();
      input.value = '第001章_初见';
      input.dispatchEvent(new Event('input', {bubbles: true}));
      input.dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', bubbles: true}));
      await new Promise(resolve => setTimeout(resolve, 1200));
      return {
        title: doc.getElementById('draft-title').value,
        status: doc.getElementById('document-status').textContent,
        files: [...doc.querySelectorAll('.file-entry')].map(node => node.textContent),
      };
    })()`);
    console.log('  ' + JSON.stringify(renamedByTitle));
    if (!renamedByTitle.files.includes('第001章_初见.md')) failures.push('标题重命名后文件树没有更新：' + JSON.stringify(renamedByTitle.files));
    if (!renamedByTitle.status.includes('已重命名')) failures.push('标题重命名后没有状态提示：' + renamedByTitle.status);
    const renamedOnDisk = await fs.readFile(
      path.join(temp, '码字工作台', '测试作品', '正文', '第001章_初见.md'),
      'utf8',
    );
    if (!renamedOnDisk.includes('这是一段已经存在的正文')) failures.push('重命名后文件内容丢失');

    // 文件树右键菜单重命名（双击不再进入重命名）。
    const renamedInTree = await win.webContents.executeJavaScript(`(async () => {
      const doc = document.getElementById('wb').contentDocument;
      const entry = doc.querySelector('.file-entry');
      const rect = entry.getBoundingClientRect();
      entry.dispatchEvent(new MouseEvent('dblclick', {bubbles: true, cancelable: true, view: doc.defaultView}));
      await new Promise(resolve => setTimeout(resolve, 150));
      const doubleOpenedRename = Boolean(doc.querySelector('.file-rename-input'));
      entry.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true, cancelable: true, view: doc.defaultView,
        clientX: rect.left + 20, clientY: rect.top + 8,
      }));
      await new Promise(resolve => setTimeout(resolve, 150));
      const menu = doc.getElementById('file-menu');
      const menuShown = !menu.hidden;
      const items = [...menu.querySelectorAll('button:not([hidden])')].map(button => button.textContent);
      menu.querySelector('button[data-action="rename"]').click();
      await new Promise(resolve => setTimeout(resolve, 150));
      const input = doc.querySelector('.file-rename-input');
      if (!input) return {opened: false, menuShown, items, doubleOpenedRename};
      input.value = '第001章';
      input.dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', bubbles: true}));
      await new Promise(resolve => setTimeout(resolve, 1200));
      return {
        opened: true, menuShown, items, doubleOpenedRename,
        menuHidden: doc.getElementById('file-menu').hidden,
        title: doc.getElementById('draft-title').value,
        files: [...doc.querySelectorAll('.file-entry')].map(node => node.textContent),
      };
    })()`);
    console.log('  ' + JSON.stringify(renamedInTree));
    if (!renamedInTree.menuShown) failures.push('右键文件没有弹出菜单');
    if (!renamedInTree.items.includes('重命名')) failures.push('右键菜单缺少重命名：' + JSON.stringify(renamedInTree.items));
    if (renamedInTree.doubleOpenedRename) failures.push('双击仍然进入了重命名');
    if (!renamedInTree.opened) failures.push('右键重命名没有进入输入框');
    if (!renamedInTree.files.includes('第001章.md')) failures.push('文件树重命名后没有更新：' + JSON.stringify(renamedInTree.files));
    if (renamedInTree.title !== '第001章') failures.push('文件树重命名后标题没有同步：' + renamedInTree.title);

    // 文件夹右键重命名：连同里面的文稿一起移动，并同步当前文稿路径。
    const renamedFolder = await win.webContents.executeJavaScript(`(async () => {
      const doc = document.getElementById('wb').contentDocument;
      doc.defaultView.confirm = () => true;
      const summary = [...doc.querySelectorAll('.file-folder summary')].find(node => node.querySelector('.folder-name')?.textContent === '正文');
      const rect = summary.getBoundingClientRect();
      summary.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true, cancelable: true, view: doc.defaultView,
        clientX: rect.left + 20, clientY: rect.top + 8,
      }));
      await new Promise(resolve => setTimeout(resolve, 150));
      const menu = doc.getElementById('file-menu');
      const menuShown = !menu.hidden;
      menu.querySelector('button[data-action="rename"]').click();
      await new Promise(resolve => setTimeout(resolve, 150));
      const input = doc.querySelector('.folder-rename-input');
      if (!input) return {opened: false, menuShown};
      input.value = '正文二';
      input.dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', bubbles: true}));
      await new Promise(resolve => setTimeout(resolve, 1200));
      return {
        opened: true, menuShown,
        folders: [...doc.querySelectorAll('.folder-name')].map(node => node.textContent),
        status: doc.getElementById('document-status').textContent,
      };
    })()`);
    console.log('  ' + JSON.stringify(renamedFolder));
    if (!renamedFolder.menuShown) failures.push('右键文件夹没有弹出菜单');
    if (!renamedFolder.opened) failures.push('右键文件夹重命名没有进入输入框');
    if (!renamedFolder.folders.includes('正文二')) failures.push('文件夹重命名后文件树没有更新：' + JSON.stringify(renamedFolder.folders));
    if (!renamedFolder.status.includes('正文二')) failures.push('文件夹重命名后当前文稿路径没有同步：' + renamedFolder.status);

    // 侧栏分隔条可拖动：先拉宽，再拖到最窄，宽度写入 localStorage。
    const resized = await win.webContents.executeJavaScript(`(async () => {
      const doc = document.getElementById('wb').contentDocument;
      const handle = doc.getElementById('sidebar-resizer');
      const pane = doc.getElementById('workbench-sidebar');
      const visible = handle.getBoundingClientRect().width > 0;
      const before = Math.round(pane.getBoundingClientRect().width);
      const drag = dx => {
        const rect = handle.getBoundingClientRect();
        const x = rect.left + rect.width / 2, y = rect.top + 120;
        handle.dispatchEvent(new PointerEvent('pointerdown', {bubbles: true, cancelable: true, pointerId: 7, button: 0, clientX: x, clientY: y}));
        handle.dispatchEvent(new PointerEvent('pointermove', {bubbles: true, pointerId: 7, clientX: x + dx, clientY: y}));
        handle.dispatchEvent(new PointerEvent('pointerup', {bubbles: true, pointerId: 7, clientX: x + dx, clientY: y}));
      };
      drag(90);
      await new Promise(resolve => setTimeout(resolve, 120));
      const wide = Math.round(pane.getBoundingClientRect().width);
      drag(-600);
      await new Promise(resolve => setTimeout(resolve, 120));
      return {
        visible,
        before,
        wide,
        narrow: Math.round(pane.getBoundingClientRect().width),
        stored: Number(doc.defaultView.localStorage.getItem('writer-workbench:sidebar-width')),
      };
    })()`);
    console.log('  ' + JSON.stringify(resized));
    if (!resized.visible) failures.push('侧栏分隔条没有渲染');
    if (!(resized.wide >= resized.before + 70)) failures.push(`拖动分隔条后侧栏宽度没有变化：${resized.before} → ${resized.wide}`);
    if (resized.narrow !== 120) failures.push(`侧栏最窄宽度不是 120px：${resized.narrow}`);
    if (Math.abs(resized.stored - resized.narrow) > 2) failures.push(`侧栏宽度没有写入本地存储：${resized.stored} vs ${resized.narrow}`);

    // Fullscreen keeps only the editor plus the floating statistics, with two exit paths.
    const focus=await win.webContents.executeJavaScript(`(async()=>{
      const doc=document.getElementById('wb').contentDocument;
      const visible=id=>doc.getElementById(id).getBoundingClientRect().width>0;
      const body=doc.getElementById('draft-body').value;
      const before=doc.getElementById('stats-float').getBoundingClientRect().toJSON();
      doc.getElementById('writing-fullscreen').click();
      await new Promise(resolve=>setTimeout(resolve,80));
      const during={sidebar:visible('workbench-sidebar'),footer:doc.querySelector('.document-footer').getBoundingClientRect().width,exit:visible('writing-fullscreen-exit'),float:visible('stats-float'),bounds:doc.querySelector('.document').getBoundingClientRect().toJSON(),width:doc.defaultView.innerWidth,height:doc.defaultView.innerHeight};
      doc.getElementById('writing-fullscreen-exit').click();
      const restored=visible('workbench-sidebar');
      doc.getElementById('writing-fullscreen').click();
      doc.dispatchEvent(new doc.defaultView.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
      return {during,restored,escaped:!doc.body.classList.contains('writing-fullscreen'),unchanged:doc.getElementById('draft-body').value===body,floatUnchanged:doc.getElementById('stats-float').getBoundingClientRect().width===before.width,titleSize:parseFloat(doc.defaultView.getComputedStyle(doc.getElementById('stats-work')).fontSize),fileHint:doc.getElementById('files-status').textContent,trashLabel:doc.getElementById('trash-open').textContent};
    })()`);
    if(focus.during.sidebar || focus.during.footer || !focus.during.exit || !focus.during.float || !focus.restored || !focus.escaped || !focus.unchanged || !focus.floatUnchanged || focus.titleSize<16 || focus.fileHint || !focus.trashLabel.includes('回收站') || Math.abs(focus.during.bounds.width-focus.during.width)>1 || Math.abs(focus.during.bounds.height-focus.during.height)>1)failures.push('全屏或提示检查失败：'+JSON.stringify(focus));
    console.log('✓ Fullscreen layout / exit / text preservation / work title / clean hints');
    const screenshotDir=path.resolve(ROOT,'..','test-results');
    await win.webContents.executeJavaScript("document.getElementById('wb').contentDocument.getElementById('writing-fullscreen').click()");
    await delay(120);await fs.writeFile(path.join(screenshotDir,'dsh-writing-fullscreen.png'),(await win.webContents.capturePage()).toPNG());
    await win.webContents.executeJavaScript("document.getElementById('wb').contentDocument.getElementById('writing-fullscreen-exit').click()");
    const trashDoc=await runtime.workspace.saveDocument({path:'文稿/待彻底删除.md',body:'临时测试'});
    await runtime.workspace.deleteDocument({path:trashDoc.path,revision:trashDoc.revision});
    await win.webContents.executeJavaScript("document.getElementById('wb').contentDocument.getElementById('trash-open').click()");
    await waitFor(()=>win.webContents.executeJavaScript("document.getElementById('wb').contentDocument.querySelectorAll('.trash-item').length===1"),5000,'回收站列表');
    const cancelled=await win.webContents.executeJavaScript(`(()=>{
      const doc=document.getElementById('wb').contentDocument;
      const count=doc.querySelector('.trash-item').querySelectorAll('button').length;
      doc.querySelector('.trash-remove').click();
      const filename=doc.getElementById('trash-delete-filename').textContent;
      doc.getElementById('trash-delete-cancel').click();
      return {count,filename,retained:doc.querySelectorAll('.trash-item').length===1};
    })()`);
    if(cancelled.count!==2 || !cancelled.retained || !cancelled.filename.includes('待彻底删除'))failures.push('删除确认/取消失败');
    await win.webContents.executeJavaScript("document.getElementById('wb').contentDocument.querySelector('.trash-remove').click()");
    await delay(80);await fs.writeFile(path.join(screenshotDir,'dsh-trash-delete-confirmation.png'),(await win.webContents.capturePage()).toPNG());
    await win.webContents.executeJavaScript("document.getElementById('wb').contentDocument.getElementById('trash-delete-confirm').click()");
    await waitFor(()=>win.webContents.executeJavaScript("document.getElementById('wb').contentDocument.getElementById('trash-status').textContent==='回收站为空'"),5000,'彻底删除完成');
    if((await runtime.workspace.listTrash()).entries.length)failures.push('彻底删除后磁盘记录仍在');
    await win.webContents.executeJavaScript("document.getElementById('wb').contentDocument.getElementById('trash-close').click()");
    console.log('✓ Trash recovery / deletion actions, cancel retains entry, confirm purges entry');

    // 选中一段文字 → 右键 → 添加到当前聊天，验证 ui/message 草稿链路。
    const selectionResult = await win.webContents.executeJavaScript(`(async () => {
      const doc = document.getElementById('wb').contentDocument;
      const editor = doc.getElementById('draft-body');
      editor.focus();
      editor.value = '这是一段用于测试的选区文字。';
      editor.setSelectionRange(0, editor.value.length);
      editor.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true, cancelable: true, clientX: 120, clientY: 120, view: doc.defaultView,
      }));
      await new Promise(resolve => setTimeout(resolve, 80));
      const menu = doc.getElementById('selection-menu');
      const visible = !menu.hidden;
      const button = doc.getElementById('menu-quote');
      const disabled = button.disabled;
      button.click();
      await new Promise(resolve => setTimeout(resolve, 700));
      return {
        visible,
        disabled,
        inserted: window.__inserted,
        feedback: doc.getElementById('feedback').textContent,
      };
    })()`);
    console.log('  ' + JSON.stringify(selectionResult));
    if (!selectionResult.visible) failures.push('选区右键菜单没有出现');
    if (selectionResult.disabled) failures.push('“添加到当前聊天”按钮被禁用（宿主未声明 openai/message？）');
    if (!selectionResult.inserted.length) failures.push('ui/message 没有到达父页面');
    else {
      const params = selectionResult.inserted[0];
      const text = params.content?.[0]?.text ?? '';
      if (!text.includes('这是一段用于测试的选区文字。')) failures.push('草稿内容缺少选区原文');
      if (params._meta?.['openai/message']?.send !== false) failures.push('草稿没有固定 send:false');
    }
    if (!selectionResult.feedback.includes('选区已添加到当前聊天草稿')) {
      failures.push('界面没有显示添加成功反馈：' + selectionResult.feedback);
    }

    // 工具 open_workbench 的打开计数：直接打 HTTP，客户端轮询在本测试里不跑 UI 入口。
    const openResponse = await fetch(`${origin}/writer-workbench/open`, {method: 'POST'});
    const openedState = await openResponse.json();
    if (openedState.openCounter !== 1) failures.push('openCounter 未递增');

    if (failures.length) {
      console.error('\nE2E 失败：');
      for (const failure of failures) console.error('  ✗ ' + failure);
      if (logs.length) console.error('\n页面日志：\n' + logs.join('\n'));
      process.exitCode = 1;
    } else {
      console.log('\n✓ E2E 全部通过');
    }
  } catch (error) {
    console.error('E2E 异常：', error);
    if (logs.length) console.error('\n页面日志：\n' + logs.join('\n'));
    process.exitCode = 1;
  } finally {
    win.destroy();
    await new Promise(resolve => server.close(resolve));
    await fs.rm(temp, {recursive: true, force: true});
    app.exit(process.exitCode ?? 0);
  }
}

app.commandLine.appendSwitch('disable-gpu');
app.whenReady().then(main).catch(error => {
  console.error(error);
  process.exitCode = 1;
  app.quit();
});
