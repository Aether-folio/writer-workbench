export const nativePresets=[['纸白','#fffdf8'],['米黄','#f5edd8'],['豆绿','#dce8d2'],['雾蓝','#e2edf2'],['浅灰','#e6e7e9'],['夜墨','#242825']];

export const glassPalettes={
  glacier:{name:'海盐蓝',base:'#eaf3fb',glow:'#bfdaf2',secondary:'#d2e9eb',accent:'#285d83',ink:'#263749',muted:'#4d6377',light:true},
  iris:{name:'雾丁香',base:'#f3eef9',glow:'#dccfed',secondary:'#f0dde8',accent:'#684a84',ink:'#393047',muted:'#655674',light:true},
  mint:{name:'青梨绿',base:'#eef4e8',glow:'#d4e5be',secondary:'#d8eade',accent:'#41643e',ink:'#303c2c',muted:'#54654d',light:true},
  peach:{name:'杏仁奶',base:'#faf3e9',glow:'#eed9bd',secondary:'#f3e0da',accent:'#805334',ink:'#41362e',muted:'#6b584a',light:true},
  silver:{name:'云朵白',base:'#f1f4f6',glow:'#dbe4ec',secondary:'#e3eaef',accent:'#46617a',ink:'#303a44',muted:'#556371',light:true},
  midnight:{name:'暮夜灰',base:'#000000',glow:'#303030',secondary:'#151515',accent:'#adadad',ink:'#bfbfbf',muted:'#989898'}
};

export function glassPalette(key){return glassPalettes[key] || glassPalettes.glacier;}

export function glassTokens(key,frost=70){
  const p=glassPalette(key),amount=Math.max(40,Math.min(90,Number(frost)||70));
  const paper=p.light?`color-mix(in srgb, ${p.base} 24%, white)`:'#1c1c1c';
  const line=`color-mix(in srgb, ${p.ink} ${p.light?15:18}%, transparent)`;
  return {
    'glass-base':p.base,'glass-glow':p.glow,'glass-secondary':p.secondary,
    'glass-blur':`${Math.round(12+amount*.28)}px`,'glass-opacity':`${Math.round(26+amount*.28)}%`,
    'glass-reading-opacity':`${Math.round(66+amount*.23)}%`,
    paper,desk:p.base,ink:p.ink,muted:p.muted,line,
    surface:`color-mix(in srgb, ${p.accent} 11%, transparent)`,accent:p.accent,'accent-ink':p.light?'#fff':p.base,
    blue:p.accent,'blue-soft':`color-mix(in srgb, ${p.accent} 16%, transparent)`,
    violet:p.light?'#70518f':'#e3c5ff','violet-soft':`color-mix(in srgb, ${p.secondary} 18%, transparent)`,
    teal:p.light?'#216758':'#a0efd2','teal-soft':`color-mix(in srgb, ${p.accent} 12%, transparent)`,
    amber:p.light?'#8b571f':'#f4cf9c','amber-soft':`color-mix(in srgb, ${p.secondary} 14%, transparent)`,
    'ui-ink':p.ink,'ui-muted':p.muted,'ui-panel':`color-mix(in srgb, ${paper} 78%, transparent)`,
    'ui-line':line,'sidebar-tint':p.base,
    'plank-top':`color-mix(in srgb, ${p.glow} 60%, ${paper})`,'plank-bottom':p.base
  };
}
