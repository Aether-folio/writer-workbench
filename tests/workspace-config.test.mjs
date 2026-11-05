import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_WORKSPACE, resolveWorkspaceSetting} from '../src/workspace-config.mjs';

test('both hosts default to the configured writing project, with explicit and environment overrides', () => {
  assert.equal(DEFAULT_WORKSPACE, String.raw`D:\AI-Workspace\apps\writer-workbench`);
  assert.equal(resolveWorkspaceSetting(undefined, ''), DEFAULT_WORKSPACE);
  assert.equal(resolveWorkspaceSetting('   ', '   '), DEFAULT_WORKSPACE);
  assert.equal(resolveWorkspaceSetting(undefined, '/test/environment'), '/test/environment');
  assert.equal(resolveWorkspaceSetting('/test/explicit', '/test/environment'), '/test/explicit');
});
