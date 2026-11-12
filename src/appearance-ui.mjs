import {nativePresets,glassPalettes,glassPalette,glassTokens} from './themes.mjs';
import {fonts,bundledFonts} from './font-choices.mjs';

const defaults={background:'#fffdf8',theme:'native',glassPalette:'glacier',glassFrost:70,fontFamily:'system',fontSize:18,lineHeight:1.6,paragraphGap:1.3,pageWidth:1100,autoPageWidth:true,reduceMotion:false,sidebarSide:'left'};
const SIDE_KEY='writer-workbench:sidebar-side';
const $=id=>document.getElementById(id);

export function attachAppearance({callTool,notify}){
  let settings={...defaults},localSide='',timer,saving=false,generation=0,pending=false;
  const dirty={};
  const loadedFonts=new Map();
  const fontSelect=$('type-family'),fontHint=$('font-load-status'),dialog=$('appearance-dialog'),done=$('appearance-close');
  let previewFont=defaults.fontFamily,applyingFont=false,previewRequest=0;
  try{const value=localStorage.getItem(SIDE_KEY);if(['left','right'].includes(value))localSide=value;}catch{}
  const status=message=>{$('appearance-status').textContent=message;};
  const tokenKeys=new Set(Object.keys(glassTokens('glacier')));
  function loadFont(font){
    const bundled=Object.hasOwn(bundledFonts,font)?bundledFonts[font]:null;
    if(!bundled)return Promise.resolve();
    if(loadedFonts.has(font))return loadedFonts.get(font);
    const load=async()=>{
      const chunks=[];
      for(let offset=0;offset!==null;){
        const chunk=await callTool('read_handwriting_font',{font,offset});
        chunks.push(Uint8Array.from(atob(chunk.data),char=>char.charCodeAt(0)));
        offset=chunk.next;
      }
      const stream=new Blob(chunks).stream().pipeThrough(new DecompressionStream('gzip'));
      const face=await new FontFace(bundled.family,await new Response(stream).arrayBuffer()).load();
      document.fonts.add(face);
    };
    const request=load().then(()=>{
      document.dispatchEvent(new CustomEvent('workbench:stats-layout'));
    }).catch(error=>{
      loadedFonts.delete(font);
      throw error;
    });
    loadedFonts.set(font,request);
    return request;
  }
  async function updateFontPreview(font){
    const request=++previewRequest;
    previewFont=Object.hasOwn(fonts,font)?font:'system';
    fontSelect.value=previewFont;
    $('type-preview').style.setProperty('--wb-preview-font-family',fonts[previewFont]);
    $('type-preview-font').textContent=fontSelect.selectedOptions[0].textContent;
    fontHint.textContent=Object.hasOwn(bundledFonts,previewFont)?'正在载入字体…':'';
    try{
      await loadFont(previewFont);
      if(request===previewRequest)fontHint.textContent='';
    }catch{
      if(request===previewRequest)fontHint.textContent='手写字体未能载入。点击「完成」时会重试。';
    }
  }

  function apply(){
    const root=document.documentElement,isGlass=settings.theme==='glass',color=settings.background;
    const rgb=[1,3,5].map(index=>parseInt(color.slice(index,index+2),16));
    const linear=rgb.map(value=>{value/=255;return value<=.04045?value/12.92:((value+.055)/1.055)**2.4;});
    const light=isGlass?Boolean(glassPalette(settings.glassPalette).light):.2126*linear[0]+.7152*linear[1]+.0722*linear[2]>.179;
    root.style.colorScheme=light?'light':'dark';root.dataset.theme=isGlass?'glass':'native';root.dataset.glassPalette=settings.glassPalette;
    root.dataset.reduceMotion=String(settings.reduceMotion);
    const font=Object.hasOwn(fonts,settings.fontFamily)?settings.fontFamily:'system';
    root.style.setProperty('--wb-font-family',fonts[font]);
    root.dataset.autoPageWidth=String(settings.autoPageWidth);
    $('auto-page-width').checked=settings.autoPageWidth;
    $('type-width').disabled=settings.autoPageWidth;
    for(const key of tokenKeys)root.style.removeProperty('--'+key);
    const blend=(target,weight)=>'#'+rgb.map((value,i)=>Math.round(value*(1-weight)+target[i]*weight).toString(16).padStart(2,'0')).join('');
    const tokens=isGlass?glassTokens(settings.glassPalette,settings.glassFrost):{
      paper:color,desk:light?'#edf2f8':'#131d2b',ink:light?'#101511':'#ffffff',muted:light?'#28312a':'#e3eee7',
      line:blend(light?[30,50,35]:[220,240,225],.2),surface:blend(light?[25,90,55]:[170,220,190],.08),accent:light?'#205c41':'#b0e4c5','accent-ink':light?'#ffffff':'#0f291a'
    };
    for(const [key,value] of Object.entries(tokens))root.style.setProperty('--'+key,value);
    for(const [key,value] of Object.entries({'font-size':settings.fontSize+'px','line-height':settings.lineHeight,'paragraph-gap':settings.paragraphGap+'em','page-width':settings.pageWidth+'px'}))root.style.setProperty('--wb-'+key,String(value));
    for(const [id,key] of [['type-size','fontSize'],['type-height','lineHeight'],['type-gap','paragraphGap'],['type-width','pageWidth']])if(document.activeElement!==$(id))$(id).value=settings[key];
    $('type-motion').checked=settings.reduceMotion;
    $('background-color').value=color;$('background-hex').value=color;
    const side=localSide||settings.sidebarSide;document.body.dataset.sidebarSide=side;$('sidebar-side').value=side;
    for(const button of $('theme-choices').children)button.setAttribute('aria-pressed',String(button.dataset.theme===settings.theme));
    for(const button of $('background-presets').children)button.setAttribute('aria-pressed',String(button.dataset.color===color));
    for(const button of $('glass-presets').children)button.setAttribute('aria-pressed',String(button.dataset.palette===settings.glassPalette));
    $('background-presets').hidden=isGlass;$('native-background-options').hidden=isGlass;
    $('glass-presets').hidden=!isGlass;$('glass-options').hidden=!isGlass;
    $('glass-frost').value=settings.glassFrost;$('glass-frost-value').value=settings.glassFrost+'%';
    const colorName=isGlass?glassPalette(settings.glassPalette).name:nativePresets.find(item=>item[1]===color)?.[0]||'自定义';
    $('palette-heading').textContent=isGlass?'玻璃色系':'纸面底色';$('palette-current').textContent=colorName;
    $('theme-preview-label').textContent=(isGlass?'液体玻璃':'原生')+' · '+colorName;
    $('theme-preview').dataset.theme=isGlass?'glass':'native';
    document.dispatchEvent(new CustomEvent('workbench:stats-layout'));
  }

  // Serialize writes and never let a late response overwrite a newer local choice.
  async function persist(){
    if(saving)return;
    saving=true;pending=false;
    const sent={...settings,sidebarSide:localSide||settings.sidebarSide},current=generation;
    status('正在保存…');$('appearance-retry').hidden=true;
    try{
      const result=await callTool('save_settings',sent);
      if(sent.theme==='glass'&&result?.settings?.theme!=='glass')throw Error('请重启客户端，让新版服务支持液体玻璃主题。');
      if(sent.fontFamily!=='system'&&result?.settings?.fontFamily!==sent.fontFamily)throw Error('请重启客户端，让新版服务支持字体设置。');
      if(dirty.chapterOrders&&!result?.settings?.chapterOrders)throw Error('请重启客户端，以保存章节排序。');
      if(current===generation)status('所有设置已保存。');
    }catch(error){
      if(current===generation){status('保存未完成：'+error.message);$('appearance-retry').hidden=false;notify('设置保存未完成，可在设置底部重试。');}
    }finally{
      saving=false;
      if(pending||current!==generation){clearTimeout(timer);timer=setTimeout(persist,80);}
    }
  }
  function change(patch,delay=120){
    Object.assign(dirty,patch);settings={...settings,...patch};generation++;pending=true;
    apply();status('正在保存…');$('appearance-retry').hidden=true;clearTimeout(timer);timer=setTimeout(persist,delay);
  }
  function chooseBackground(color){
    if(!/^#[0-9a-f]{6}$/i.test(color)){status('请输入 # 开头的六位颜色值。');return;}
    change({background:color.toLowerCase()});
  }
  for(const [name,color] of nativePresets){
    const button=document.createElement('button');button.type='button';button.dataset.color=color;button.textContent=name;
    button.style.setProperty('--swatch',color);button.style.setProperty('--swatch-ink',color==='#242825'?'#eef6f0':'#203026');
    button.addEventListener('click',()=>chooseBackground(color));$('background-presets').append(button);
  }
  for(const [key,p] of Object.entries(glassPalettes)){
    const button=document.createElement('button');button.type='button';button.dataset.palette=key;button.textContent=p.name;
    button.style.setProperty('--swatch',`linear-gradient(135deg,${p.base},${p.glow} 70%,${p.secondary})`);button.style.setProperty('--swatch-ink',p.ink);
    button.addEventListener('click',()=>change({glassPalette:key}));$('glass-presets').append(button);
  }
  for(const button of $('theme-choices').children)button.addEventListener('click',()=>change({theme:button.dataset.theme}));
  $('glass-frost').addEventListener('input',event=>change({glassFrost:Number(event.target.value)},300));
  $('background-color').addEventListener('input',event=>chooseBackground(event.target.value));
  $('background-apply').addEventListener('click',()=>chooseBackground($('background-hex').value.trim()));
  $('background-hex').addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();chooseBackground(event.target.value.trim());}});
  $('sidebar-side').addEventListener('change',event=>{
    localSide=event.target.value;try{localStorage.setItem(SIDE_KEY,localSide);}catch{}
    change({sidebarSide:localSide});
  });
  for(const [id,key,min,max] of [['type-size','fontSize',14,30],['type-height','lineHeight',1.2,2.4],['type-gap','paragraphGap',.5,3],['type-width','pageWidth',600,1600]]){
    const input=$(id);
    input.addEventListener('input',()=>{const value=Number(input.value);if(input.validity.valid&&value>=min&&value<=max)change({[key]:value},400);});
    input.addEventListener('change',()=>{if(!input.validity.valid||!input.value){input.value=settings[key];}});
  }
  fontSelect.addEventListener('change',()=>void updateFontPreview(fontSelect.value));
  $('type-motion').addEventListener('change',event=>change({reduceMotion:event.target.checked}));
  $('auto-page-width').addEventListener('change',event=>change({autoPageWidth:event.target.checked}));
  const tabs=[...document.querySelectorAll('.settings-nav [role=tab]')];
  function selectTab(tab,focus=false){
    for(const item of tabs){const selected=item===tab;item.setAttribute('aria-selected',String(selected));item.tabIndex=selected?0:-1;$(item.getAttribute('aria-controls')).hidden=!selected;}
    $('appearance-dialog').querySelector('.settings-content').scrollTop=0;
    if(focus)tab.focus();
  }
  for(const tab of tabs){
    tab.addEventListener('click',()=>selectTab(tab));
    tab.addEventListener('keydown',event=>{
      if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(event.key))return;
      event.preventDefault();const i=tabs.indexOf(tab),next=event.key==='Home'?0:event.key==='End'?tabs.length-1:(i+(['ArrowRight','ArrowDown'].includes(event.key)?1:tabs.length-1))%tabs.length;
      selectTab(tabs[next],true);
    });
  }
  $('appearance-open').addEventListener('click',()=>{
    dialog.showModal();
    void updateFontPreview(settings.fontFamily);
  });
  function close(){
    previewRequest++;
    if(pending){clearTimeout(timer);void persist();}
    dialog.close();
  }
  done.addEventListener('click',async()=>{
    if(applyingFont)return;
    if(previewFont===settings.fontFamily){close();return;}
    applyingFont=true;done.disabled=true;fontSelect.disabled=true;
    const selected=previewFont;
    try{
      await loadFont(selected);
      change({fontFamily:selected});
      close();
    }catch{
      fontHint.textContent='字体未能载入，请重试。';
      status('字体未能应用。');
    }finally{
      applyingFont=false;done.disabled=false;fontSelect.disabled=false;
    }
  });
  dialog.addEventListener('cancel',event=>{event.preventDefault();if(!applyingFont)close();});
  $('appearance-retry').addEventListener('click',()=>{pending=true;clearTimeout(timer);void persist();});
  $('settings-stats-open').addEventListener('click',()=>{if(!applyingFont){close();$('stats-settings').click();}});
  apply();
  return {
    apply,
    get chapterOrders(){return settings.chapterOrders||{};},
    setChapterOrder(path,order){change({chapterOrders:{...settings.chapterOrders,[path]:order}});},
    moveChapterOrders(from,to){
      const entries=Object.entries(settings.chapterOrders||{});
      if(entries.some(([key])=>key===from||key.startsWith(from+'/'))){
        change({chapterOrders:Object.fromEntries(entries.map(([key,order])=>[
          key===from||key.startsWith(from+'/')?to+key.slice(from.length):key,order
        ]))});
      }
    },
    load(value){
      const autoPageWidth=value?.autoPageWidth??((value?.pageWidth??defaults.pageWidth)===defaults.pageWidth);
      settings={...defaults,...value,autoPageWidth,...dirty};
      apply();
      if(!dialog.open)void updateFontPreview(settings.fontFamily);
      else void loadFont(settings.fontFamily).catch(()=>{});
    },
    adjustFontSize(delta){const next=Math.max(14,Math.min(30,Math.round(settings.fontSize+delta)));if(next!==settings.fontSize)change({fontSize:next},500);return next;}
  };
}
