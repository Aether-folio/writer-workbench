import {spawnSync} from 'node:child_process';
import {mkdir,copyFile,cp,readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {resolve,dirname} from 'node:path';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
for(const script of ['scripts/build.mjs','dsh/scripts/build.mjs']){
 const result=spawnSync(process.execPath,[resolve(root,script)],{cwd:root,stdio:'inherit'});
 if(result.error)throw result.error;if(result.status!==0)process.exit(result.status || 1);
}
const runtime=resolve(root,'runtime');await mkdir(resolve(runtime,'dist'),{recursive:true});
for(const file of ['server.mjs','editor.html'])await copyFile(resolve(root,'dist',file),resolve(runtime,'dist',file));
for(const dir of ['.codex-plugin','skills'])await cp(resolve(root,dir),resolve(runtime,dir),{recursive:true});
await mkdir(resolve(runtime,'assets'),{recursive:true});await copyFile(resolve(root,'assets/icon.svg'),resolve(runtime,'assets/icon.svg'));
await copyFile(resolve(root,'.mcp.json'),resolve(runtime,'.mcp.json'));
const configured=spawnSync(process.execPath,[resolve(root,'scripts/configure-local.mjs')],{cwd:root,stdio:'inherit'});
if(configured.error)throw configured.error;if(configured.status!==0)process.exit(configured.status || 1);
const editor=await readFile(resolve(root,'dist/editor.html'));
assert.ok(editor.includes(Buffer.from('id="shelf-home"')), 'Editor is missing the return-to-bookshelf button');
assert.ok(editor.includes(Buffer.from('id="shelf-page"')), 'Editor is missing the bookshelf');
for(const target of ['runtime/dist/editor.html','dsh/assets/editor.html']){
 assert.ok(editor.equals(await readFile(resolve(root,target))), `${target} differs from the current editor build`);
}
assert.ok((await readFile(resolve(root,'dist/server.mjs'))).equals(await readFile(resolve(runtime,'dist/server.mjs'))), 'Codex runtime server differs from the current build');
console.log('Codex runtime and DSH package now share the same editor build.');

