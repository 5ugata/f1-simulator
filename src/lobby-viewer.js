/** Home-page gestures only; the physical car and driving inputs stay stationary. */
export function createLobbyViewer({surface,cameras,isEnabled}){
  const pointers=new Map();
  const zoomIn=document.getElementById('car-zoom-in');
  const zoomOut=document.getElementById('car-zoom-out');
  const resetButton=document.getElementById('car-view-reset');
  const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
  const syncButtons=()=>{
    zoomIn.disabled=cameras.lobbyView.radius<=cameras.lobbyLimits.minRadius+.001;
    zoomOut.disabled=cameras.lobbyView.radius>=cameras.lobbyLimits.maxRadius-.001;
  };
  const zoom=factor=>{cameras.zoomLobby(factor);syncButtons();};
  const release=event=>{
    pointers.delete(event.pointerId);
    if(surface.hasPointerCapture(event.pointerId))surface.releasePointerCapture(event.pointerId);
    surface.classList.toggle('dragging',pointers.size>0);
  };
  const cancel=()=>{
    const ids=[...pointers.keys()];pointers.clear();
    for(const id of ids)if(surface.hasPointerCapture(id))surface.releasePointerCapture(id);
    surface.classList.remove('dragging');
  };
  const reset=(immediate=false)=>{cancel();cameras.resetLobby(immediate);syncButtons();};
  const pinchDistance=()=>{
    const [a,b]=pointers.values();return a&&b?Math.hypot(a.x-b.x,a.y-b.y):0;
  };
  surface.addEventListener('pointerdown',event=>{
    if(!isEnabled()||(event.pointerType!=='touch'&&event.button!==0)||pointers.size>=2)return;
    event.preventDefault();
    surface.classList.add('pointer-focused');
    surface.focus({preventScroll:true});surface.setPointerCapture(event.pointerId);
    pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});surface.classList.add('dragging');
  });
  surface.addEventListener('pointermove',event=>{
    const previous=pointers.get(event.pointerId);if(!previous)return;
    if(!isEnabled()){cancel();return;}
    event.preventDefault();
    const oldDistance=pinchDistance();
    const dx=event.clientX-previous.x,dy=event.clientY-previous.y;
    pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});
    if(pointers.size===2){
      const newDistance=pinchDistance();
      if(oldDistance>8&&newDistance>8)zoom(oldDistance/newDistance);
    }else{
      const scale=2*Math.PI/Math.max(360,Math.min(window.innerWidth,window.innerHeight));
      cameras.orbitLobby(dx*scale,dy*scale);
    }
  });
  for(const name of ['pointerup','pointercancel','lostpointercapture'])surface.addEventListener(name,release);
  surface.addEventListener('wheel',event=>{
    if(!isEnabled())return;
    event.preventDefault();
    const unit=event.deltaMode===1?16:event.deltaMode===2?surface.clientHeight:1;
    zoom(Math.exp(clamp(event.deltaY*unit,-600,600)*.0015));
  },{passive:false});
  surface.addEventListener('keydown',event=>{
    surface.classList.remove('pointer-focused');
    if(!isEnabled()||event.altKey||event.ctrlKey||event.metaKey)return;
    const step=.12;
    if(event.key==='ArrowLeft')cameras.orbitLobby(-step,0);
    else if(event.key==='ArrowRight')cameras.orbitLobby(step,0);
    else if(event.key==='ArrowUp')cameras.orbitLobby(0,step);
    else if(event.key==='ArrowDown')cameras.orbitLobby(0,-step);
    else if(event.key==='+'||event.key==='=')zoom(.85);
    else if(event.key==='-'||event.key==='_')zoom(1/.85);
    else if(event.key==='Home')reset();
    else return;
    event.preventDefault();event.stopPropagation();
  });
  zoomIn.addEventListener('click',()=>{if(isEnabled())zoom(.8);});
  zoomOut.addEventListener('click',()=>{if(isEnabled())zoom(1.25);});
  resetButton.addEventListener('click',()=>{if(isEnabled())reset();});
  surface.addEventListener('blur',()=>surface.classList.remove('pointer-focused'));
  window.addEventListener('blur',cancel);
  document.addEventListener('visibilitychange',()=>{if(document.hidden)cancel();});
  window.addEventListener('resize',cancel);
  syncButtons();
  return {cancel,reset};
}
