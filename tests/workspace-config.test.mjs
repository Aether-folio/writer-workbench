import test from 'node:test';
import assert from 'node:assert/strict';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {DEFAULT_WORKSPACE, resolveWorkspaceSetting} from '../src/workspace-config.mjs';

test('both hosts default to WriterWorkspaces in the home directory and respect overrides', () => {
  assert.equal(DEFAULT_WORKSPACE, join(homedir(), 'WriterWorkspaces'));
  assert.equal(resolveWorkspaceSetting(undefined, ''), DEFAULT_WORKSPACE);
  assert.equal(resolveWorkspaceSetting('   ', '   '), DEFAULT_WORKSPACE);
  assert.equal(resolveWorkspaceSetting(undefined, '/test/environment'), '/test/environment');
  assert.equal(resolveWorkspaceSetting('/test/explicit', '/test/environment'), '/test/explicit');
});
