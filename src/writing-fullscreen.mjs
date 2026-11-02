export function attachWritingFullscreen({editor}) {
  const enter=document.getElementById('writing-fullscreen'),exit=document.getElementById('writing-fullscreen-exit');
  function set(active) {
    document.body.classList.toggle('writing-fullscreen',active);
    enter.hidden=active;exit.hidden=!active;
    document.dispatchEvent(new CustomEvent('workbench:stats-layout'));
    if(active)exit.focus({preventScroll:true});else editor.focus({preventScroll:true});
  }
  enter.addEventListener('click',()=>set(true));exit.addEventListener('click',()=>set(false));
  document.addEventListener('keydown',event=>{
    if(event.key==='Escape' && !event.isComposing && document.body.classList.contains('writing-fullscreen') && !document.querySelector('dialog[open]')){event.preventDefault();set(false);}
  });
  window.addEventListener('message',event=>{
    if(event.source===window.parent && event.data?.method==='workbench/fullscreen' && typeof event.data.params?.active==='boolean')set(event.data.params.active);
  });
  return {set};
}
