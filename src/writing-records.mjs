import {countWords} from './core.mjs';

const OFFSET=8*3600000;
export function dayKey(time=Date.now()) {return new Date(time+OFFSET).toISOString().slice(0,10);}
export function splitDays(start,end) {
  const result=[];
  while(start<end) {
    const boundary=(Math.floor((start+OFFSET)/86400000)+1)*86400000-OFFSET;
    const until=Math.min(end,boundary);
    result.push({day:dayKey(start),milliseconds:until-start});start=until;
  }
  return result;
}
export function editCounts(before,after) {
  if(before===after) return {added:0,deleted:0};
  let start=0,endBefore=before.length,endAfter=after.length;
  while(start<endBefore && start<endAfter && before[start]===after[start]) start++;
  while(endBefore>start && endAfter>start && before[endBefore-1]===after[endAfter-1]) {endBefore--;endAfter--;}
  // Avoid dividing a surrogate pair at a shared prefix boundary.
  if(start>0 && /[\uD800-\uDBFF]/.test(before[start-1])) start--;
  if(endBefore<before.length && /[\uDC00-\uDFFF]/.test(before[endBefore])) {endBefore++;endAfter++;}
  return {added:countWords(after.slice(start,endAfter)),deleted:countWords(before.slice(start,endBefore))};
}
export function aggregateDays(records) {
  const days={};
  for(const record of records) {
    const day=days[record.day] ||= {added:0,deleted:0,activeMs:0,idleMs:0,records:[]};
    for(const key of ['added','deleted','activeMs','idleMs']) day[key]+=record[key];
    day.records.push(record);
  }
  return days;
}
