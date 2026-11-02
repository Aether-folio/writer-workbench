import {attachPetAnimation} from './pet-animation.mjs';

const defaults=['work','cover','words','speed','active','idle','status'];

export function attachStatsPreferences({callTool,notify}) {
  const $=id=>document.getElementById(id),panel=$('stats-float'),dialog=$('stats-settings-dialog');
  let fields=[...defaults],cover=null,work=null,supported=false,loading=false,saving=false,reading=false,coverDirty=false,generation=0,snapshot=null,editingSession=0;
  let pet={enabled:false,character:'dragon'},petSupported=false;
  const petAnimation=attachPetAnimation();
  const metricNames=['words','speed','active','idle'];
  function acceptPet(result) {
    petSupported=typeof result.pet?.enabled==='boolean' && ['dragon','fish'].includes(result.pet.character);
    pet=petSupported ? {...result.pet} : {enabled:false,character:'dragon'};
  }
  function render() {
    const metrics=metricNames.filter(field=>fields.includes(field)),hasCover=Boolean(work && fields.includes('cover'));
    $('stats-work').hidden=!fields.includes('work');
    $('stats-cover-block').hidden=!hasCover;panel.classList.toggle('has-cover',hasCover);panel.dataset.metrics=metrics.length;
    $('stats-grid').hidden=!metrics.length;
    for(const name of metricNames) {
      const item=document.querySelector(`[data-stat-field="${name}"]`);item.hidden=!fields.includes(name);
      item.classList.toggle('is-featured',metrics.length===3 && name===metrics[0]);
    }
    $('timer-state').hidden=!fields.includes('status');
    const image=$('stats-cover-image');image.hidden=!cover;
    if(cover){if(image.src!==cover)image.src=cover;}else image.removeAttribute('src');
    image.alt=work?`${work.name}的封面`:'作品封面';$('stats-cover-fallback').hidden=Boolean(cover);
    $('stats-cover-name').textContent=work?.name.replace(/^《(.*)》$/,'$1') || '';
    const hue=[...(work?.name || '')].reduce((sum,char)=>sum+char.codePointAt(0),0)%360;
    $('stats-cover-block').style.setProperty('--cover-hue',hue);
    $('stats-cover-preview').classList.toggle('has-image',Boolean(cover));
    const preview=$('stats-cover-preview-image');preview.hidden=!cover;if(cover)preview.src=cover;else preview.removeAttribute('src');
    $('stats-cover-preview-label').hidden=Boolean(cover);
    $('stats-layout-description').textContent=(hasCover?'封面 · ':'')+(metrics.length?`${metrics.length} 项数据`:'精简展示');
    $('stats-settings-work').textContent=work?`《${work.name.replace(/^《(.*)》$/,'$1')}》`:'选择作品后可设置封面';
    petAnimation.setPreferences(pet,petSupported);
    $('stats-pet-note').hidden=loading || !supported || petSupported;
    $('stats-pet-note').textContent='萌宠已安装，重启 Codex 后可启用。';
    document.dispatchEvent(new CustomEvent('workbench:stats-layout'));
  }
  function controls() {
    $('stats-fields').disabled=loading || saving || !supported;
    $('stats-settings-save').disabled=loading || saving || reading || !supported;
    $('stats-settings-cancel').disabled=saving;
    $('stats-cover-choose').disabled=!work || loading || saving || reading || !supported;
    $('stats-cover-remove').disabled=!work || !cover || loading || saving || !supported;
    for(const input of dialog.querySelectorAll('[data-stats-option]'))input.checked=fields.includes(input.dataset.statsOption);
    $('stats-pet-enabled').checked=pet.enabled;
    $('stats-pet-enabled').disabled=loading || saving || !petSupported;
    $('stats-pet-choice').value=pet.character;
    $('stats-pet-choice').disabled=loading || saving || !petSupported || !pet.enabled;
  }
  function previewPet() {
    if(loading || saving || !petSupported)return;
    pet={enabled:$('stats-pet-enabled').checked,character:$('stats-pet-choice').value};
    render();controls();
  }
  $('stats-pet-enabled').addEventListener('change',previewPet);
  $('stats-pet-choice').addEventListener('change',previewPet);
  function takeSnapshot() {snapshot={fields:[...fields],cover,pet:{...pet}};coverDirty=false;}
  function close(commit=false) {
    if(saving)return;
    if(!commit && snapshot){fields=snapshot.fields;cover=snapshot.cover;pet=snapshot.pet;render();}
    dialog.close();snapshot=null;coverDirty=false;++editingSession;$('stats-settings').focus({preventScroll:true});
  }
  $('stats-settings').addEventListener('click',()=>{
    ++editingSession;takeSnapshot();$('stats-settings-error').textContent=supported?'':'悬浮窗设置已安装，请重启 Codex 后使用。';
    controls();render();dialog.showModal();
  });
  $('stats-settings-cancel').addEventListener('click',()=>close());
  dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
  for(const input of dialog.querySelectorAll('[data-stats-option]'))input.addEventListener('change',()=>{
    fields=[...dialog.querySelectorAll('[data-stats-option]:checked')].map(input=>input.dataset.statsOption);render();
  });
  $('stats-cover-choose').addEventListener('click',()=>$('stats-cover-file').click());
  $('stats-cover-file').addEventListener('change',async event=>{
    const file=event.target.files?.[0];event.target.value='';if(!file || saving)return;
    $('stats-settings-error').textContent='';
    if(!['image/png','image/jpeg','image/webp'].includes(file.type) || file.size>2097152) {
      $('stats-settings-error').textContent='请选择 2 MB 以内的 PNG、JPG 或 WebP 图片。';return;
    }
    const uploadSession=editingSession,uploadGeneration=generation;reading=true;controls();
    try {
      const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error('图片读取失败'));reader.readAsDataURL(file);});
      const image=new Image();image.src=data;await image.decode();
      if(!dialog.open || uploadSession!==editingSession || uploadGeneration!==generation)return;
      cover=data;coverDirty=true;if(!fields.includes('cover'))fields.push('cover');render();controls();
    } catch{if(dialog.open && uploadSession===editingSession)$('stats-settings-error').textContent='图片无法读取，请重新选择。';}
    finally {reading=false;controls();}
  });
  $('stats-cover-remove').addEventListener('click',()=>{cover=null;coverDirty=true;render();controls();});
  $('stats-settings-save').addEventListener('click',async()=>{
    if(saving || loading || reading || !supported)return;
    saving=true;controls();$('stats-settings-error').textContent='';
    try {
      const args={fields,...(petSupported?{pet}:{}),...(work?{workPath:work.path}:{}),...(coverDirty?{coverDataUrl:cover}:{})};
      const result=await callTool('save_stats_preferences',args);fields=result.fields;cover=result.coverDataUrl;acceptPet(result);
      render();saving=false;close(true);notify('码字悬浮窗设置已保存。');
    } catch(error){$('stats-settings-error').textContent=error.message;}
    finally {saving=false;controls();}
  });
  document.addEventListener('workbench:workchange',async event=>{
    work=event.detail.work;supported=event.detail.supported;const current=++generation;
    cover=null;loading=supported;render();controls();
    if(!supported)return;
    try {
      const result=await callTool('stats_preferences',work?{workPath:work.path}:{});
      if(current!==generation)return;
      fields=result.fields;cover=result.coverDataUrl;acceptPet(result);render();if(dialog.open)takeSnapshot();
    } catch(error){if(current===generation)notify('悬浮窗设置读取未完成：'+error.message);}
    finally {if(current===generation){loading=false;render();controls();}}
  });
  render();controls();
}
