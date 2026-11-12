import {attachStatsPreferences} from './stats-preferences-ui.mjs';

/**
 * 码字统计面板。
 *
 * 平时固定在文稿侧栏里（文件树和批注之间），不挡正文；
 * 进入全屏写作时可在右下角显示悬浮窗，可拖动和用方向键移动。
 * 紧凑窗口默认收起悬浮窗，从正文标题栏展开。
 * 同一次打开期间记住拖动位置；退出全屏后自动回到侧栏。
 */
export function attachFloatingStats(options) {
  const $=id=>document.getElementById(id),panel=$('stats-float'),head=$('stats-head'),toggle=$('stats-toggle');
  const dock=$('workbench-files'),details=$('stats-details-toggle');
  const fullscreenToggle=$('fullscreen-stats-toggle');
  const compactViewport=matchMedia('(max-width:1150px), (max-height:760px)');
  let detached=false,drag=null,lastPosition=null,dockedVisible=!panel.hidden;

  function place(left,top) {
    if(!detached || panel.hidden || !panel.offsetWidth)return;
    const width=panel.offsetWidth,height=panel.offsetHeight;
    panel.style.left=Math.max(8,Math.min(left,innerWidth-width-8))+'px';
    panel.style.top=Math.max(8,Math.min(top,innerHeight-height-8))+'px';
    panel.style.right='auto';panel.style.bottom='auto';
  }
  function clearPlacement() {
    panel.style.left='';panel.style.top='';panel.style.right='';panel.style.bottom='';
  }
  /** 浮起时回到上次拖动的位置；没有拖动过就留在 CSS 默认的右下角。 */
  function restorePosition() {
    if(lastPosition)place(lastPosition.left,lastPosition.top);
  }
  function rememberPosition() {
    if(panel.hidden || !panel.style.left)return;
    const bounds=panel.getBoundingClientRect();
    lastPosition={left:bounds.left,top:bounds.top};
  }
  function showFullscreenStats(show) {
    if(!show)rememberPosition();
    panel.hidden=!show;
    fullscreenToggle.setAttribute('aria-expanded',String(show));
    const label=show?'收起码字统计':'展开码字统计';
    fullscreenToggle.setAttribute('aria-label',label);
    fullscreenToggle.title=label;
    if(show)restorePosition();
  }
  function layoutFullscreenStats() {
    if(!detached)return;
    const compact=compactViewport.matches;
    const show=!compact&&dockedVisible;
    const restoreFocus=!show&&panel.contains(document.activeElement);
    const moveFocus=!compact&&document.activeElement===fullscreenToggle;
    fullscreenToggle.hidden=!compact;
    showFullscreenStats(show);
    if(restoreFocus||moveFocus)(compact?fullscreenToggle:$('writing-fullscreen-exit')).focus({preventScroll:true});
  }
  function detach() {
    if(detached || !dock)return;
    dockedVisible=!panel.hidden;
    detached=true;
    document.body.appendChild(panel);
    panel.classList.add('is-detached');
    head.tabIndex=0;
    head.setAttribute('role','button');
    head.setAttribute('aria-label','移动码字统计');
    head.title='拖动调整位置，方向键移动';
    layoutFullscreenStats();
  }
  function dockToSidebar() {
    if(!detached)return;
    rememberPosition();
    detached=false;
    panel.classList.remove('is-detached','is-dragging');
    clearPlacement();
    head.removeAttribute('tabindex');
    head.removeAttribute('role');
    head.removeAttribute('aria-label');
    head.removeAttribute('title');
    dock.appendChild(panel);
    fullscreenToggle.hidden=true;
    visible(dockedVisible);
  }
  function sync() {
    if(document.body.classList.contains('writing-fullscreen'))detach();
    else dockToSidebar();
  }
  function visible(show) {
    const restoreFocus=!show && panel.contains(document.activeElement);
    if(detached&&compactViewport.matches){
      showFullscreenStats(show);
      if(restoreFocus)fullscreenToggle.focus({preventScroll:true});
      return;
    }
    dockedVisible=show;
    panel.hidden=!show;toggle.setAttribute('aria-expanded',String(show));
    const label=show?'隐藏码字统计':'显示码字统计';toggle.setAttribute('aria-label',label);toggle.title=label;
    if(show && detached)restorePosition();
    if(restoreFocus)(detached?$('writing-fullscreen-exit'):toggle).focus({preventScroll:true});
  }
  fullscreenToggle.addEventListener('click',()=>showFullscreenStats(panel.hidden));
  compactViewport.addEventListener('change',layoutFullscreenStats);
  toggle.addEventListener('click',()=>{
    const filesToggle=$('compact-files-toggle');
    const show=panel.hidden;
    visible(show);
    if(show&&filesToggle.offsetWidth&&filesToggle.getAttribute('aria-expanded')==='false')filesToggle.click();
  });
  details.addEventListener('click',()=>{
    const expanded=details.getAttribute('aria-expanded')==='false';
    details.setAttribute('aria-expanded',String(expanded));
    const label=expanded?'收起码字统计详情':'展开码字统计详情';
    details.setAttribute('aria-label',label);details.title=label;
  });
  $('stats-hide').addEventListener('click',()=>visible(false));
  head.addEventListener('pointerdown',event=>{
    if(!detached || event.button!==0 || event.target.closest('button'))return;
    const bounds=panel.getBoundingClientRect();
    drag={id:event.pointerId,dx:event.clientX-bounds.left,dy:event.clientY-bounds.top};
    panel.classList.add('is-dragging');
    event.preventDefault();
  });
  window.addEventListener('pointermove',event=>{
    if(!drag || event.pointerId!==drag.id)return;
    place(event.clientX-drag.dx,event.clientY-drag.dy);
  });
  function endDrag(event) {
    if(!drag || event.pointerId!==drag.id)return;
    drag=null;panel.classList.remove('is-dragging');
  }
  window.addEventListener('pointerup',endDrag);
  window.addEventListener('pointercancel',endDrag);
  head.addEventListener('keydown',event=>{
    if(!detached || event.target!==head)return;
    const steps={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]},step=steps[event.key];
    if(!step)return;
    event.preventDefault();const bounds=panel.getBoundingClientRect(),distance=event.shiftKey?40:10;
    place(bounds.left+step[0]*distance,bounds.top+step[1]*distance);
  });
  window.addEventListener('resize',()=>{
    if(!detached || !panel.style.left)return;
    const bounds=panel.getBoundingClientRect();place(bounds.left,bounds.top);
  });
  document.addEventListener('workbench:stats-layout',()=>{
    if(!detached || panel.hidden || !panel.style.left)return;
    const bounds=panel.getBoundingClientRect();
    if(bounds.left<8 || bounds.top<8 || bounds.right>innerWidth-8 || bounds.bottom>innerHeight-8)place(bounds.left,bounds.top);
  });
  const observer=new MutationObserver(sync);
  observer.observe(document.body,{attributes:true,attributeFilter:['class']});
  sync();
  attachStatsPreferences(options);
}
