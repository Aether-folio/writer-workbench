import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

/**
 * 客户端 bundle 的注册契约测试（不渲染 React）：
 *  - 加载时向 __ModuleLoader__ 注册 id 为 dsh-writer-workbench 的 factory；
 *  - factory(require) 返回 {name, inject, apply}；
 *  - apply 注册：无界面的 openCounter 观察器、会话标题栏按钮、原生右侧栏标签类型与 body。
 */
test('client bundle registers the native sidebar tab, header button and open watcher', async () => {
  const source = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8');
  assert.match(source, /__ModuleLoader__/);
  assert.match(source, /dsh-writer-workbench/);

  let registered;
  const previousWindow = globalThis.window;
  globalThis.window = {
    __ModuleLoader__: {
      load(info) {
        registered = info;
      },
    },
  };
  try {
    // 同一个文件只执行一次；用查询串避免测试进程里的模块缓存。
    await import(`${new URL('../lib/client.js', import.meta.url).href}?t=${Date.now()}`);
  } finally {
    globalThis.window = previousWindow;
  }

  assert.ok(registered, '没有调用 __ModuleLoader__.load');
  assert.equal(registered.id, 'dsh-writer-workbench');
  assert.equal(typeof registered.factory, 'function');

  const fakeReact = {
    createElement: () => null,
    Fragment: {},
    useEffect: () => {},
    useMemo: factory => factory(),
    useRef: value => ({current: value}),
  };
  const mod = registered.factory(name => {
    assert.equal(name, 'react');
    return fakeReact;
  });

  assert.equal(mod.name, 'dsh-writer-workbench');
  assert.deepEqual(mod.inject, ['slots']);
  assert.equal(typeof mod.apply, 'function');

  const seats = [];
  const options = [];
  let tabDefinition;
  const effects = [];

  const tabs = {
    register(definition) {
      tabDefinition = definition;
      return () => {};
    },
  };
  const ctx = {
    effect(factory, label) {
      effects.push({label, dispose: factory()});
      return () => {};
    },
    inject(services, callback) {
      assert.deepEqual(services, ['sidebarRightTabs']);
      callback({get: name => (name === 'sidebarRightTabs' ? tabs : undefined)});
      return () => {};
    },
    slots: {
      inject(seat, callback) {
        seats.push(seat);
        const result = callback();
        if (result !== null && result !== undefined && typeof result.next === 'function') {
          let next = result.next();
          while (!next.done) next = result.next();
        }
        return () => {};
      },
      register(entry) {
        options.push(entry);
        return () => {};
      },
    },
  };
  mod.apply(ctx);

  assert.ok(seats.includes('shell.overlay'));
  assert.ok(seats.includes('conversation.input.right'));
  assert.ok(seats.includes('sidebar.right.pane.tab'));

  assert.ok(options.some(entry => entry.name === 'shell.overlay' && entry.id === 'writer-workbench-watcher'));
  assert.ok(options.some(entry => entry.name === 'conversation.input.right' && entry.id === 'writer-workbench-entry'));
  assert.ok(options.some(entry => entry.name === 'sidebar.right.pane.tab' && entry.key === 'dsh-writer-workbench:writer-workbench'));

  assert.ok(tabDefinition, '没有注册右侧栏标签类型');
  assert.equal(tabDefinition.id, 'dsh-writer-workbench:writer-workbench');
  assert.equal(tabDefinition.kind, 'writer-workbench');
  assert.equal(tabDefinition.keepMounted, true);
  assert.equal(typeof tabDefinition.title, 'function');
  assert.equal(tabDefinition.title(''), '递笔工作台');
  assert.equal(tabDefinition.guide[0].title(), '递笔工作台');
  assert.equal(typeof effects[0].dispose, 'function');
});
