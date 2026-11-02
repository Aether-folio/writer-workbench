/**
 * 书架界面的浏览器检查（Playwright + 真实 Chromium）。
 *
 *   node tests/shelf.browser.cjs
 *
 * 覆盖：首次进入是书架；空书架显示「空白书本」；作品封面/文稿数；
 * 点击封面打开对应侧栏与最近更新的正文；回到书架；空作品先建第一篇；
 * 新建作品后书架立即出现新书。
 */
const {chromium} = require('playwright');
const {readFileSync, mkdirSync} = require('node:fs');
const {resolve} = require('node:path');

const html = readFileSync(resolve(__dirname, '../dist/editor.html'), 'utf8');
const output = resolve(__dirname, '../test-results');
mkdirSync(output, {recursive: true});

const coverSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="400"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#3c6174"/><stop offset="1" stop-color="#1c3547"/></linearGradient></defs><rect width="300" height="400" fill="url(#g)"/><rect x="22" y="22" width="256" height="356" fill="none" stroke="#afc6bc"/><text x="42" y="96" fill="#eff1d9" font-size="16" font-family="serif" letter-spacing="3">创作手记</text><text x="42" y="180" fill="#eff1d9" font-size="34" font-family="serif">示例作品</text><text x="42" y="224" fill="#eff1d9" font-size="34" font-family="serif">长篇</text><rect x="42" y="300" width="36" height="2" fill="#afc6bc"/></svg>`;

const seed = {
  cover: 'data:image/svg+xml;base64,' + Buffer.from(coverSvg).toString('base64'),
  works: [
    {name: '示例作品', path: '示例作品'},
    {name: '第二部作品', path: '第二部作品'},
    {name: '空作品', path: '空作品'},
  ],
  files: {
    '示例作品/正文/第一章.md': {title: '第一章', body: '第一章正文。', revision: '1'.repeat(64), updatedAt: '2026-11-01T02:00:00.000Z'},
    '示例作品/正文/第二章.md': {title: '第二章', body: '最近写的第二章。', revision: '2'.repeat(64), updatedAt: '2026-11-02T03:00:00.000Z'},
    '示例作品/设定/人物设定.md': {title: '人物设定', body: '人物档案。', revision: '3'.repeat(64), updatedAt: '2026-10-30T02:00:00.000Z'},
    '第二部作品/正文/开篇.md': {title: '开篇', body: '第二部的开篇。', revision: '4'.repeat(64), updatedAt: '2026-10-28T02:00:00.000Z'},
    '文稿/旧稿.md': {title: '旧稿', body: '以前直接放在文稿里的散篇。', revision: '5'.repeat(64), updatedAt: '2026-10-20T02:00:00.000Z'},
  },
};

