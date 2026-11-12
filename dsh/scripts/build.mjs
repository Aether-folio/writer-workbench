/**
 * 构建 DSH 适配层：
 *  - lib/index.js：宿主半侧（Cordis 插件），把 workspace 逻辑打成一个文件；
 *  - lib/client.js：浏览器半侧（IIFE，注册 __ModuleLoader__ factory）；
 *  - assets/editor.html：直接复用 Codex 版 dist/editor.html（不改源文件）；
 *  - assets/icon.svg：插件图标。
 *
 * 不修改 Codex 的 package.json / dist/server.mjs / .codex-plugin。
 */
import {build} from 'esbuild';
import {copyFile, cp, mkdir, readFile, stat} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const parent = resolve(root, '..');
const editorSource = resolve(parent, 'dist', 'editor.html');
const iconSource = resolve(parent, 'assets', 'icon.svg');
const manifest = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));

async function requireFile(path, label) {
  try {
    const info = await stat(path);
    if (!info.isFile()) throw new Error('not a file');
  } catch {
    throw new Error(`${label} 不存在：${path}\n请先在 ${parent} 运行 npm run build，再运行本构建。`);
  }
}

await requireFile(editorSource, 'Codex 版编辑器产物');
await requireFile(iconSource, '插件图标');

await mkdir(resolve(root, 'lib'), {recursive: true});
await mkdir(resolve(root, 'assets'), {recursive: true});

await build({
  entryPoints: [resolve(here, '..', 'src', 'index.mjs')],
  outfile: resolve(root, 'lib', 'index.js'),
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  sourcemap: false,
  minify: false,
  legalComments: 'none',
  external: ['@deepseek-ai/*'],
  banner: {
    js: `// dsh-writer-workbench ${manifest.version} — 宿主半侧（DSH 适配层，复用 Codex 版 workspace 逻辑）`,
  },
});

await build({
  entryPoints: [resolve(here, '..', 'src', 'client.mjs')],
  outfile: resolve(root, 'lib', 'client.js'),
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'chrome120',
  sourcemap: false,
  minify: false,
  legalComments: 'none',
  banner: {
    js: `// dsh-writer-workbench ${manifest.version} — 浏览器半侧（MCP Apps 宿主桥 + 全屏工作台）`,
  },
});

await copyFile(editorSource, resolve(root, 'assets', 'editor.html'));
await copyFile(iconSource, resolve(root, 'assets', 'icon.svg'));
await cp(resolve(parent,'assets/fonts'),resolve(root,'assets/fonts'),{recursive:true});

console.log(`Built dsh-writer-workbench ${manifest.version}`);
console.log(`  lib/index.js  (${(await stat(resolve(root, 'lib', 'index.js'))).size} bytes)`);
console.log(`  lib/client.js (${(await stat(resolve(root, 'lib', 'client.js'))).size} bytes)`);
console.log(`  assets/editor.html (${(await stat(resolve(root, 'assets', 'editor.html'))).size} bytes)`);
