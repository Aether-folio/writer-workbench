import assert from 'node:assert/strict';
import test from 'node:test';
import {createHostBridge, MCP_APPS_PROTOCOL_VERSION} from '../src/bridge.mjs';

function makeBridge(overrides = {}) {
  const calls = [];
  const drafts = [];
  const bridge = createHostBridge({
    callTool: async (name, args) => {
      calls.push({name, args});
      if (name === 'boom') throw new Error('磁盘满了');
      return {echo: args};
    },
    insertDraft: params => {
      drafts.push(params);
      if (params?.content?.[0]?.text === 'fail') throw new Error('没有会话');
    },
    openLink: url => calls.push({opened: url}),
    getHostContext: () => ({theme: 'dark', width: 800, height: 600, locale: 'zh-CN', timeZone: 'Asia/Shanghai'}),
    ...overrides,
  });
  return {bridge, calls, drafts};
}

const request = (id, method, params) => ({jsonrpc: '2.0', id, method, params});

test('initialize negotiates and advertises the draft-message extension', async () => {
  const {bridge} = makeBridge();
  const response = await bridge(request(1, 'ui/initialize', {protocolVersion: MCP_APPS_PROTOCOL_VERSION}));
  assert.equal(response.jsonrpc, '2.0');
  assert.equal(response.id, 1);
  assert.equal(response.result.protocolVersion, MCP_APPS_PROTOCOL_VERSION);
  assert.equal(response.result.hostInfo.name, 'DeepSeek Harness');
  assert.deepEqual(response.result.hostCapabilities.experimental['openai/message'], {});
  assert.equal(response.result.hostCapabilities.serverTools.listChanged, false);
  assert.equal(response.result.hostContext.theme, 'dark');
  assert.equal(response.result.hostContext.displayMode, 'fullscreen');
  assert.deepEqual(response.result.hostContext.containerDimensions, {width: 800, height: 600});
});

test('tool calls return structuredContent and tool errors stay inside the result', async () => {
  const {bridge, calls} = makeBridge();
  const ok = await bridge(request('a', 'tools/call', {name: 'workspace_info', arguments: {x: 1}}));
  assert.deepEqual(ok.result, {content: [], structuredContent: {echo: {x: 1}}});
  assert.deepEqual(calls[0], {name: 'workspace_info', args: {x: 1}});

  const failed = await bridge(request(2, 'tools/call', {name: 'boom', arguments: {}}));
  assert.equal(failed.result.isError, true);
  assert.equal(failed.result.content[0].text, '磁盘满了');
});

test('ui/message forwards the content to the DSH composer', async () => {
  const {bridge, drafts} = makeBridge();
  const params = {
    role: 'user',
    content: [{type: 'text', text: '【选区】\n> 原文'}],
    _meta: {'openai/message': {target: 'active', send: false}},
  };
  const response = await bridge(request(3, 'ui/message', params));
  assert.deepEqual(response.result, {});
  assert.equal(drafts.length, 1);
  assert.equal(drafts[0].content[0].text, '【选区】\n> 原文');
});

test('ui/message reports isError instead of throwing when the draft cannot be written', async () => {
  const {bridge} = makeBridge();
  const response = await bridge(request(4, 'ui/message', {role: 'user', content: [{type: 'text', text: 'fail'}]}));
  assert.deepEqual(response.result, {isError: true});
});

test('display mode, ping and notifications', async () => {
  const {bridge} = makeBridge();
  assert.deepEqual((await bridge(request(5, 'ui/request-display-mode', {mode: 'fullscreen'}))).result, {mode: 'fullscreen'});
  assert.deepEqual((await bridge(request(6, 'ping', {}))).result, {});
  assert.equal(await bridge({jsonrpc: '2.0', method: 'ui/notifications/initialized'}), null);
  assert.equal(await bridge({jsonrpc: '2.0', method: 'ui/notifications/size-changed', params: {width: 10}}), null);
});

test('unknown request gets a JSON-RPC error, non JSON-RPC is ignored', async () => {
  const {bridge} = makeBridge();
  const response = await bridge(request(7, 'ui/unknown', {}));
  assert.equal(response.error.code, -32601);
  assert.equal(await bridge({hello: 'world'}), null);
  assert.equal(await bridge('not-an-object'), null);
});

test('ui/open-link only forwards http(s) URLs', async () => {
  const {bridge, calls} = makeBridge();
  await bridge(request(8, 'ui/open-link', {url: 'https://example.com/docs'}));
  assert.deepEqual(calls.at(-1), {opened: 'https://example.com/docs'});
});
