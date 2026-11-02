import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {createWorkbenchRuntime} from '../src/runtime.mjs';

async function withRuntime(run) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-writer-workbench-'));
  const editorPath = join(root, 'editor.html');
  await writeFile(editorPath, '<!doctype html><p>正在连接 Codex…</p>', 'utf8');
  const runtime = createWorkbenchRuntime({workspacePath: root, editorPath, version: 'test-version'});
  const server = createServer((req, res) => void runtime.route(req, res));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const {port} = server.address();
  const base = `http://127.0.0.1:${port}/writer-workbench`;
  try {
    await run({root, runtime, base});
  } finally {
    await new Promise(resolve => server.close(resolve));
    await rm(root, {recursive: true, force: true});
  }
}

const post = (base, path, body) => fetch(base + path, {
  method: 'POST',
  headers: {'content-type': 'application/json'},
  body: JSON.stringify(body ?? {}),
});

const api = async (base, name, args = {}) => {
  const response = await post(base, '/api', {name, args});
  const body = await response.json();
  return {status: response.status, body};
};

test('state + open counter + health', async () => {
  await withRuntime(async ({base}) => {
    const state = await (await fetch(base + '/state')).json();
    assert.equal(state.openCounter, 0);
    assert.equal(state.storageFolder, '码字工作台');
    assert.equal(state.version, 'test-version');

    const opened = await (await post(base, '/open')).json();
    assert.equal(opened.ok, true);
    assert.equal(opened.openCounter, 1);
    assert.equal(typeof opened.delivered, 'boolean');

    const health = await (await fetch(base + '/health')).json();
    assert.equal(health.ok, true);
    assert.equal(health.version, 'test-version');
  });
});

test('editor.html is served and Codex wording is adapted', async () => {
  await withRuntime(async ({base}) => {
    const response = await fetch(base + '/editor.html');
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') ?? '', /text\/html/);
    const html = await response.text();
    assert.match(html, /正在连接 DSH…/);
    assert.doesNotMatch(html, /正在连接 Codex…/);
  });
});

test('editor.html is re-read after the file changes on disk', async () => {
  await withRuntime(async ({base, root}) => {
    assert.match(await (await fetch(base + '/editor.html')).text(), /正在连接 DSH…/);
    await writeFile(join(root, 'editor.html'), '<!doctype html><p>重新构建后的界面</p>', 'utf8');
    const reloaded = await (await fetch(base + '/editor.html')).text();
    assert.match(reloaded, /重新构建后的界面/);
  });
});

test('workspace_info prepares the data folder and reports an empty desk', async () => {
  await withRuntime(async ({base, root}) => {
    const {status, body} = await api(base, 'workspace_info');
    assert.equal(status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.result.folder, '码字工作台');
    assert.deepEqual(body.result.files, []);
    assert.deepEqual(body.result.works, []);
    assert.equal(body.result.draft.title, '未命名草稿');
    assert.equal(body.result.settings.background, '#fffdf8');
  });
});

test('draft, settings and document round-trip inside 码字工作台', async () => {
  await withRuntime(async ({base, root}) => {
    assert.equal((await api(base, 'save_draft', {title: '未命名草稿', body: '你好'})).status, 200);
    assert.equal((await api(base, 'save_settings', {background: '#112233'})).status, 200);
    const created = await api(base, 'create_work', {name: '测试作品'});
    assert.equal(created.status, 200);
    assert.equal(created.body.result.work.name, '测试作品');

    const saved = await api(base, 'save_document', {
      path: '测试作品/正文/第001章.md',
      body: '# 第一章\n\n正文',
    });
    assert.equal(saved.status, 200);
    assert.match(saved.body.result.revision, /^[a-f0-9]{64}$/);

    const opened = await api(base, 'read_document', {path: '测试作品/正文/第001章.md'});
    assert.equal(opened.status, 200);
    assert.equal(opened.body.result.body, '# 第一章\n\n正文');

    const info = await api(base, 'workspace_info');
    assert.equal(info.body.result.draft.body, '你好');
    assert.equal(info.body.result.settings.background, '#112233');
    assert.ok(info.body.result.files.some(file => file.path === '测试作品/正文/第001章.md'));
    assert.ok(okWorks(info.body.result.works));

    const disk = await readFile(join(root, '码字工作台', '测试作品', '正文', '第001章.md'), 'utf8');
    assert.equal(disk, '# 第一章\n\n正文');
  });
});

