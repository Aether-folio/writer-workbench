import {attachStatsPreferences} from './stats-preferences-ui.mjs';

export function attachFloatingStats(options) {
  const $=id=>document.getElementById(id),panel=$('stats-float'),handle=$('stats-drag-handle'),toggle=$('stats-toggle');
  let drag=null;
  function position(left,top) {
    const width=panel.offsetWidth,height=panel.offsetHeight;
    panel.style.left=Math.max(8,Math.min(left,innerWidth-width-8))+'px';
    panel.style.top=Math.max(8,Math.min(top,innerHeight-height-8))+'px';
    panel.style.right='auto';panel.style.bottom='auto';
  }
  function visible(show) {
    const restoreFocus=!show && panel.contains(document.activeElement);
    panel.hidden=!show;toggle.setAttribute('aria-expanded',String(show));
    const label=show?'隐藏码字悬浮窗':'显示码字悬浮窗';toggle.setAttribute('aria-label',label);toggle.title=label;
    if(show){const bounds=panel.getBoundingClientRect();position(bounds.left,bounds.top);}
    if(restoreFocus)toggle.focus();
  }
  toggle.addEventListener('click',()=>visible(panel.hidden));
  $('stats-hide').addEventListener('click',()=>visible(false));
  handle.addEventListener('pointerdown',event=>{
    if(event.button!==0 || event.target.closest('button'))return;
    const bounds=panel.getBoundingClientRect();
    drag={id:event.pointerId,dx:event.clientX-bounds.left,dy:event.clientY-bounds.top};
    handle.setPointerCapture(event.pointerId);panel.classList.add('is-dragging');
    event.preventDefault();
  });
  handle.addEventListener('pointermove',event=>{if(drag && event.pointerId===drag.id)position(event.clientX-drag.dx,event.clientY-drag.dy);});
  function endDrag(event) {
    if(!drag || event.pointerId!==drag.id)return;
    drag=null;panel.classList.remove('is-dragging');
  }
  for(const name of ['pointerup','pointercancel','lostpointercapture'])handle.addEventListener(name,endDrag);
  handle.addEventListener('keydown',event=>{
    if(event.target!==handle)return;
    const steps={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]},step=steps[event.key];
    if(!step)return;
    event.preventDefault();const bounds=panel.getBoundingClientRect(),distance=event.shiftKey?40:10;
    position(bounds.left+step[0]*distance,bounds.top+step[1]*distance);
  });
  window.addEventListener('resize',()=>{if(!panel.hidden){const bounds=panel.getBoundingClientRect();position(bounds.left,bounds.top);}});
  document.addEventListener('workbench:stats-layout',()=>{
    if(panel.hidden)return;
    const bounds=panel.getBoundingClientRect();
    // 书架等页面会用 CSS 暂时隐藏悬浮窗，此时不要把它钉到左上角。
    if(!bounds.width || !bounds.height)return;
    if(bounds.left<8 || bounds.top<8 || bounds.right>innerWidth-8 || bounds.bottom>innerHeight-8)position(bounds.left,bounds.top);
  });
  attachStatsPreferences(options);
}