async function fixture(browser, {works, files, cover, empty, background = '#fffdf8', draft = {title: '未命名草稿', body: ''}}) {
  const page = await browser.newPage({viewport: {width: 1180, height: 900}});
  const errors = [];
  page.setDefaultTimeout(10000);
  page.on('pageerror', error => errors.push(error.message));
  await page.setContent('<!doctype html><html><body style="margin:0"><iframe id="app" sandbox="allow-scripts" style="border:0;width:100%;height:900px"></iframe></body></html>');
  await page.evaluate(({html, works, files, cover, empty, background, draft}) => {
    const frame = document.getElementById('app');
    window.testWorks = JSON.parse(JSON.stringify(works));
    window.testFiles = JSON.parse(JSON.stringify(files));
    window.testCovers = {};
    if (cover) window.testCovers[works[0].path] = cover;
    window.testDraft = JSON.parse(JSON.stringify(draft));
    window.testWrites = [];
    const directories = new Set(empty ? ['文稿'] : ['文稿']);
    for (const work of window.testWorks) {
      for (const folder of ['设定', '正文', '草稿']) directories.add(work.path + '/' + folder);
    }
    for (const path of Object.keys(window.testFiles)) {
      const parts = path.split('/');
      for (let i = 1; i < parts.length; i++) directories.add(parts.slice(0, i).join('/'));
    }
    window.testDirectories = [...directories];
    window.addEventListener('message', event => {
      if (event.source !== frame.contentWindow) return;
      const request = event.data;
      if (!request || request.jsonrpc !== '2.0' || request.id === undefined) return;
      const args = request.params?.arguments || {};
      let result;
      if (request.method === 'ui/initialize') {
        result = {
          protocolVersion: '2026-01-26',
          hostInfo: {name: 'shelf-test', version: '1'},
          hostCapabilities: {serverTools: {}, message: {text: {}}, experimental: {'openai/message': {}}},
          hostContext: {theme: 'light', displayMode: 'fullscreen', availableDisplayModes: ['inline', 'fullscreen'], locale: 'zh-CN', timeZone: 'Asia/Shanghai'},
        };
      } else if (request.method === 'tools/call') {
        window.testWrites.push(request.params.name);
        if (request.params.name === 'workspace_info') {
          result = {content: [], structuredContent: {
            folder: '码字工作台',
            features: {trash: true, works: true, statsPreferences: true},
            works: window.testWorks,
            directories: window.testDirectories.map(path => ({path, name: path.split('/').at(-1)})),
            files: Object.entries(window.testFiles).map(([path, file]) => ({path, name: path.split('/').at(-1), updatedAt: file.updatedAt})),
            settings: {background},
            draft: window.testDraft,
          }};
        } else if (request.params.name === 'create_work') {
          if (window.testWorks.some(work => work.path === args.name)) {
            result = {isError: true, content: [{type: 'text', text: '同名作品或文件夹已存在。'}]};
          } else {
            const work = {name: args.name, path: args.name};
            window.testWorks.push(work);
            window.testDirectories.push(args.name, args.name + '/设定', args.name + '/正文', args.name + '/草稿');
            result = {content: [], structuredContent: {work}};
          }
        } else if (request.params.name === 'stats_preferences') {
          result = {content: [], structuredContent: {fields: ['work', 'cover', 'words', 'speed', 'active', 'idle', 'status'], coverDataUrl: window.testCovers[args.workPath] || null, pet: {enabled: false, character: 'dragon'}}};
        } else if (request.params.name === 'save_stats_preferences') {
          if (args.workPath && args.coverDataUrl !== undefined) window.testCovers[args.workPath] = args.coverDataUrl;
          result = {content: [], structuredContent: {fields: ['work', 'cover', 'words', 'speed', 'active', 'idle', 'status'], coverDataUrl: window.testCovers[args.workPath] || null, pet: {enabled: false, character: 'dragon'}}};
        } else if (request.params.name === 'read_document') {
          const file = window.testFiles[args.path];
          result = file
            ? {content: [], structuredContent: {path: args.path, title: file.title, body: file.body, revision: file.revision}}
            : {isError: true, content: [{type: 'text', text: '找不到文稿。'}]};
        } else if (request.params.name === 'save_document') {
          const file = {title: args.path.split('/').at(-1).replace(/\.(md|txt)$/i, ''), body: args.body, revision: '9'.repeat(64)};
          window.testFiles[args.path] = file;
          result = {content: [], structuredContent: {path: args.path, ...file}};
        } else if (request.params.name === 'save_draft') {
          window.testDraft = {title: args.title, body: args.body};
          result = {content: [], structuredContent: {saved: true}};
        } else if (request.params.name === 'save_settings') {
          result = {content: [], structuredContent: {settings: args}};
        } else if (request.params.name === 'save_writing_records') {
          result = {content: [], structuredContent: {saved: true}};
        } else if (request.params.name === 'writing_history') {
          result = {content: [], structuredContent: {month: args.month, records: []}};
        } else if (request.params.name === 'list_trash') {
          result = {content: [], structuredContent: {entries: []}};
        } else if (request.params.name === 'rename_document') {
          result = {content: [], structuredContent: {document: {path: args.path, title: args.name, body: '', revision: '8'.repeat(64)}}};
        } else if (request.params.name === 'rename_folder') {
          const oldPath = args.path;
          const newPath = args.name;
          const remap = path => path === oldPath ? newPath : path.startsWith(oldPath + '/') ? newPath + path.slice(oldPath.length) : path;
          window.testWorks = window.testWorks.map(work => work.path === oldPath ? {name: newPath, path: newPath} : work);
          window.testFiles = Object.fromEntries(Object.entries(window.testFiles).map(([path, file]) => [remap(path), file]));
          window.testDirectories = window.testDirectories.map(remap);
          if (Object.hasOwn(window.testCovers, oldPath)) {
            window.testCovers[newPath] = window.testCovers[oldPath];
            delete window.testCovers[oldPath];
          }
          result = {content: [], structuredContent: {folder: {name: newPath, path: newPath}}};
        } else {
          result = {content: [], structuredContent: {ok: true}};
        }
      } else {
        result = {};
      }
      event.source.postMessage({jsonrpc: '2.0', id: request.id, result}, '*');
    });
    frame.srcdoc = html;
  }, {html, works, files, cover, empty, background, draft});
  const frame = page.frameLocator('#app');
  await frame.locator('#host-status').filter({hasText: '已连接宿主'}).waitFor();
  return {page, frame, errors};
}

