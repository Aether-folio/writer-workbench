import assert from 'node:assert/strict';
import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {apply, inject, name, VERSION} from '../lib/index.js';

async function withPlugin(run) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-ww-plugin-'));
  await mkdir(join(root, '码字工作台', '测试作品', '正文'), {recursive: true});
  await mkdir(join(root, '码字工作台', '测试作品', '设定'), {recursive: true});
  await writeFile(join(root, '码字工作台', '测试作品', '正文', '第001章.md'), '# 第一章\n', 'utf8');
  const routes = [];
  const tools = [];
  const effects = [];
  const ctx = {
    get: () => undefined,
    effect(factory, label) {
      const disposer = factory();
      effects.push({label, disposer});
      return disposer;
    },
    webServer: {
      register(route) {
        routes.push(route);
        return () => {};
      },
    },
    tools: {
      register(definition) {
        tools.push(definition);
        return () => {};
      },
    },
  };
  apply(ctx, {workspace: root});
  try {
    await run({root, routes, tools, effects});
  } finally {
    for (const effect of effects) {
      if (typeof effect.disposer === 'function') effect.disposer();
    }
    await rm(root, {recursive: true, force: true});
  }
}

test('host plugin exports its identity and required services', () => {
  assert.equal(name, 'writer-workbench');
  assert.deepEqual(inject, ['webServer', 'tools']);
  assert.match(VERSION, /^\d+\.\d+\.\d+/);
});

test('apply registers the HTTP route and model tools including AI return', async () => {
  await withPlugin(async ({routes, tools}) => {
    assert.equal(routes.length, 1);
    assert.equal(routes[0].kind, 'prefix');
    assert.equal(routes[0].path, '/writer-workbench');
    assert.deepEqual(tools.map(tool => tool.name).sort(), ['get_writing_request', 'open_workbench', 'publish_writing_suggestion', 'workbench_status']);
    for (const tool of tools) {
      assert.equal(tool.parameters.type, 'object');
      assert.equal(tool.output.schema.type, 'object');
      assert.ok(Array.isArray(tool.output.schema.required));
      assert.equal(typeof tool.output.render, 'function');
    }
  });
});

test('open_workbench bumps the client-open counter', async () => {
  await withPlugin(async ({tools}) => {
    const open = tools.find(tool => tool.name === 'open_workbench');
    const signal = AbortSignal.timeout(5000);
    const result = await open.execute({}, {signal});
    assert.equal(result.opened, true);
    assert.equal(result.storageFolder, '码字工作台');
    assert.equal(typeof result.delivered, 'boolean');
    assert.match(result.message, /递笔工作台/);

    const rendered = open.output.render({}, result);
    assert.equal(rendered[0].type, 'text');
    assert.equal(rendered[0].text, result.message);
  });
});

test('workbench_status reads the configured workspace without editing it', async () => {
  await withPlugin(async ({root, tools}) => {
    const status = tools.find(tool => tool.name === 'workbench_status');
    const result = await status.execute({}, {signal: AbortSignal.timeout(5000)});
    assert.equal(result.version, VERSION);
    assert.equal(result.workspace, root);
    assert.equal(result.dataFolder, join(root, '码字工作台'));
    assert.equal(result.editorReady, true);
    assert.equal(result.fileCount, 1);
    assert.equal(result.workNames, '测试作品');

    const rendered = status.output.render({}, result);
    assert.match(rendered[0].text, /递笔工作台/);
    assert.match(rendered[0].text, /文稿：1 个/);
  });
});
