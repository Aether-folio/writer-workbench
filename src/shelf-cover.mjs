export const MAX_COVER_BYTES=2*1024*1024;
export const MAX_COVER_UPLOAD_BYTES=32*1024*1024;
const MAX_COVER_EDGE=1600;

function readDataUrl(blob) {
  return new Promise((resolve,reject)=>{
    const reader=new FileReader();
    reader.onload=()=>resolve(String(reader.result));
    reader.onerror=()=>reject(new Error('图片读取失败。'));
    reader.readAsDataURL(blob);
  });
}

export async function prepareShelfCover(file) {
  if(!['image/png','image/jpeg','image/webp'].includes(file.type)) {
    throw new Error('请选择 PNG、JPG 或 WebP 图片。');
  }
  if(file.size>MAX_COVER_UPLOAD_BYTES)throw new Error('请选择 32 MB 以内的图片。');

  const image=await createImageBitmap(file).catch(()=>{
    throw new Error('图片无法打开，请重新选择。');
  });
  try {
    const longest=Math.max(image.width,image.height);
    if(file.size<=MAX_COVER_BYTES && longest<=MAX_COVER_EDGE)return await readDataUrl(file);

    const canvas=document.createElement('canvas');
    const context=canvas.getContext('2d');
    if(!context)throw new Error('无法处理这张图片。');
    for(const edge of [MAX_COVER_EDGE,1200,900]) {
      const scale=Math.min(1,edge/longest);
      canvas.width=Math.max(1,Math.round(image.width*scale));
      canvas.height=Math.max(1,Math.round(image.height*scale));
      context.imageSmoothingQuality='high';
      context.drawImage(image,0,0,canvas.width,canvas.height);
      const cover=await new Promise(resolve=>canvas.toBlob(resolve,'image/webp',.88));
      if(cover?.size && cover.size<=MAX_COVER_BYTES)return await readDataUrl(cover);
    }
    throw new Error('这张图片压缩后仍无法保存，请选择另一张。');
  } finally {
    image.close();
  }
}
