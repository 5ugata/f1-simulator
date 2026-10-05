import './style.css';
import * as THREE from 'three';
import {createTrack} from './track.js';
import {createWorld} from './world.js';
import {loadMclarenCar} from './mclaren-car.js';
import {VehiclePhysics} from './physics.js';
import {InputController} from './input.js';
import {EngineAudio} from './audio.js';
import {createRendering} from './rendering.js';
import {Cameras} from './cameras.js';
import {createLobbyViewer} from './lobby-viewer.js';
import {getStartSequence} from './start-lights.js';
import {Session,formatTime} from './session.js';
import {createCoach} from './coaching.js';
import {Autopilot} from './autopilot.js';
import {createDrivingEffects} from './effects.js';

const $=id=>document.getElementById(id);
const clamp=THREE.MathUtils.clamp;
const settings={weather:'golden',quality:window.innerWidth<800||(navigator.deviceMemory??4)<=4?'performance':'high',assist:true,autoGears:true,racingLine:true,ghost:true,volume:.52,mode:'timeattack',camera:0};
try{const saved=JSON.parse(localStorage.getItem('apex-settings')||'{}');for(const k of Object.keys(settings))if(typeof saved[k]===typeof settings[k])settings[k]=saved[k];}catch{}
const saveSettings=()=>{try{localStorage.setItem('apex-settings',JSON.stringify(settings))}catch{}};
let track,world,car,ghost,vehicle,rendering,cameras,session,coach,pilot,effects,lobbyViewer;
let demo=false;
const touches=new Set();
const input=new InputController(window);input.setEnabled(false);
const audio=new EngineAudio({volume:settings.volume});
let phase='loading',resumePhase=null,startElapsed=0,startHold=1.4,signalFadeAt=0,signalCount=-1,elapsed=0,accumulator=0,lastFrame=0,uiTime=0,noticeUntil=0;
let frameCount=0,fpsClock=0,fps=60,previousCollision=0,modalFocus=null,lastActionFocus=null;
let pendingGearUp=false,pendingGearDown=false;
let padPauseHeld=false,padViewHeld=false;
const weatherNames={golden:'Golden hour',clear:'Clear skies',overcast:'Overcast'};
let mapProjection;

function loading(progress,label){$('load-progress').style.width=`${progress}%`;$('load-label').textContent=label;}
const yieldFrame=()=>new Promise(resolve=>requestAnimationFrame(resolve));
async function init(){
  try{
    loading(12,'PROJECTING MONZA / 45°37′ N');
    track=await createTrack();await yieldFrame();
    loading(27,'BUILDING THE LIGHT');
    rendering=await createRendering($('world'),settings);await yieldFrame();
    loading(46,'PREPARING ASPHALT, KERBS & PARKLAND');
    world=await createWorld(rendering.worldRoot,track,{quality:settings.quality});await yieldFrame();
    loading(72,'PREPARING THE McLAREN MCL35M');
    const createCar=await loadMclarenCar();
    car=createCar();rendering.worldRoot.add(car.group);
    ghost=createCar({ghost:true});ghost.group.visible=false;rendering.worldRoot.add(ghost.group);
    vehicle=new VehiclePhysics(track,{...settings,geometry:car.dimensions});
    session=new Session(track);
    cameras=new Cameras(rendering.camera,car,track);cameras.setMode(settings.camera);
    lobbyViewer=createLobbyViewer({surface:$('car-viewer'),cameras,isEnabled:()=>phase==='lobby'&&$('modal').classList.contains('hidden')});
    pilot=new Autopilot(track);
    coach=createCoach(track,rendering.worldRoot,distance=>pilot.speedAt(distance));coach.setVisible(false);
    effects=createDrivingEffects(rendering.worldRoot,track,car.dimensions);
    createMaps();bindUI();syncSettings();
    for(let i=0;i<15;i++){const dot=document.createElement('i');if(i>11)dot.className='max';else if(i>7)dot.className='high';$('rev-lights').append(dot);}
    placeCar();rendering.updateLighting(car.group.position);cameras.lobby(vehicle.state,0,0);
    loading(88,'FINAL SYSTEMS CHECK');
    // Compile before dismissing the loading screen so the first view is complete.
    if(rendering.renderer.compileAsync)await rendering.renderer.compileAsync(rendering.scene,rendering.camera);
    rendering.render(0);
    loading(100,'THE TRACK IS YOURS');
    await yieldFrame();
    phase='lobby';$('loading').classList.add('hidden');$('lobby').classList.remove('hidden');
    window.__APEX__={get ready(){return phase!=='loading'},get phase(){return phase},get demo(){return demo},track,world,vehicle,session,rendering,car,coach,settings,input,pilot,
      start:startSession,pause:()=>openPanel('pause'),resume:closePanel,recover,returnToLobby, cameras,
      get fps(){return fps},get state(){return vehicle.state},get camera(){return cameras.names[cameras.mode]},get startSequence(){return getStartSequence(startElapsed,startHold)}};
    requestAnimationFrame(frame);
  }catch(error){
    console.error(error);$('loading').classList.add('hidden');$('fatal').classList.remove('hidden');
    $('fatal').innerHTML='<span class="eyebrow">APEX / RENDERER</span><h2>The circuit could not be initialized.</h2><p>Use a browser with WebGL 2 and hardware acceleration enabled. Reload the page after checking the connection to the local server.</p><code></code><div class="modal-actions"><button class="primary-button" onclick="location.reload()">RETRY</button></div>';
    $('fatal').querySelector('code').textContent=error.message;
  }
}

