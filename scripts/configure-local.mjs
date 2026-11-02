// Run after building; only writes ignored, machine-local runtime configuration.
import {writeFile,access} from 'node:fs/promises';
import {dirname,resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {homedir} from 'node:os';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),runtime=join(root,'runtime');
await access(join(runtime,'dist/server.mjs'));
const args=process.argv.slice(2);if(args.length>1)throw new Error('Usage: node scripts/configure-local.mjs [workspace]');
const workspace=resolve(args[0] || process.env.WORKBENCH_WORKSPACE || join(homedir(),'.writer-workbench'));
const config={mcpServers:{writer_workbench:{command:process.execPath,args:[join(runtime,'dist/server.mjs')],cwd:runtime,env:{WORKBENCH_WORKSPACE:workspace}}}};
await writeFile(join(runtime,'.mcp.json'),JSON.stringify(config,null,2)+'\n','utf8');
console.log('Configured local runtime. Rebuilds reset this file; rerun this command after building.');
