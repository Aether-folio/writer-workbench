/**
 * 真实 DSH Web UI 冒烟测试（Electron 24）。
 *
 * 传入一个已启动的 DSH Web URL（含 token），脚本会：
 *  1. 跳过预览版说明并确保有活动会话；
 *  2. 点击输入框右侧的「✎ 码字」入口；
 *  3. 验证工作台在 **右侧栏标签页** 打开（不是全屏遮罩），iframe 连上 DSH 宿主；
 *  4. 验证现有作品/章节渲染、选区对话弹窗（取消，不实际发送）；
 *  5. 用原生标签页的「关闭」按钮关闭，再验证 open_workbench 计数能重新打开。
 *
 * 运行：
 *   electron tests/e2e/dsh-ui.cjs "http://127.0.0.1:<port>/?token=..."
 */
const {app, BrowserWindow} = require('electron');

// 输出管道提前关闭时不要弹 Electron 的主进程错误框。
for (const stream of [process.stdout, process.stderr]) {
  if (stream && typeof stream.on === 'function') stream.on('error', () => {});
}

const url = process.argv[2];
if (!url) {
  console.error('usage: electron dsh-ui.cjs <url>');
  process.exit(2);
}

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function waitFor(win, script, timeoutMs, label) {
  return waitForCheck(() => win.webContents.executeJavaScript(script), timeoutMs, label);
}

async function waitForCheck(check, timeoutMs, label) {
  const start = Date.now();
  let last;
  while (Date.now() - start < timeoutMs) {
    try {
      last = await check();
      if (last) return last;
    } catch (error) {
      last = error.message;
    }
    await delay(250);
  }
  throw new Error(`等待超时：${label}；最后结果：${typeof last === 'string' ? last : JSON.stringify(last)}`);
}

const SIDE_FRAME = "document.querySelector('.dww-side-frame')";
const FRAME_STATUS = "document.querySelector('.dww-side-frame')?.contentDocument?.getElementById('host-status')?.textContent ?? ''";

