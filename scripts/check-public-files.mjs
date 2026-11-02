import {execFileSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';
const files=execFileSync('git',['ls-files','-z'],{encoding:'utf8'}).split('\0').filter(Boolean);
if(!files.length)throw new Error('No staged or tracked files; inspect and stage the intended source files first.');
const forbidden=/(^|\/)(码字工作台|文稿|正文|草稿|设定|人物|大纲|数据|node_modules|test-results|\.test-temp|runtime|dist|output|video)(\/|$)|^dsh\/lib\/|^dsh\/assets\/editor\.html$|(^|\/)\.env(?:\.|$)|\.(?:log|bak|tmp)$/;
const patterns=[['credential',/\b(?:ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}|sk-[A-Za-z0-9]{30,})\b/],['private key',/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],['personal user path',/[A-Z]:[\\/]Users[\\/](?!Public\b|<)/i]];
const errors=[];
for(const name of files){
 if(forbidden.test(name))errors.push(`${name}: excluded data/output path`);
 if(/\.(?:gif|png|jpe?g|webp)$/i.test(name))continue;
 const text=await readFile(name,'utf8');
 for(const [label,pattern] of patterns)if(pattern.test(text))errors.push(`${name}: ${label}`);
}
if(errors.length){console.error(errors.join('\n'));process.exitCode=1;}
else console.log(`Public-file check passed for ${files.length} tracked/staged files. Review the actual diff before publishing.`);
