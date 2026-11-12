import {readFile} from 'node:fs/promises';
import {promisify} from 'node:util';
import {gzip} from 'node:zlib';
import {z} from 'zod';
import {bundledFonts} from './font-choices.mjs';

const compress=promisify(gzip),cache=new Map(),chunkSize=384*1024;
export const handwritingFontSchema=z.object({font:z.enum(Object.keys(bundledFonts)),offset:z.number().int().nonnegative().default(0)});
export async function readHandwritingFont(input) {
  const {font,offset}=handwritingFontSchema.parse(input);
  if(!cache.has(font)){
    const {file}=bundledFonts[font];
    cache.set(font,readFile(new URL('../assets/fonts/'+file,import.meta.url))
      .then(buffer=>compress(buffer)).catch(error=>{cache.delete(font);throw error;}));
  }
  const buffer=await cache.get(font);
  if(offset>=buffer.length)throw new Error('字体读取位置不正确。');
  const next=Math.min(offset+chunkSize,buffer.length);
  return {data:buffer.subarray(offset,next).toString('base64'),next:next===buffer.length?null:next};
}