app.commandLine.appendSwitch('disable-gpu');
app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false,
    width: 1440,
    height: 960,
    webPreferences: {contextIsolation: true, nodeIntegration: false, backgroundThrottling: false},
  });
  const logs = [];
  win.webContents.on('console-message', event => logs.push(`[${event.level}] ${event.message}`));

  const failures = [];
  try {
    await win.loadURL(url);
    await waitFor(win, "Boolean(document.querySelector('#root'))", 30000, 'DSH 页面挂载');
    await delay(1500);

    // 预览版说明（只在新 profile 出现）。
    await win.webContents.executeJavaScript(`(() => {
      const button = [...document.querySelectorAll('button')].find(node => node.textContent.trim() === '继续');
      if (button) button.click();
      return Boolean(button);
    })()`);
    await delay(1200);

    // 确保有活动会话与聊天输入框；已有输入框时不要新建空白会话。
    const hadComposer = await win.webContents.executeJavaScript(
      "Boolean(document.querySelector('[contenteditable=\"true\"]'))",
    );
    if (!hadComposer) {
      await win.webContents.executeJavaScript(`(() => {
        const target = [...document.querySelectorAll('button, [role="button"], li, a')]
          .find(node => /默认工作区/.test(node.textContent || ''));
        if (target) target.click();
        return Boolean(target);
      })()`);
    }
    await waitFor(win, "Boolean(document.querySelector('[contenteditable=\"true\"]'))", 20000, '聊天输入框');

    await waitFor(win, "Boolean(document.querySelector('.dww-header-btn'))", 10000, '输入框右侧「✎ 码字」入口');
    const entry = await win.webContents.executeJavaScript(`(() => {
      const button = document.querySelector('.dww-header-btn');
      return {text: button.textContent.trim(), title: button.title};
    })()`);
    console.log('✓ 输入框右侧入口就绪 ' + JSON.stringify(entry));

    // 点击入口：应打开右侧栏标签页，而不是全屏遮罩。
    await win.webContents.executeJavaScript("document.querySelector('.dww-header-btn').click()");
    await waitFor(win, `Boolean(${SIDE_FRAME})`, 10000, '右侧栏工作台 iframe');
    await waitForCheck(async () => {
      const value = await win.webContents.executeJavaScript(FRAME_STATUS);
      return value === '已连接宿主' ? value : undefined;
    }, 25000, '工作台 iframe 连接 DSH 宿主');
    console.log('✓ 工作台已在右侧栏打开并连接宿主');

    const layout = await win.webContents.executeJavaScript(`(() => {
      const frame = document.querySelector('.dww-side-frame');
      return {
        width: frame.clientWidth,
        height: frame.clientHeight,
        overlay: document.querySelectorAll('.dww-overlay').length,
        bodyStillVisible: Boolean(document.querySelector('[contenteditable="true"]')),
      };
    })()`);
    console.log('  ' + JSON.stringify(layout));
    if (layout.overlay !== 0) failures.push('仍然存在全屏遮罩节点');
    if (!layout.bodyStillVisible) failures.push('工作台打开后原对话输入框不可见（被遮住了）');
    if (layout.width < 200 || layout.height < 200) failures.push('右侧栏工作台尺寸异常：' + layout.width + 'x' + layout.height);

    // 首页是书架：现有作品显示为一本书。
    const shelf = await waitForCheck(async () => {
      const value = await win.webContents.executeJavaScript(`(() => {
        const doc = document.querySelector('.dww-side-frame').contentDocument;
        return {
          visible: !doc.getElementById('shelf-page').hidden,
          editorHidden: doc.getElementById('editor-page').hidden,
          books: [...doc.querySelectorAll('.shelf-book')].map(node => node.querySelector('.book-title')?.textContent || ''),
          subtitle: doc.getElementById('shelf-subtitle').textContent,
        };
      })()`);
      return value.books.length ? value : undefined;
    }, 20000, '工作台书架渲染');
    console.log('  ' + JSON.stringify(shelf));
    if (!shelf.visible || !shelf.editorHidden) failures.push('工作台首页没有停在书架');
    if (!shelf.books.some(text => text.includes('我被好运盯住了'))) failures.push('书架上没有现有作品「我被好运盯住了」');
    if (!shelf.subtitle.includes('部作品')) failures.push('书架副标题没有统计作品：' + shelf.subtitle);

    // 点书架封面：打开该作品最近更新的正文，并展开文件侧栏。
    const opened = await win.webContents.executeJavaScript(`(async () => {
      const doc = document.querySelector('.dww-side-frame').contentDocument;
      const book = [...doc.querySelectorAll('.shelf-book')]
        .find(node => (node.querySelector('.book-title')?.textContent || '').includes('我被好运盯住了'));
      book.click();
      await new Promise(resolve => setTimeout(resolve, 900));
      return {
        editorVisible: !doc.getElementById('editor-page').hidden,
        shelfHidden: doc.getElementById('shelf-page').hidden,
        sidebarWidth: Math.round(doc.getElementById('workbench-sidebar').getBoundingClientRect().width),
        title: doc.getElementById('draft-title').value,
        files: [...doc.querySelectorAll('.file-entry')].map(node => node.textContent),
        folders: [...doc.querySelectorAll('.file-folder > summary .folder-name')].map(node => node.textContent).slice(0, 12),
      };
    })()`);
    console.log('  ' + JSON.stringify(opened));
    if (!opened.editorVisible || !opened.shelfHidden) failures.push('点击书架封面后没有进入编辑页');
    if (opened.sidebarWidth <= 0) failures.push('点击书架封面后文件侧栏没有展开');
    if (!opened.files.length) failures.push('作品下没有可打开的文稿');
    if (!opened.folders.includes('我被好运盯住了')) failures.push('没有看到现有作品文件夹「我被好运盯住了」');

    // 选中正文 → 右键 → 添加到当前聊天。
    const selection = await win.webContents.executeJavaScript(`(async () => {
      const doc = document.querySelector('.dww-side-frame').contentDocument;
      const editor = doc.getElementById('draft-body');
      editor.focus();
      editor.value = 'DSH 适配测试选区文字。';
      editor.setSelectionRange(0, editor.value.length);
      editor.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true, cancelable: true, clientX: 160, clientY: 160, view: doc.defaultView,
      }));
      await new Promise(resolve => setTimeout(resolve, 120));
      const menu = doc.getElementById('selection-menu');
      const visible = !menu.hidden;
      const button = doc.getElementById('menu-quote');
      const disabled = button.disabled;
      button.click();
      await new Promise(resolve => setTimeout(resolve, 1200));
      const dialog=doc.getElementById('quote-chat-dialog');
      const dialogOpen=dialog.open,quote=doc.getElementById('quote-chat-selection').textContent;
      doc.getElementById('quote-chat-cancel').click();
      return {visible,disabled,dialogOpen,quote,cancelled:!dialog.open};
    })()`);
    console.log('  ' + JSON.stringify(selection));
    if (!selection.visible) failures.push('选区右键菜单没有出现');
    if (selection.disabled) failures.push('“添加到当前聊天”按钮被禁用');

    if(!selection.dialogOpen || !selection.quote.includes('DSH 适配测试选区文字'))failures.push('选区没有进入工作台对话弹窗');
    if(!selection.cancelled)failures.push('选区对话弹窗无法取消');
    console.log('✓ 选区对话弹窗及取消可用（直接发送由模拟宿主测试覆盖）');

    // 原生标签页的关闭按钮。
    const closed = await win.webContents.executeJavaScript(`(() => {
      const button = document.querySelector('[data-slot="rightbar"] button[aria-label="关闭"]');
      if (!button) return false;
      button.click();
      return true;
    })()`);
    if (!closed) failures.push('右侧栏标签页没有可用的关闭按钮');
    await waitFor(win, `!${SIDE_FRAME}`, 8000, '原生标签页关闭后 iframe 移除');
    console.log('✓ 原生标签页关闭按钮可用');

    // open_workbench 的宿主侧效果：POST /open 递增计数，客户端轮询后重新打开右侧栏标签页。
    await win.webContents.executeJavaScript("fetch('/writer-workbench/open', {method: 'POST'}).then(r => r.json())");
    await waitFor(win, `Boolean(${SIDE_FRAME})`, 10000, 'open_workbench 重新打开工作台');
    await waitForCheck(async () => {
      const value = await win.webContents.executeJavaScript(FRAME_STATUS);
      return value === '已连接宿主' ? value : undefined;
    }, 20000, '重新打开后的 iframe 连接');
    console.log('✓ open_workbench 计数触发右侧栏重新打开');

    if (failures.length) {
      console.error('\nDSH UI 冒烟失败：');
      for (const failure of failures) console.error('  ✗ ' + failure);
      if (logs.length) console.error('\n页面日志：\n' + logs.slice(-40).join('\n'));
      process.exitCode = 1;
    } else {
      console.log('\n✓ DSH UI 冒烟全部通过');
    }
  } catch (error) {
    console.error('DSH UI 冒烟异常：', error);
    if (logs.length) console.error('\n页面日志：\n' + logs.slice(-40).join('\n'));
    process.exitCode = 1;
  } finally {
    win.destroy();
    app.exit(process.exitCode ?? 0);
  }
}).catch(error => {
  console.error(error);
  app.exit(1);
});