function okWorks(works) {
  return works.some(work => work.name === '测试作品');
}

test('path traversal and unknown tools are rejected', async () => {
  await withRuntime(async ({base}) => {
    const traversal = await api(base, 'read_document', {path: '../../outside.md'});
    assert.equal(traversal.status, 400);
    assert.match(traversal.body.error, /文稿路径不正确|只能访问码字工作台文件夹内/);

    const absolute = await api(base, 'read_document', {path: 'C:/Windows/win.ini'});
    assert.equal(absolute.status, 400);

    const unknown = await api(base, 'rm_rf', {});
    assert.equal(unknown.status, 400);
    assert.match(unknown.body.error, /未知的工作台接口/);

    const badJson = await fetch(base + '/api', {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: '{not json',
    });
    assert.equal(badJson.status, 400);
  });
});

test('trash: delete then restore keeps content', async () => {  await withRuntime(async ({base}) => {
    await api(base, 'create_work', {name: '回收站作品'});
    const saved = await api(base, 'save_document', {
      path: '回收站作品/正文/待删.md',
      body: '待删除内容',
    });
    const revision = saved.body.result.revision;
    const removed = await api(base, 'delete_document', {
      path: '回收站作品/正文/待删.md',
      revision,
    });
    assert.equal(removed.status, 200);
    const listed = await api(base, 'list_trash');
    assert.equal(listed.body.result.entries.length, 1);
    const restored = await api(base, 'restore_document', {id: listed.body.result.entries[0].id});
    assert.equal(restored.status, 200);
    const reopened = await api(base, 'read_document', {path: '回收站作品/正文/待删.md'});
    assert.equal(reopened.body.result.body, '待删除内容');
  });
});

test('rename_document keeps content and updates the file list', async () => {
  await withRuntime(async ({base}) => {
    await api(base, 'create_work', {name: '改名作品'});
    const saved = await api(base, 'save_document', {
      path: '改名作品/正文/第一章.md',
      body: '改名前的正文',
    });
    const renamed = await api(base, 'rename_document', {
      path: '改名作品/正文/第一章.md',
      name: '第001章_初见',
      revision: saved.body.result.revision,
    });
    assert.equal(renamed.status, 200);
    assert.equal(renamed.body.result.document.path, '改名作品/正文/第001章_初见.md');
    assert.equal(renamed.body.result.document.body, '改名前的正文');
    const info = await api(base, 'workspace_info');
    assert.ok(info.body.result.files.some(file => file.path === '改名作品/正文/第001章_初见.md'));
    const old = await api(base, 'read_document', {path: '改名作品/正文/第一章.md'});
    assert.equal(old.status, 400);
  });
});

test('rename_folder moves a work folder and keeps its documents', async () => {
  await withRuntime(async ({base}) => {
    await api(base, 'create_work', {name: '旧文件夹作品'});
    await api(base, 'save_document', {path: '旧文件夹作品/正文/第一章.md', body: '正文'});
    const renamed = await api(base, 'rename_folder', {path: '旧文件夹作品', name: '新文件夹作品'});
    assert.equal(renamed.status, 200);
    assert.equal(renamed.body.result.folder.path, '新文件夹作品');
    const reopened = await api(base, 'read_document', {path: '新文件夹作品/正文/第一章.md'});
    assert.equal(reopened.status, 200);
    assert.equal(reopened.body.result.body, '正文');
    const info = await api(base, 'workspace_info');
    assert.ok(info.body.result.works.some(work => work.path === '新文件夹作品'));
  });
});