async function main() {
  const browser = await chromium.launch({...(process.env.PLAYWRIGHT_CHANNEL ? {channel:process.env.PLAYWRIGHT_CHANNEL} : {}),headless:true});
  const failures = [];
  const check = (condition, message) => { if (!condition) failures.push(message); };
  const settle = async page => {
    await page.waitForTimeout(360);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 80)))));
  };
  try {
    // 1) 有作品：书架为首页，点击封面进入作品
    const shelf = await fixture(browser, seed);
    const {page, frame, errors} = shelf;
    await frame.locator('#shelf-page').waitFor({state: 'visible'});
    await frame.locator('.shelf-book[data-kind="work"]').first().waitFor();
    check(await frame.locator('#editor-page').isVisible() === false, '书架打开时编辑页不应同时显示');
    check(await frame.locator('#workbench-sidebar').isVisible() === false, '书架页应隐藏文稿侧栏');
    check(await frame.locator('.shelf-book[data-kind="work"]').count() === 3, '应渲染 3 本作品封面');
    check(await frame.locator('.shelf-book.is-loose').count() === 1, '散篇文稿应合成一本可打开的书');
    check(await frame.locator('.shelf-add').count() === 1, '有作品时应有「添加作品」入口');
    check((await frame.locator('#shelf-subtitle').textContent()).includes('3 部作品'), '书架副标题应显示作品数量');
    const coverImage = frame.locator('.shelf-book[data-path="示例作品"] .book-image');
    check(await coverImage.isVisible(), '已设置封面的作品应显示封面图');
    check(await frame.locator('.shelf-book[data-path="空作品"] .book-detail').textContent() === '还没有文稿', '空作品应提示还没有文稿');
    const firstTitle = await frame.locator('.shelf-book[data-path="示例作品"] .book-title').textContent();
    check(firstTitle === '《示例作品》', '书架标题应带书名号：' + firstTitle);
    await page.screenshot({path: resolve(output, 'shelf-home.png')});

    await frame.locator('.shelf-book[data-path="示例作品"]').click();
    await frame.locator('#editor-page').waitFor({state: 'visible'});
    check(await frame.locator('#shelf-page').isVisible() === false, '打开作品后书架应隐藏');
    check(await frame.locator('#workbench-sidebar').isVisible(), '打开作品后应展开文稿侧栏');
    check(await frame.locator('#draft-title').inputValue() === '第二章', '应打开「正文」里最近更新的第二章，实际：' + await frame.locator('#draft-title').inputValue());
    check((await frame.locator('#document-status').textContent()).includes('示例作品/正文/第二章.md'), '应打开对应作品的正文路径');
    check(await frame.locator('#shelf-home').getAttribute('aria-pressed') === 'false', '进入作品后顶部书架按钮应为未选中');
    check(await frame.locator('#nav-editor').getAttribute('aria-pressed') === 'true', '进入作品后「写作」应为选中');
    check(await frame.locator('#sidebar-toggle').isVisible(), '进入作品后侧栏开关应可用');
    await settle(page);
    await page.screenshot({path: resolve(output, 'shelf-opened-work.png')});

    await frame.locator('#shelf-home').click();
    await frame.locator('#shelf-page').waitFor({state: 'visible'});
    check(await frame.locator('#workbench-sidebar').isVisible() === false, '回到书架后应隐藏侧栏');
    check(await frame.locator('#shelf-home').getAttribute('aria-pressed') === 'true', '书架按钮应处于选中状态');

    // 封面与作品名在书架上右键处理
    const coverPng = await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      canvas.width = 300; canvas.height = 400;
      const context = canvas.getContext('2d');
      const gradient = context.createLinearGradient(0, 0, 300, 400);
      gradient.addColorStop(0, '#3c6174'); gradient.addColorStop(1, '#1c3547');
      context.fillStyle = gradient; context.fillRect(0, 0, 300, 400);
      context.strokeStyle = '#afc6bc'; context.strokeRect(24, 24, 252, 352);
      context.fillStyle = '#eff1d9'; context.font = '18px serif'; context.fillText('创作手记', 50, 70);
      context.font = 'bold 34px serif'; context.fillText('好运', 50, 165);
      return canvas.toDataURL('image/png');
    });
    const png = Buffer.from(coverPng.split(',')[1], 'base64');
    await frame.locator('.shelf-book[data-path="示例作品"]').click({button: 'right'});
    await frame.locator('#shelf-menu').waitFor({state: 'visible'});
    check(await frame.locator('#shelf-menu button[data-action="remove-cover"]').isVisible(), '有封面时应显示移除封面');
    await settle(page);
    await page.screenshot({path: resolve(output, 'shelf-menu.png')});
    await frame.locator('#shelf-menu button[data-action="cover"]').click();
    await frame.locator('#shelf-cover-file').setInputFiles({name: '封面.png', mimeType: 'image/png', buffer: png});
    await frame.locator('#shelf-status').filter({hasText: '封面已更新'}).waitFor();
    check(await frame.locator('.shelf-book[data-path="示例作品"] .book-image').isVisible(), '更换封面后书架应显示封面图');
    await settle(page);
    await page.screenshot({path: resolve(output, 'shelf-cover-menu.png')});

    await frame.locator('.shelf-book[data-path="示例作品"]').click({button: 'right'});
    await frame.locator('#shelf-menu button[data-action="remove-cover"]').click();
    await frame.locator('#shelf-status').filter({hasText: '封面已移除'}).waitFor();
    check(await frame.locator('.shelf-book[data-path="示例作品"] .book-image').count() === 0, '移除封面后书架应回到生成封面');
    await frame.locator('.shelf-book[data-path="示例作品"]').click({button: 'right'});
    check(await frame.locator('#shelf-menu button[data-action="remove-cover"]').isVisible() === false, '没有封面时不应显示移除封面');
    await page.keyboard.press('Escape');

    // 右键重命名作品
    await frame.locator('.shelf-book[data-path="空作品"]').click({button: 'right'});
    await frame.locator('#shelf-menu button[data-action="rename"]').click();
    await frame.locator('#work-dialog').waitFor({state: 'visible'});
    check(await frame.locator('#work-heading').textContent() === '重命名作品', '右键菜单应进入重命名作品');
    check(await frame.locator('#work-name').inputValue() === '空作品', '重命名应预填当前作品名');
    await settle(page);
    await page.screenshot({path: resolve(output, 'shelf-rename.png')});
    await frame.locator('#work-name').fill('空作品二');
    await frame.locator('#work-create').click();
    await frame.locator('#work-dialog').waitFor({state: 'hidden'});
    await frame.locator('.shelf-book[data-path="空作品二"]').waitFor({state: 'visible'});
    check((await frame.locator('#shelf-subtitle').textContent()).includes('3 部作品'), '重命名后作品数不应变化');

    // 空作品：先建第一篇文稿
    await frame.locator('.shelf-book[data-path="空作品二"]').click();
    await frame.locator('#document-dialog').waitFor({state: 'visible'});
    check(await frame.locator('#document-folder').inputValue() === '空作品二/正文', '空作品点开应把新文稿目录设为「正文」');
    await frame.locator('#document-cancel').click();
    check(await frame.locator('#shelf-page').isVisible(), '取消新建后应仍在书架');

    // 窄侧栏宽度（DSH 右侧栏）
    await page.setViewportSize({width: 520, height: 900});
    await page.waitForTimeout(500);
    console.log('  narrow metrics', JSON.stringify(await frame.locator('#shelf-grid').evaluate(el => ({
      grid: [el.scrollWidth, el.clientWidth],
      page: [el.ownerDocument.documentElement.scrollWidth, el.ownerDocument.defaultView.innerWidth],
      card: (() => {const r = el.closest('.shelf-page').getBoundingClientRect(); return [Math.round(r.left), Math.round(r.right)];})(),
    }))));
    await settle(page);
    await page.screenshot({path: resolve(output, 'shelf-narrow.png')});
    check(await frame.locator('#shelf-grid').evaluate(el => el.ownerDocument.documentElement.scrollWidth <= el.ownerDocument.defaultView.innerWidth + 1), '窄侧栏书架不应横向溢出');
    check(errors.length === 0, '书架页面出现脚本错误：' + errors.join(' | '));
    await page.close();

    // 2) 夜墨背景（工作台自己的深色模式）
    const dark = await fixture(browser, {...seed, background: '#242825'});
    await dark.frame.locator('.shelf-book[data-kind="work"]').first().waitFor({state: 'visible'});
    await settle(dark.page);
    await dark.page.screenshot({path: resolve(output, 'shelf-dark.png')});
    check(await dark.frame.locator('html').evaluate(el => getComputedStyle(el).colorScheme === 'dark'), '夜墨背景没有切换书架到深色');
    check(await dark.frame.locator('#shelf-page').evaluate(el => getComputedStyle(el).backgroundColor !== 'rgb(255, 253, 248)'), '书架背景仍是浅色');
    check(dark.errors.length === 0, '深色书架出现脚本错误：' + dark.errors.join(' | '));
    await dark.page.close();

    // 3) 空书架：一本空白书
    const blank = await fixture(browser, {works: [], files: {}, cover: '', empty: true});
    const blankFrame = blank.frame;
    await blankFrame.locator('.shelf-empty').waitFor({state: 'visible'});
    check(await blankFrame.locator('.shelf-empty .book-title').textContent() === '点击创作第一个作品', '空书架应提示点击创作第一个作品');
    check((await blankFrame.locator('#shelf-subtitle').textContent()).includes('书架还是空的'), '空书架副标题应提示书架为空');
    await settle(blank.page);
    await blank.page.screenshot({path: resolve(output, 'shelf-empty.png')});
    await blankFrame.locator('.shelf-empty').click();
    await blankFrame.locator('#work-dialog').waitFor({state: 'visible'});
    await blankFrame.locator('#work-name').fill('新书');
    await blankFrame.locator('#work-create').click();
    await blankFrame.locator('#work-dialog').waitFor({state: 'hidden'});
    await blankFrame.locator('.shelf-book[data-kind="work"]').waitFor({state: 'visible'});
    check(await blankFrame.locator('.shelf-book[data-kind="work"]').count() === 1, '新建作品后书架应立即出现这本书');
    check((await blankFrame.locator('#shelf-subtitle').textContent()).includes('1 部作品'), '新建后副标题应更新为 1 部作品');
    await settle(blank.page);
    await blank.page.screenshot({path: resolve(output, 'shelf-after-create.png')});
    check(blank.errors.length === 0, '空书架页面出现脚本错误：' + blank.errors.join(' | '));
    await blank.page.close();

    // 4) 未另存的草稿也应能在书架上找到
    const drafted = await fixture(browser, {...seed, draft: {title: '未命名草稿', body: '还没另存的草稿。'}});
    const draftBook = drafted.frame.locator('.shelf-book[data-kind="draft"]');
    await draftBook.waitFor({state: 'visible'});
    check(await draftBook.locator('.book-title').textContent() === '未命名草稿', '草稿应显示为书架上的第一本书');
    await settle(drafted.page);
    await drafted.page.screenshot({path: resolve(output, 'shelf-with-draft.png')});
    await draftBook.click();
    await drafted.frame.locator('#editor-page').waitFor({state: 'visible'});
    check(await drafted.frame.locator('#draft-title').inputValue() === '未命名草稿', '打开草稿后标题应恢复');
    check((await drafted.frame.locator('#draft-body').evaluate(el => el.value)).includes('还没另存的草稿'), '打开草稿后正文应恢复');
    check(drafted.errors.length === 0, '草稿书架出现脚本错误：' + drafted.errors.join(' | '));
    await drafted.page.close();

    if (failures.length) {
      console.error('\n书架检查失败：');
      for (const failure of failures) console.error('  ✗ ' + failure);
      process.exitCode = 1;
    } else {
      console.log('✓ 书架检查全部通过');
    }
  } finally {
    await browser.close();
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
