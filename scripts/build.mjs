import {build} from 'esbuild';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {dirname,resolve} from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
await mkdir(resolve(root,'dist'), {recursive:true});
const client = await build({entryPoints:[resolve(root,'src/app.mjs')], bundle:true, format:'iife', platform:'browser', target:'chrome120', write:false, minify:true, loader:{'.gif':'dataurl'}});
const css = await readFile(resolve(root,'src/style.css'),'utf8');
let html = await readFile(resolve(root,'src/template.html'),'utf8');
html = html.replace('/* WORKBENCH_STYLES */',()=>css).replace('/* WORKBENCH_SCRIPT */',()=>client.outputFiles[0].text.replace(/<\/script/gi,'<\\/script'));
await writeFile(resolve(root,'dist/editor.html'),html,'utf8');
await build({entryPoints:[resolve(root,'src/server.mjs')], outfile:resolve(root,'dist/server.mjs'), bundle:true, format:'esm', platform:'node', target:'node22', minify:false, banner:{js:'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);'}});
console.log('Built dist/server.mjs and dist/editor.html');