function createMaps(){
  const bounds=track.bounds;
  const scale=Math.min(235/(bounds.maxX-bounds.minX),185/(bounds.maxZ-bounds.minZ));
  const midX=(bounds.minX+bounds.maxX)/2,midZ=(bounds.minZ+bounds.maxZ)/2;
  mapProjection=(x,z)=>[150+(x-midX)*scale,110-(z-midZ)*scale];
  const points=track.points.filter((_,i)=>i%4===0).map(p=>mapProjection(p.x,p.z).map(n=>n.toFixed(2)).join(',')).join(' ');
  const startPoint=track.sample(track.startLineDistance).position,finishPoint=track.sample(track.controlLineDistance).position;
  const start=mapProjection(startPoint.x,startPoint.z),finish=mapProjection(finishPoint.x,finishPoint.z);
  const svg=`<polyline points="${points}" fill="none" stroke="#000" stroke-width="5" opacity=".2" stroke-linejoin="round"/><polyline points="${points}" fill="none" stroke="#e6ecd9" stroke-width="1.55" stroke-linecap="round" stroke-linejoin="round"/><circle cx="${start[0]}" cy="${start[1]}" r="2" fill="#c5cdbb"/><text x="${start[0]+7}" y="${start[1]-3}" fill="#c5cdbb" font-family="monospace" font-size="6">START</text><circle cx="${finish[0]}" cy="${finish[1]}" r="3" fill="#d6f75b"/><text x="${finish[0]-7}" y="${finish[1]+3}" text-anchor="end" fill="#d6f75b" font-family="monospace" font-size="6">FINISH</text>`;
  $('lobby-map').innerHTML=svg;
  $('drive-map').innerHTML=svg+'<circle id="ghost-dot" r="2.7" fill="#d6f75b" opacity=".4"/><circle id="player-dot" r="4" fill="#d6f75b" stroke="#263c1b" stroke-width="1.5"/>';
}
function fullMap(){
  const labels=track.corners.map(c=>{const s=track.sample(c.distance),p=mapProjection(s.position.x,s.position.z);const offset=c.number%2?8:-8;return `<circle cx="${p[0]}" cy="${p[1]}" r="2" fill="#d6f75b"/><text x="${p[0]+offset}" y="${p[1]-4}" fill="#d6f75b" font-family="monospace" font-size="6" text-anchor="middle">${c.number}</text>`}).join('');
  return `<svg class="circuit-detail-map" viewBox="0 0 300 220" aria-label="Monza corner map">${$('lobby-map').innerHTML}${labels}</svg>`;
}
function notice(message,warning=false,duration=4){$('notice').textContent=message;$('notice').className=`notice${warning?' warning':''}`;noticeUntil=elapsed+duration;}
function placeCar(){
  const state=vehicle.state;const sample=track.sample(state.distance);
  car.group.position.set(state.x,sample.position.y,state.z);car.group.rotation.y=state.heading;
}
function setStartSignal(count,released=false){
  world.startSignal.setState(count);
  const signalKey=`${count}:${released}`;
  if($('countdown').dataset.signal===signalKey)return;
  $('countdown').dataset.signal=signalKey;
  if(count!==signalCount){
    signalCount=count;
    [...$('start-lamps').children].forEach((column,i)=>column.classList.toggle('lit',i<count));
  }
  $('start-state').textContent=released?'LIGHTS OUT':'WAIT FOR LIGHTS OUT';
  $('countdown').setAttribute('aria-label',released?'Lights out. Drive.':`${count} of 5 red light pairs. Wait for lights out.`);
}
function startSession(demonstration=false){
  lobbyViewer.cancel();
  demo=demonstration===true;
  $('modal').classList.add('hidden');resumePhase=null;
  audio.start().catch(()=>notice('AUDIO UNAVAILABLE — DRIVING IS READY',false));
  vehicle.setOptions(demo?{...settings,assist:true,autoGears:true}:settings);vehicle.reset(0);session.reset(0);session.recordEnabled=!demo;
  pilot.reset();effects.reset();clearTouches();cameras.setMode(demo?1:settings.camera);cameras.reset();syncSettings();
  $('lobby').classList.add('hidden');$('hud').classList.remove('hidden');document.body.classList.add('driving');
  phase='countdown';startElapsed=0;startHold=.7+Math.random()*1.5;signalFadeAt=0;setStartSignal(0);accumulator=0;pendingGearUp=pendingGearDown=false;input.setEnabled(false);
  coach.setVisible(settings.racingLine);$('countdown').classList.remove('hidden');ghost.group.visible=false;
  $('hud-session').textContent=demo?'DEMONSTRATION':settings.mode==='timeattack'?'TIME ATTACK':'FREE PRACTICE';
  $('demo-control').classList.toggle('hidden',!demo);
  $('notice').classList.add('hidden');placeCar();updateHUD();
  if(document.activeElement instanceof HTMLElement)document.activeElement.blur();
}
function recover(){
  if(phase!=='drive')return;
  const distance=vehicle.state.distance;vehicle.reset(distance);session.recover(distance);cameras.reset();
  notice('CAR RECOVERED · LAP INVALID',true);input.clear();clearTouches();placeCar();
}
function returnToLobby(){
  lobbyViewer.reset(true);
  phase='lobby';demo=false;resumePhase=null;$('modal').classList.add('hidden');input.setEnabled(false);clearTouches();audio.suspend();
  $('countdown').classList.add('hidden');$('demo-control').classList.add('hidden');
  signalFadeAt=0;startElapsed=0;setStartSignal(0);
  $('hud').classList.add('hidden');$('lobby').classList.remove('hidden');document.body.classList.remove('driving');
  vehicle.reset(0);placeCar();car.setCockpit(false);ghost.group.visible=false;coach.setVisible(false);syncSettings();
}
function syncSettings(){
  $('session-label').innerHTML=`${settings.mode==='timeattack'?'Time attack':'Free practice'} <b>⌄</b>`;
  $('conditions-label').innerHTML=`${weatherNames[settings.weather]||'Golden hour'} <b>${settings.weather==='overcast'?'☁':'☀'}</b>`;
  $('setup-label').innerHTML=`${settings.assist?'Assisted':'Authentic'} <b>⌄</b>`;
  $('assist-indicator').textContent=demo?'DEMONSTRATION':settings.assist?'TRACTION ASSIST':'ASSISTS OFF';
  $('gear-mode').textContent=demo||settings.autoGears?'AUTO':'MANUAL';
  $('camera-label').innerHTML=`${cameras?.names[cameras.mode]||'COCKPIT'} <kbd>C</kbd>`;
  document.body.dataset.camera=String(cameras?.mode??0);
  document.body.dataset.gears=demo||settings.autoGears?'auto':'manual';
  vehicle?.setOptions(demo?{...settings,assist:true,autoGears:true}:settings);audio.setVolume(settings.volume);saveSettings();
}
const toggle=(key,title,description)=>`<div class="setting-row"><div><strong>${title}</strong><p>${description}</p></div><button class="toggle ${settings[key]?'on':''}" role="switch" aria-checked="${settings[key]}" aria-label="${title}" data-toggle="${key}"><i></i></button></div>`;
function openPanel(type){
  if(phase==='loading')return;
  lobbyViewer.cancel();
  lastActionFocus=document.activeElement;
  if(phase==='drive'||phase==='countdown'){resumePhase=phase;phase='paused';input.setEnabled(false);clearTouches();audio.suspend();}
  let title='',content='';
  if(type==='pause'){
    title='A moment in the paddock.';
    content=`<p class="modal-copy">Your session is paused. Take a breath. There is always another tenth to find.</p><div class="lap-summary"><div><span>CURRENT LAP</span><strong>${formatTime(session.lapTime)}</strong></div><div><span>PERSONAL BEST</span><strong>${formatTime(session.best?.time)}</strong></div><div><span>LAP</span><strong>${String(session.lap).padStart(2,'0')}</strong></div></div><div class="modal-actions"><button class="primary-button" data-action="resume">BACK ON TRACK ↗</button><button class="secondary-button" data-action="restart">RESTART SESSION</button></div><div class="modal-actions"><button class="text-button" data-action="setup">DRIVER SETUP</button><button class="text-button" data-action="telemetry">TELEMETRY</button><button class="text-button" data-action="leave">EXIT TO PADDOCK</button></div>`;
  }else if(type==='session'){
    title='Make every lap count.';
    content=`<p class="modal-copy">A private Monza session. Choose your pursuit.</p><div class="choice-grid"><button class="choice ${settings.mode==='timeattack'?'selected':''}" data-mode="timeattack"><span class="choice-index">01 / THE CLOCK</span><h3>Time attack</h3><p>Find a clean lap. Chase your personal best with a saved ghost and live timing delta.</p></button><button class="choice ${settings.mode==='practice'?'selected':''}" data-mode="practice"><span class="choice-index">02 / THE CRAFT</span><h3>Free practice</h3><p>Learn braking points and build confidence. An open session with lap timing and telemetry.</p></button></div><div class="modal-actions"><button class="primary-button" data-action="close">SESSION SELECTED</button></div>`;
  }else if(type==='conditions'){
    title='The light at Monza.';
    content=`<p class="modal-copy">Three dry sessions, each with a different atmosphere. Track grip stays consistent while you learn the circuit.</p><div class="setting-row"><div><strong>Environment</strong><p>Sun position, sky, light and atmospheric haze.</p></div><select id="weather-select" aria-label="Environment">${Object.entries(weatherNames).map(([k,v])=>`<option value="${k}" ${settings.weather===k?'selected':''}>${v}</option>`).join('')}</select></div><div class="modal-copy" id="weather-copy">${weatherDescription()}</div><div class="modal-actions"><button class="primary-button" data-action="close">APPLY CONDITIONS</button></div>`;
  }else if(type==='setup'||type==='settings'){
    title=type==='settings'?'Make it yours.':'Find your driving style.';
    content=toggle('assist','Traction & stability assistance','Progressive steering, wheelspin control and yaw damping.')+toggle('autoGears','Automatic gearbox','Eight speeds. Turn off to shift with Z / X or the bumpers.')+toggle('racingLine','Braking guide','A colored reference line: green for throttle, red for braking.')+toggle('ghost','Personal-best ghost','Your fastest valid lap, saved in this browser.')+`<div class="setting-row"><div><strong>Graphics</strong><p>Shadow resolution, rendering scale and bloom.</p></div><select id="quality-select" aria-label="Graphics quality"><option value="performance" ${settings.quality==='performance'?'selected':''}>Performance</option><option value="high" ${settings.quality==='high'?'selected':''}>High</option><option value="ultra" ${settings.quality==='ultra'?'selected':''}>Ultra</option></select></div><div class="setting-row"><div><strong>Master volume</strong><p>Engine, turbo, wind, tyres and kerb feedback.</p></div><input id="volume-slider" aria-label="Master volume" type="range" min="0" max="1" step=".02" value="${settings.volume}"></div><div class="modal-actions"><button class="primary-button" data-action="close">SAVE & CONTINUE</button><button class="secondary-button" data-action="controls">CONTROLS</button></div>`;
  }else if(type==='controls'){
    title='You are in control.';
    content=`<p class="modal-copy">Brake early for Rettifilo. Build speed on the straights, then release the brake as you turn in. A gamepad gives you finer steering control.</p><div class="control-grid">${[['Throttle','W / ↑'],['Brake','S / ↓ / SPACE'],['Steer','A D / ← →'],['ERS boost','HOLD SHIFT'],['DRS in zones','HOLD E'],['Shift down / up','Z / X'],['Change camera','C'],['Recover car','R'],['Braking guide','L'],['Minimal HUD','H'],['Pause','ESC'],['Fullscreen','F']].map(([label,key])=>`<div class="control"><span>${label}</span><kbd>${key}</kbd></div>`).join('')}</div><p class="modal-copy"><strong>Gamepad</strong> &nbsp; Left stick to steer · RT accelerate · LT brake · A boost · Y DRS · LB/RB shift · Start pause · View change camera. Touch controls appear on touch devices.</p><div class="modal-actions"><button class="primary-button" data-action="close">GOT IT</button></div>`;
  }else if(type==='circuit'){
    title='The original temple of speed.';
    content=`<p class="modal-copy">5.793 kilometres through Monza’s historic park. A clockwise Grand Prix circuit with seven right turns and four lefts.</p>${fullMap()}<div class="circuit-corners">${[['01–02','Variante del Rettifilo'],['03','Curva Grande'],['04–05','Variante della Roggia'],['06–07','Curve di Lesmo'],['08–10','Variante Ascari'],['11','Curva Alboreto / Parabolica']].map(([n,name])=>`<div><b>${n}</b><span>${name}</span></div>`).join('')}</div><p class="attribution">Circuit centerline from <a href="https://github.com/bacinger/f1-circuits" target="_blank" rel="noreferrer">Tomislav Bacinger’s geographic dataset</a>. Dimensions from <a href="https://www.monzanet.it/en/circuit/" target="_blank" rel="noreferrer">Autodromo Nazionale Monza</a>. Building footprints, tower and banking bridge locations: <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap contributors</a>, <a href="https://opendatacommons.org/licenses/odbl/1-0/" target="_blank" rel="noreferrer">ODbL 1.0</a>. Car model: <a href="https://sketchfab.com/3d-models/f1-2021-mclaren-mcl35m-967ecec37468412083c40c62b3d7234d" target="_blank" rel="noreferrer">F1 2021 McLaren MCL35M</a> by <a href="https://sketchfab.com/excalibur" target="_blank" rel="noreferrer">Excalibur</a>, <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer">CC BY 4.0</a>. Building heights and façades are photo-informed approximations. Track edges and flat elevation are authored; this is not a laser-scanned circuit. Independent project, unaffiliated with Formula 1 or the circuit.</p>`;
  }else if(type==='telemetry'){
    title='The story of your lap.';
    const lap=session.history[0]||session.best;
    const frames=session.frames.length>20?session.frames:(lap?.frames||[]);
    content=`<div class="lap-summary"><div><span>PERSONAL BEST</span><strong>${formatTime(session.best?.time)}</strong></div><div><span>LAST LAP</span><strong>${formatTime(session.lastTime)}</strong></div><div><span>TOP SPEED</span><strong>${Math.round(Math.max(session.topSpeed,lap?.topSpeed||0))} <small>KM/H</small></strong></div></div>${frames.length>5?`<p class="modal-copy">${session.frames.length>20?'Current run':'Recorded lap'} · Speed and pedal traces over the lap distance.</p>${telemetryChart(frames)}<div class="chart-legend"><span><i style="background:#d6f75b"></i>SPEED</span><span><i style="background:#85b9e8"></i>THROTTLE</span><span><i style="background:#ef896c"></i>BRAKE</span></div>`:'<p class="modal-copy">Your first lap is a blank page. Drive a session to see speed, throttle and brake traces here. Clean laps can become your saved personal best.</p>'}<div class="modal-actions"><button class="primary-button" data-action="close">${resumePhase?'BACK ON TRACK':'BACK TO PADDOCK'}</button>${frames.length>5?'<button class="secondary-button" data-action="export">EXPORT CSV</button>':''}</div>`;
  }
  $('modal-title').textContent=title;$('modal-content').innerHTML=content;$('modal').classList.remove('hidden');
  $('modal-eyebrow').textContent=`APEX / ${type==='pause'?'SESSION PAUSED':type.toUpperCase()}`;
  modalFocus=$('close-modal');modalFocus.focus({preventScroll:true});
  bindPanel(type);
}
function weatherDescription(){return `<p>${settings.weather==='golden'?'Late afternoon. Warm light, long shadows, and the park glowing beyond the barriers.':settings.weather==='clear'?'A clear midday session. Crisp visibility and a bright sky above the circuit.':'Soft light beneath a gray sky. An understated atmosphere with no rain on the racing surface.'}</p>`;}
function closePanel(){
  $('modal').classList.add('hidden');
  if(resumePhase){phase=resumePhase;resumePhase=null;input.setEnabled(phase==='drive');audio.resume().catch(()=>{});accumulator=0;}
  else if(lastActionFocus instanceof HTMLElement)lastActionFocus.focus({preventScroll:true});
}
function bindPanel(type){
  document.querySelectorAll('[data-toggle]').forEach(button=>button.addEventListener('click',()=>{
    const key=button.dataset.toggle;settings[key]=!settings[key];button.classList.toggle('on',settings[key]);button.setAttribute('aria-checked',String(settings[key]));syncSettings();coach.setVisible(settings.racingLine&&phase!=='lobby');
  }));
  document.querySelectorAll('[data-mode]').forEach(button=>button.addEventListener('click',()=>{settings.mode=button.dataset.mode;syncSettings();document.querySelectorAll('[data-mode]').forEach(b=>b.classList.toggle('selected',b.dataset.mode===settings.mode));}));
  $('weather-select')?.addEventListener('change',e=>{settings.weather=e.target.value;rendering.setWeather(settings.weather);world.setWeather?.(settings.weather);syncSettings();$('weather-copy').innerHTML=weatherDescription();});
  $('quality-select')?.addEventListener('change',e=>{settings.quality=e.target.value;rendering.setQuality(settings.quality);syncSettings();});
  $('volume-slider')?.addEventListener('input',e=>{settings.volume=Number(e.target.value);syncSettings();});
}
function telemetryChart(frames){
  const width=520,height=165,pad=18;
  const makePath=fn=>frames.filter((_,i)=>i%Math.max(1,Math.floor(frames.length/600))===0).map((f,i)=>`${i?'L':'M'}${(pad+f[4]/track.length*(width-pad*2)).toFixed(1)},${(height-pad-fn(f)*(height-pad*2)).toFixed(1)}`).join(' ');
  return `<svg class="telemetry-chart" viewBox="0 0 ${width} ${height}" aria-label="Speed, throttle, and brake telemetry"><g stroke="#ffffff12" stroke-width="1">${[.25,.5,.75].map(y=>`<path d="M${pad},${height-pad-y*(height-pad*2)}H${width-pad}"/>`).join('')}${track.lapSectors.map(d=>`<path d="M${pad+d/track.length*(width-pad*2)},${pad}V${height-pad}"/>`).join('')}</g><path d="${makePath(f=>f[6])}" fill="none" stroke="#85b9e8" opacity=".6" stroke-width="1"/><path d="${makePath(f=>f[7])}" fill="none" stroke="#ef896c" opacity=".8" stroke-width="1"/><path d="${makePath(f=>Math.min(f[5]*3.6/360,1))}" fill="none" stroke="#d6f75b" stroke-width="1.5"/><text x="${pad}" y="${height-3}" fill="#8e9e85" font-size="6" font-family="monospace">0 M</text><text x="${width-pad}" y="${height-3}" text-anchor="end" fill="#8e9e85" font-size="6" font-family="monospace">5793 M</text></svg>`;
}
function exportTelemetry(){
  const frames=session.frames.length>20?session.frames:session.history[0]?.frames||session.best?.frames||[];
  const text='time_s,x_m,z_m,heading_rad,lap_distance_m,speed_mps,throttle,brake\n'+frames.map(f=>f.map(n=>n.toFixed(4)).join(',')).join('\n');
  const url=URL.createObjectURL(new Blob([text],{type:'text/csv'}));const a=document.createElement('a');a.href=url;a.download='apex-monza-telemetry.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function bindUI(){
  $('start-button').addEventListener('click',startSession);$('pause-button').addEventListener('click',()=>openPanel('pause'));
  $('close-modal').addEventListener('click',closePanel);
  document.querySelector('.brand')?.addEventListener('click',e=>e.preventDefault());
  document.addEventListener('click',e=>{
    const button=e.target.closest('[data-action]');if(!button)return;
    const action=button.dataset.action;
    if(action==='close'||action==='resume')closePanel();else if(action==='leave')returnToLobby();else if(action==='restart')startSession();else if(action==='demo')startSession(true);else if(action==='takeover')takeControl();else if(action==='camera')cycleCamera();else if(action==='drive'){$('modal').classList.add('hidden');}else if(action==='export')exportTelemetry();else openPanel(action);
  });
  // A finger lifted from a pedal can generate a backdrop click after pausing.
  // Require an explicit resume action whenever a driving session is suspended.
  $('modal').addEventListener('click',e=>{if(e.target===$('modal')&&!resumePhase)closePanel();});
  document.addEventListener('keydown',e=>{
    const modalOpen=!$('modal').classList.contains('hidden');
    if(e.code==='Tab'&&modalOpen){const items=[...$('modal').querySelectorAll('button,a,input,select')];const first=items[0],last=items[items.length-1];if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus()}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus()}return;}
    if(e.target?.matches('input,select,textarea')&&e.code!=='Escape')return;
    if(e.code==='Escape'){e.preventDefault();if(e.repeat)return;if(modalOpen)closePanel();else if(phase==='drive'||phase==='countdown')openPanel('pause');return;}
    if(modalOpen)return;
    if(e.code==='Slash'&&e.shiftKey){e.preventDefault();openPanel('controls');return;}
    if(e.code==='Enter'&&!e.repeat&&phase==='lobby'&&!e.target?.closest('button,a,[role="button"],#car-viewer')){startSession();return;}
    if(e.code==='KeyF'&&!e.repeat){if(document.fullscreenElement)document.exitFullscreen?.();else document.documentElement.requestFullscreen?.().catch(()=>{});}
    if(phase!=='drive')return;
    if(e.repeat)return;
    if(e.code==='KeyC')cycleCamera();
    if(e.code==='KeyR')recover();
    if(e.code==='KeyL'){settings.racingLine=!settings.racingLine;coach.setVisible(settings.racingLine);saveSettings();notice(`BRAKING GUIDE ${settings.racingLine?'ON':'OFF'}`,false,2);}
    if(e.code==='KeyH')document.body.classList.toggle('hud-minimal');
  });
  window.addEventListener('blur',()=>{if(phase==='drive'||phase==='countdown')openPanel('pause');});
  document.addEventListener('visibilitychange',()=>{if(document.hidden&&(phase==='drive'||phase==='countdown'))openPanel('pause');});
  const applyTouch=()=>{input.touch.steer=Number(touches.has('right'))-Number(touches.has('left'));input.touch.throttle=Number(touches.has('throttle'));input.touch.brake=Number(touches.has('brake'));input.touch.boost=touches.has('boost');input.touch.drs=touches.has('drs');input.touch.gearUp=touches.has('gearUp');input.touch.gearDown=touches.has('gearDown');};
  for(const button of document.querySelectorAll('[data-touch]')){
    const name=button.dataset.touch;
    button.addEventListener('pointerdown',e=>{e.preventDefault();button.setPointerCapture(e.pointerId);touches.add(name);button.classList.add('pressed');applyTouch();});
    const release=e=>{touches.delete(name);button.classList.remove('pressed');applyTouch();};
    button.addEventListener('pointerup',release);button.addEventListener('pointercancel',release);button.addEventListener('lostpointercapture',release);
  }
}
function clearTouches(){touches.clear();pendingGearUp=pendingGearDown=false;Object.assign(input.touch,{throttle:0,brake:0,steer:0,boost:false,drs:false,gearUp:false,gearDown:false});document.querySelectorAll('[data-touch]').forEach(b=>b.classList.remove('pressed'));}
function cycleCamera(){if(phase!=='drive'&&phase!=='countdown')return;cameras.cycle();settings.camera=cameras.mode;syncSettings();}
function pollGamepadUI(){
  const pad=Array.from(navigator.getGamepads?.()||[]).find(p=>p?.connected);
  const pause=Boolean(pad?.buttons[9]?.pressed),view=Boolean(pad?.buttons[8]?.pressed);
  if(pause&&!padPauseHeld){if(phase==='paused')closePanel();else if(phase==='drive'||phase==='countdown')openPanel('pause');}
  if(view&&!padViewHeld)cycleCamera();
  padPauseHeld=pause;padViewHeld=view;
}
function takeControl(){
  if(!demo)return;demo=false;session.recordEnabled=true;session.invalidate('CONTROL HANDED OVER · NEXT LAP IS TIMED');
  $('demo-control').classList.add('hidden');$('hud-session').textContent=settings.mode==='timeattack'?'TIME ATTACK':'FREE PRACTICE';
  input.clear();clearTouches();syncSettings();notice('YOU HAVE CONTROL · W / ↑ THROTTLE · S / ↓ BRAKE',false,6);
}
function updateHUD(){
  const s=vehicle.state;
  $('speed').textContent=Math.round(s.speed*3.6);$('gear').textContent=s.gear===0?'N':s.gear;$('rpm').textContent=`${Math.round(s.rpm/100)*100} RPM`;
  $('throttle-bar').style.height=`${s.throttle*100}%`;$('brake-bar').style.height=`${s.brake*100}%`;
  $('lap-time').textContent=session.started?formatTime(session.lapTime):'0:00.000';$('best-time').textContent=formatTime(session.best?.time);$('last-time').textContent=formatTime(session.lastTime);
  $('lap-number').textContent=session.outLap?'OUT LAP':`LAP ${String(session.lap).padStart(2,'0')}`;
  $('session-status').textContent=demo?'DEMONSTRATION — AUTO DRIVER':!session.valid?'LAP INVALID':session.outLap?'OUT LAP · CROSS THE FINISH LINE':input.gamepadConnected?'GAMEPAD CONNECTED':settings.mode==='timeattack'?'TIME ATTACK':'FREE PRACTICE';
  $('session-status').style.color=session.valid?'':'#efa080';
  for(let i=0;i<3;i++)$('sector-'+i).className=i<session.sector?'done':i===session.sector?'active':'';
  const delta=$('delta');
  if(!session.valid){delta.textContent='TRACK LIMITS · LAP INVALID';delta.className='delta positive';}
  else if(session.outLap){delta.textContent='CROSS THE FINISH LINE TO START TIMING';delta.className='delta';}
  else if(session.delta!==null&&session.started){delta.textContent=`${session.delta>=0?'+':'−'}${Math.abs(session.delta).toFixed(3)} TO PERSONAL BEST`;delta.className=`delta ${session.delta>0?'positive':'negative'}`;}
  else{delta.textContent='FIRST LAP · SET A BENCHMARK';delta.className='delta';}
  $('ers-bar').style.width=`${s.ers*100}%`;$('ers-percent').textContent=`${Math.round(s.ers*100)}%`;
  $('ers-status').classList.toggle('active',s.boost);$('drs-status').classList.toggle('active',s.drs);
  $('drs-status').style.opacity=s.drsAvailable?'1':'.5';
  const tempHTML=`${Math.round(s.tyreTemp)}°<small>C</small>`,fuelHTML=`${s.fuel.toFixed(1)}<small>KG</small>`;
  if($('tyre-temp').innerHTML!==tempHTML)$('tyre-temp').innerHTML=tempHTML;
  if($('fuel').innerHTML!==fuelHTML)$('fuel').innerHTML=fuelHTML;
  $('damage').textContent=`CAR HEALTH ${Math.round((1-s.damage)*100)}%`;
  const tempColor=s.tyreTemp>115?'#de845c':s.tyreTemp<70?'#8dbae0':'#a2cf7e';
  for(const id of ['tyre-fl','tyre-fr','tyre-rl','tyre-rr'])$(id).style.borderColor=tempColor;
  [...$('rev-lights').children].forEach((led,i)=>led.classList.toggle('lit',s.rpm>4500+i*510));
  const position=mapProjection(s.x,s.z);$('player-dot').setAttribute('cx',position[0]);$('player-dot').setAttribute('cy',position[1]);
  const next=coach.nextCorner(s.distance);$('corner-distance').textContent=`${Math.round(next.remaining/10)*10} M`;$('next-corner').textContent=next.name.toUpperCase();
  const braking=s.speed>coach.targetSpeed(s.distance)+7;
  $('corner-guide').classList.toggle('brake',braking);$('guide-speed').textContent=braking?'BRAKE · PREPARE FOR THE CORNER':next.remaining<260?`APEX GUIDE ${Math.round(next.targetSpeed*3.6/5)*5} KM/H`:'LOOK AHEAD · FIND YOUR BRAKING POINT';
  let current='RETTILINEO PRINCIPALE';for(const corner of track.corners){const d=(s.distance-corner.distance+track.length)%track.length;if(d<180)current=corner.name.toUpperCase();}
  if(s.distance>track.corners[6].distance+180&&s.distance<track.corners[7].distance-120)current='SERRAGLIO';$('corner-name').textContent=current;
  $('performance').textContent=`${fps} FPS · ${rendering.quality.toUpperCase()}`;
}
function frame(now){
  requestAnimationFrame(frame);
  const rawDt=lastFrame?(now-lastFrame)/1000:1/60;lastFrame=now;
  const dt=Math.min(rawDt,.1);elapsed+=dt;uiTime+=dt;fpsClock+=rawDt;frameCount++;
  if(fpsClock>=1){fps=Math.round(frameCount/fpsClock);fpsClock=0;frameCount=0;}
  pollGamepadUI();
  if(phase==='drive'){
    rendering.adapt(rawDt);
    const controls=demo?pilot.sample(vehicle.state,dt):input.sample(dt);accumulator+=dt;
    pendingGearUp ||= controls.gearUp;pendingGearDown ||= controls.gearDown;
    controls.gearUp=pendingGearUp;controls.gearDown=pendingGearDown;
    while(accumulator>=1/120){vehicle.step(1/120,demo?pilot.sample(vehicle.state,1/120):controls);session.step(1/120,vehicle.state);accumulator-=1/120;controls.gearUp=false;controls.gearDown=false;pendingGearUp=pendingGearDown=false;if(session.lastEvent)notice(session.lastEvent.message,session.lastEvent.type==='invalid',5);}
    if(vehicle.state.collision>.2&&previousCollision<=.2)notice('BARRIER CONTACT · PRESS R TO RECOVER',true,4);
    previousCollision=vehicle.state.collision;
    placeCar();car.update(vehicle.state,dt);cameras.update(vehicle.state,dt,elapsed);audio.update(vehicle.state,dt);effects.update(dt,vehicle.state);
    const ghostState=!demo&&!session.outLap&&settings.ghost&&settings.mode==='timeattack'?session.ghostAt(session.lapTime):null;
    ghost.group.visible=Boolean(ghostState&&session.started&&Math.hypot(ghostState.x-vehicle.state.x,ghostState.z-vehicle.state.z)>3);
    if(ghostState){ghost.group.position.set(ghostState.x,.025,ghostState.z);ghost.group.rotation.y=ghostState.heading;ghost.update(ghostState,dt);const p=mapProjection(ghostState.x,ghostState.z);$('ghost-dot').setAttribute('cx',p[0]);$('ghost-dot').setAttribute('cy',p[1]);}
    $('ghost-dot').style.display=ghostState?'':'none';
  }else if(phase==='countdown'){
    startElapsed+=dt;const signal=getStartSequence(startElapsed,startHold);setStartSignal(signal.litCount,signal.released);
    car.update(vehicle.state,dt);cameras.update(vehicle.state,dt,elapsed);audio.update(vehicle.state,dt);
    if(signal.released){phase='drive';input.setEnabled(true);signalFadeAt=elapsed+.65;notice(demo?'DEMONSTRATION LAP · C CAMERA · TAKE CONTROL WHEN READY':'LIGHTS OUT · W / ↑ THROTTLE · S / ↓ BRAKE · C CAMERA',false,6);}
  }else if(phase==='lobby'){
    cameras.lobby(vehicle.state,elapsed,dt);car.update(vehicle.state,dt);
  }
  if(phase!=='paused')world.update?.(dt,elapsed,vehicle.state);
  // Retain the frozen scene under menus. Settings/resize invalidate the frame,
  // but a paused session need not keep submitting the entire circuit to the GPU.
  if(phase!=='paused'||rendering.needsRender){rendering.updateLighting(car.group.position);rendering.render(elapsed);}
  if(uiTime>=.05){uiTime=0;if(phase==='drive'||phase==='countdown')updateHUD();}
  if(signalFadeAt&&elapsed>=signalFadeAt){$('countdown').classList.add('hidden');signalFadeAt=0;}
  if(elapsed>noticeUntil)$('notice').classList.add('hidden');
}

init();
