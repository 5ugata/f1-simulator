import {fileURLToPath} from 'node:url';
import {browserOptions} from './browser-options.mjs';
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
const artifacts=fileURLToPath(new URL('../artifacts/',import.meta.url));
await mkdir(artifacts,{recursive:true});
const browser=await chromium.launch(browserOptions());
try{
  const page=await browser.newPage({viewport:{width:1440,height:900},deviceScaleFactor:1});
  page.setDefaultTimeout(90000);
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
  await page.addInitScript(()=>localStorage.setItem('apex-settings',JSON.stringify({quality:'performance',volume:0,camera:0})));
  await page.goto(process.env.APEX_URL||'http://127.0.0.1:4173',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.__APEX__?.ready);
  const metadata=await page.evaluate(()=>({pit:__APEX__.world.pitComplex,landmarks:__APEX__.world.landmarks,details:__APEX__.world.trackDetails,signal:__APEX__.world.startSignal.metadata}));
  assert.equal(metadata.landmarks.mappedBuildings,12);
  assert.equal(metadata.landmarks.mappedTowers,2);
  assert.equal(metadata.pit.sources.length,3);
  assert(metadata.pit.balconySeats>400);
  assert.equal(metadata.details.kerbSections,14);
  assert.equal(metadata.details.marshalPanels,6);
  assert.equal(metadata.signal.columns,5);
  await writeFile(`${artifacts}track-reference-validation.json`,JSON.stringify(metadata,null,2));
  await page.screenshot({path:`${artifacts}monza-detailed-lobby.png`});
  console.log('Mapped structures, new kerbs and signal loaded');
  await page.getByRole('button',{name:'ENTER COCKPIT'}).click();
  await page.waitForFunction(()=>__APEX__.world.startSignal.litCount===1);
  assert.equal(await page.evaluate(()=>__APEX__.input.enabled),false);
  await page.waitForFunction(()=>__APEX__.world.startSignal.litCount===3);
  await page.keyboard.press('Escape');
  const paused=await page.evaluate(()=>({sequence:__APEX__.startSequence,lamps:__APEX__.world.startSignal.litCount,car:[__APEX__.state.x,__APEX__.state.z,__APEX__.state.speed]}));
  await page.waitForTimeout(400);
  assert.deepEqual(await page.evaluate(()=>({sequence:__APEX__.startSequence,lamps:__APEX__.world.startSignal.litCount,car:[__APEX__.state.x,__APEX__.state.z,__APEX__.state.speed]})),paused,'Pause holds the physical starting sequence and car');
  await page.getByRole('button',{name:'BACK ON TRACK'}).click();
  await page.waitForFunction(()=>__APEX__.world.startSignal.litCount===5);
  assert.equal(await page.locator('#start-lamps>.lit').count(),5);
  assert.equal(await page.evaluate(()=>__APEX__.state.speed),0);
  await page.screenshot({path:`${artifacts}monza-five-reds.png`});
  await page.waitForFunction(()=>__APEX__.phase==='drive');
  assert.equal(await page.evaluate(()=>__APEX__.world.startSignal.litCount),0);
  assert.equal(await page.evaluate(()=>__APEX__.world.startSignal.columns.every(c=>c.material.emissiveIntensity===0)),true);
  assert.equal(await page.evaluate(()=>__APEX__.input.enabled),true);
  assert.equal(await page.evaluate(()=>__APEX__.session.outLap),true);
  await page.keyboard.down('w');await page.waitForFunction(()=>__APEX__.state.speed>8);await page.keyboard.up('w');
  await page.keyboard.press('Escape');
  console.log('Sequential red lights, pause/resume and lights-out release passed');

  // Render reference views from the actual production scene while paused.
  // This deliberately changes only the diagnostic camera, never road geometry.
  await page.evaluate(()=>{document.querySelector('#modal').classList.add('hidden');document.querySelector('#hud').classList.add('hidden');__APEX__.car.group.visible=false;__APEX__.coach.setVisible(false);});
  const shots=[
    ['pit-complex',-390,-52,64,-140,30,5,63],
    ['hospitality',-8,-7,4,-12,31,6,70],
    ['podium',-304,-2,2.0,-278,12,6.2,62],
    ['start-hardware',48,-1,2.3,80,0,6.1,48],
    ['rettifilo',585,0,2.0,650,0,.1,65],
    ['tower-nord',237,0,1.8,274,-15,9.3,62],
  ];
  const renderView=async view=>{
    await page.evaluate(([distance,lateral,height,targetDistance,targetLateral,targetHeight,fov])=>{
      const app=__APEX__,cam=app.rendering.camera;
      const at=(d,l,h)=>{const s=app.track.sample(d);return s.position.addScaledVector(s.right,l).setY(h);};
      const position=at(distance,lateral,height),target=at(targetDistance,targetLateral,targetHeight);
      position.z*=-1;target.z*=-1;cam.clearViewOffset();cam.position.copy(position);cam.up.set(0,1,0);cam.lookAt(target);cam.fov=fov;cam.updateProjectionMatrix();
      app.world.startSignal.setState(5);app.rendering.updateLighting(app.track.sample(targetDistance).position);app.rendering.render(0);
    },view);
  };
  for(const [name,...view] of shots){
    await renderView(view);
    await page.screenshot({path:`${artifacts}monza-${name}.png`});
  }
  // Signal colour must also survive the high-quality OutputPass, which applies
  // exposure to the whole scene independently of each material's toneMapped.
  await page.evaluate(()=>__APEX__.rendering.setQuality('high'));
  for(const weather of ['golden','clear','overcast']){
    await page.evaluate(weather=>__APEX__.rendering.setWeather(weather),weather);
    await renderView(shots.find(([name])=>name==='start-hardware').slice(1));
    await page.screenshot({path:`${artifacts}monza-start-high-${weather}.png`});
  }
  assert.deepEqual(errors,[],'No browser or WebGL errors');
  console.log('Six detailed world views and three high-quality signal lighting views rendered without runtime errors');
}finally{await browser.close();}
