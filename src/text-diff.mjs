// Bounded word/character comparison: unchanged context is rendered once.
export function textDiff(before,after){
  if(before===after)return [{type:'same',text:before}];
  let start=0,end=0;while(start<before.length&&start<after.length&&before[start]===after[start])start++;while(end<before.length-start&&end<after.length-start&&before.at(-end-1)===after.at(-end-1))end++;
  const result=[];if(start)result.push({type:'same',text:before.slice(0,start)});
  const a=before.slice(start,before.length-end),b=after.slice(start,after.length-end);
  // Sentence boundaries produce readable Chinese diffs without quadratic work on long text.
  const split=s=>s.match(/[^。！？；\n]+[。！？；\n]?|[。！？；\n]/g)||[];
  const left=split(a),right=split(b);
  if(left.length*right.length<=12000&&left.length>1&&right.length>1){const table=Array.from({length:left.length+1},()=>new Uint16Array(right.length+1));for(let i=left.length-1;i>=0;i--)for(let j=right.length-1;j>=0;j--)table[i][j]=left[i]===right[j]?table[i+1][j+1]+1:Math.max(table[i+1][j],table[i][j+1]);let i=0,j=0;while(i<left.length||j<right.length){if(i<left.length&&j<right.length&&left[i]===right[j])result.push({type:'same',text:left[i++]}),j++;else if(j<right.length&&(i===left.length||table[i][j+1]>table[i+1][j]))result.push({type:'add',text:right[j++]});else result.push({type:'remove',text:left[i++]});}}
  else{if(a)result.push({type:'remove',text:a});if(b)result.push({type:'add',text:b});}
  if(end)result.push({type:'same',text:before.slice(before.length-end)});return result;
}

// Offsets refer to the current text. A pure deletion marks a nearby visible character.
export function changedTextRanges(before, after) {
  const additions = [], deletions = [], deletedAt = new Set();
  let offset = 0;
  for (const row of paragraphDiff(before,after)) {
    if (row.before !== row.after) {
      if (row.after === null) deletedAt.add(offset);
      else {
        let cursor = offset, changeStart = cursor, removed = false;
        for (const part of [...textDiff(row.before ?? '',row.after),{type:'same',text:''}]) {
          if (part.type === 'remove') removed = true;
          else if (part.type === 'add') {
            if (part.text.trim()) additions.push({start:cursor,end:cursor+part.text.length});
            cursor += part.text.length;
          } else {
            if (removed && changeStart === cursor) deletedAt.add(cursor);
            cursor += part.text.length;
            changeStart = cursor;
            removed = false;
          }
        }
      }
    }
    if (row.after !== null) offset += row.after.length+1;
  }
  for (const point of deletedAt) {
    const next = /\S/u.exec(after.slice(point));
    if (next) {
      const start = point+next.index;
      deletions.push({start,end:start+next[0].length});
    } else {
      const previous = /(\S)\s*$/u.exec(after.slice(0,point));
      if (previous) deletions.push({start:previous.index,end:previous.index+previous[1].length});
    }
  }
  return {additions,deletions,removed:deletedAt.size>0};
}

// Align paragraphs first so inserting or deleting one does not shift the rest.
// Use exact matches in small ranges, and ordered unique anchors in large ones.
export function paragraphDiff(before, after) {
  const left = before.split('\n'), right = after.split('\n'), rows = [];
  const same = (i, j) => rows.push({before:left[i], after:right[j], oldLine:i+1, newLine:j+1});
  function changed(i, end, j, stop) {
    for (; i < end || j < stop; i++, j++) {
      rows.push({
        before:i < end ? left[i] : null, after:j < stop ? right[j] : null,
        oldLine:i < end ? i+1 : null, newLine:j < stop ? j+1 : null,
      });
    }
  }
  function unique(lines, start, end) {
    const positions = new Map();
    for (let i = start; i < end; i++) {
      if (lines[i].trim()) positions.set(lines[i], positions.has(lines[i]) ? -1 : i);
    }
    return positions;
  }
  function anchors(a, b, c, d) {
    const width = d-c;
    if ((b-a)*width <= 16000) {
      const table = Array.from({length:b-a+1}, () => new Uint16Array(width+1));
      for (let i = b-a-1; i >= 0; i--) {
        for (let j = width-1; j >= 0; j--) {
          table[i][j] = left[a+i] === right[c+j] ? 1+table[i+1][j+1] : Math.max(table[i+1][j], table[i][j+1]);
        }
      }
      const matches = [];
      for (let i = 0, j = 0; i < b-a && j < width;) {
        if (left[a+i] === right[c+j]) matches.push([a+i++, c+j++]);
        else if (table[i+1][j] >= table[i][j+1]) i++;
        else j++;
      }
      return matches;
    }
    const from = unique(left, a, b), to = unique(right, c, d);
    const tails = [];
    for (const [i, x] of from) {
      const y = to.get(i);
      if (x < 0 || y === undefined || y < 0) continue;
      let low = 0, high = tails.length;
      while (low < high) {
        const mid = (low+high) >>> 1;
        if (tails[mid].y < y) low = mid+1;
        else high = mid;
      }
      tails[low] = {x, y, previous:tails[low-1]};
    }
    const matches = [];
    for (let node = tails.at(-1); node; node = node.previous) matches.push([node.x, node.y]);
    return matches.reverse();
  }
  function align(a, b, c, d, depth = 0) {
    while (a < b && c < d && left[a] === right[c]) same(a++, c++);
    let suffix = 0;
    while (a < b-suffix && c < d-suffix && left[b-suffix-1] === right[d-suffix-1]) suffix++;
    b -= suffix;
    d -= suffix;
    const matches = a < b && c < d && depth < 3 ? anchors(a,b,c,d) : [];
    if (matches.length) {
      for (const [i,j] of matches) {
        align(a,i,c,j,depth+1);
        same(i,j);
        a = i+1;
        c = j+1;
      }
      align(a,b,c,d,depth+1);
    } else changed(a,b,c,d);
    for (let i = 0; i < suffix; i++) same(b+i,d+i);
  }
  align(0,left.length,0,right.length);
  return rows;
}
