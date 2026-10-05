import {fileURLToPath} from 'node:url';
import {browserOptions} from './browser-options.mjs';
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';

const origin=process.env.APEX_URL||'http://127.0.0.1:4173';
const artifacts=fileURLToPath(new URL('../artifacts/',import.meta.url));
await mkdir(artifacts,{recursive:true});
const browser=await chromium.launch(browserOptions());
let page;
try{
  page=await browser.newPage({viewport:{width:1440,height:900},deviceScaleFactor:1,hasTouch:true});
  page.setDefaultTimeout(90000);
  await page.addInitScript(()=>localStorage.setItem('apex-settings',JSON.stringify({quality:'performance',volume:0,camera:0})));
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('console',message=>{if(message.type()==='error'&&!message.text().includes('fonts.googleapis'))errors.push(message.text())});
  await page.goto(origin,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.__APEX__?.ready);
  const viewer=page.locator('#car-viewer');
  await viewer.waitFor({state:'visible'});
  assert.equal(await viewer.evaluate(element=>element.tabIndex>=0),true,'The car viewer is keyboard accessible');
  assert.equal(await page.evaluate(()=>__APEX__.car.asset.uid),'967ecec37468412083c40c62b3d7234d');

  // Wait for camera damping, with a bounded number of stable rendered samples.
  const settle=async()=>{
    await page.evaluate(()=>{delete window.__viewerStability});
    await page.waitForFunction(()=>{
      const camera=__APEX__.rendering.camera;
      const values=[...camera.position.toArray(),...camera.quaternion.toArray(),camera.fov,...camera.projectionMatrix.elements];
      const previous=window.__viewerStability;
      const stable=previous&&values.every((value,index)=>Math.abs(value-previous.values[index])<.00005);
      const frames=stable?previous.frames+1:0;
      window.__viewerStability={values,frames};
      return frames>=8;
    },null,{timeout:20000});
  };
  const snapshot=()=>page.evaluate(()=>{
    const app=__APEX__,camera=app.rendering.camera;
    const center=app.cameras.target;
    return {
      position:camera.position.toArray(),quaternion:camera.quaternion.toArray(),radius:camera.position.distanceTo(center),
      viewEnabled:!!camera.view?.enabled,phase:app.phase,
      car:{position:app.car.group.position.toArray(),rotation:app.car.group.quaternion.toArray(),x:app.state.x,z:app.state.z,heading:app.state.heading,speed:app.state.speed},
    };
  });
  const distance=(a,b)=>Math.hypot(...a.map((value,index)=>value-b[index]));
  const unchanged=(actual,expected,message)=>{
    assert(distance(actual.position,expected.position)<.015,`${message}: camera position`);
    assert(distance(actual.quaternion,expected.quaternion)<.002,`${message}: camera direction`);
  };
  const orbitChanged=(actual,expected,message)=>{
    assert(distance(actual.position,expected.position)>.12,`${message}: camera orbits`);
    assert(Math.abs(actual.radius-expected.radius)<.06,`${message}: orbit does not pan or zoom`);
    assert.deepEqual(actual.car,expected.car,`${message}: the physical McLaren stays in place`);
  };
  // Find an unobstructed horizontal strip; page text and controls can overlap
  // the transparent viewer and must receive their own normal pointer events.
  const strip=async(span=180)=>{
    const point=await viewer.evaluate((element,span)=>{
      const rect=element.getBoundingClientRect();
      for(const fy of [.5,.6,.4,.7,.3,.8,.2])for(const fx of [.5,.6,.4,.7,.3]){
        const x=rect.x+rect.width*fx,y=rect.y+rect.height*fy;
        const usable=[-.5,-.25,0,.25,.5].every(fraction=>{
          const hit=document.elementFromPoint(x+span*fraction,y);
          return hit===element||element.contains(hit);
        });
        if(usable)return {x,y,span};
      }
      return null;
    },span);
    assert(point,'The viewer has a usable drag area clear of home-page controls');
    return point;
  };
  const drag=async(point,amount=point.span)=>{
    await page.mouse.move(point.x-amount/2,point.y);
    await page.mouse.down();
    await page.mouse.move(point.x+amount/2,point.y,{steps:12});
    await page.mouse.up();
    await settle();
  };
  await settle();
  const initial=await snapshot();
  const desktop=await strip();
  await drag(desktop);
  const orbited=await snapshot();
  orbitChanged(orbited,initial,'Mouse drag');
  await page.screenshot({path:`${artifacts}viewer-desktop-orbit.png`});

  await page.mouse.move(desktop.x,desktop.y);
  await page.mouse.wheel(0,-180);
  await settle();
  const zoomed=await snapshot();
  assert(zoomed.radius<orbited.radius-.15,'Mouse wheel zooms toward the McLaren');
  await page.mouse.wheel(0,180);
  await settle();
  assert((await snapshot()).radius>zoomed.radius+.15,'Mouse wheel zooms back out');
  await page.getByRole('button',{name:'Zoom in',exact:true}).click();
  await settle();
  const buttonZoom=await snapshot();
  await page.getByRole('button',{name:'Zoom out',exact:true}).click();
  await settle();
  assert((await snapshot()).radius>buttonZoom.radius+.15,'Visible zoom buttons work');

  const reset=page.getByRole('button',{name:'Reset car view',exact:true});
  await reset.focus();
  await page.keyboard.press('Enter');
  await settle();
  assert.equal((await snapshot()).phase,'lobby','Enter on Reset does not start a session');
  unchanged(await snapshot(),initial,'Reset restores the home camera');
  await viewer.focus();
  await page.keyboard.press('ArrowRight');
  await settle();
  const keyboardOrbit=await snapshot();
  orbitChanged(keyboardOrbit,initial,'Keyboard arrow');
  await page.keyboard.press('+');
  await settle();
  assert((await snapshot()).radius<keyboardOrbit.radius-.1,'Keyboard plus zooms in');
  await page.keyboard.press('Home');
  await settle();
  unchanged(await snapshot(),initial,'Home resets the viewer');
  assert.equal((await snapshot()).phase,'lobby');

  await page.mouse.move(desktop.x,desktop.y);
  for(let i=0;i<5;i++)await page.mouse.wheel(0,-2000);
  await settle();
  assert(await page.getByRole('button',{name:'Zoom in',exact:true}).isDisabled(),'Close zoom stops outside the car');
  for(let i=0;i<5;i++)await page.mouse.wheel(0,2000);
  await settle();
  assert(await page.getByRole('button',{name:'Zoom out',exact:true}).isDisabled(),'Far zoom has a bounded limit');
  await reset.click();
  await settle();

  await page.getByRole('button',{name:'Settings',exact:true}).click();
  const modalView=await snapshot();
  const title=await page.locator('#modal-title').boundingBox();
  assert(title);
  await page.mouse.move(title.x+30,title.y+title.height/2);
  await page.mouse.down();
  await page.mouse.move(title.x+150,title.y+title.height/2,{steps:8});
  await page.mouse.up();
  await page.mouse.wheel(0,-180);
  await page.keyboard.press('ArrowRight');
  await settle();
  unchanged(await snapshot(),modalView,'A settings modal blocks background car controls');
  await page.getByRole('button',{name:'SAVE & CONTINUE'}).click();

  await page.getByRole('button',{name:'ENTER COCKPIT'}).click();
  await page.waitForFunction(()=>__APEX__.phase==='drive');
  assert.equal(await page.evaluate(()=>__APEX__.camera),'COCKPIT');
  assert.equal((await snapshot()).viewEnabled,false,'Lobby framing is removed from the driving camera');
  const cockpitError=await page.evaluate(()=>{
    const app=__APEX__,state=app.state,eye=app.car.cockpit.position;
    const sine=Math.sin(state.heading),cosine=Math.cos(state.heading);
    const expected=app.rendering.camera.position.clone().set(state.x+eye.x*cosine+eye.z*sine,eye.y+app.track.sample(state.distance).position.y,-(state.z-eye.x*sine+eye.z*cosine));
    return expected.distanceTo(app.rendering.camera.position);
  });
  assert(cockpitError<.05,'Driving starts inside the imported McLaren cockpit');
  await page.keyboard.press('c');
  await page.keyboard.press('c');
  await page.waitForFunction(()=>__APEX__.camera==='CHASE');
  assert.equal((await snapshot()).viewEnabled,false,'Third-person driving also clears lobby framing');
  await page.keyboard.press('c');
  await page.keyboard.press('c');
  await page.waitForFunction(()=>__APEX__.camera==='COCKPIT');
  await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'BACK ON TRACK'}).click();
  await page.waitForFunction(()=>__APEX__.phase==='drive');
  assert.equal((await snapshot()).viewEnabled,false,'Resume keeps the driving projection');
  await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'EXIT TO PADDOCK'}).click();
  await page.waitForFunction(()=>__APEX__.phase==='lobby');

  await page.setViewportSize({width:390,height:844});
  await reset.click();
  await settle();
  const portrait=await snapshot();
  const touchArea=await strip(160);
  const client=await page.context().newCDPSession(page);
  const touch=(type,points)=>client.send('Input.dispatchTouchEvent',{type,touchPoints:points.map(([id,x,y])=>({id,x,y,radiusX:5,radiusY:5,force:1}))});
  await touch('touchStart',[[1,touchArea.x-45,touchArea.y]]);
  for(let step=1;step<=8;step++)await touch('touchMove',[[1,touchArea.x-45+step*12,touchArea.y]]);
  await touch('touchEnd',[]);
  await settle();
  const touchOrbit=await snapshot();
  orbitChanged(touchOrbit,portrait,'Single-finger drag');
  await touch('touchStart',[[2,touchArea.x-30,touchArea.y],[3,touchArea.x+30,touchArea.y]]);
  for(const halfSpan of [40,50,60,70])await touch('touchMove',[[2,touchArea.x-halfSpan,touchArea.y],[3,touchArea.x+halfSpan,touchArea.y]]);
  await touch('touchEnd',[]);
  await settle();
  const pinched=await snapshot();
  assert(pinched.radius<touchOrbit.radius-.3,'Spreading two fingers zooms toward the car');
  assert.deepEqual(pinched.car,portrait.car,'Touch inspection does not move the physical McLaren');
  assert.equal(await page.evaluate(()=>window.visualViewport.scale),1,'Pinch controls the car instead of magnifying the page');

  await reset.click();
  await settle();
  await touch('touchStart',[[4,touchArea.x-30,touchArea.y]]);
  await touch('touchMove',[[4,touchArea.x+30,touchArea.y]]);
  await touch('touchCancel',[]);
  await settle();
  const cancelled=await snapshot();
  await page.mouse.move(touchArea.x-60,touchArea.y);
  await page.mouse.move(touchArea.x+60,touchArea.y,{steps:6});
  await settle();
  unchanged(await snapshot(),cancelled,'Pointer cancellation does not leave a stuck drag');
  await touch('touchStart',[[5,touchArea.x-35,touchArea.y]]);
  await touch('touchMove',[[5,touchArea.x+35,touchArea.y]]);
  await touch('touchEnd',[]);
  await settle();
  orbitChanged(await snapshot(),cancelled,'A new single touch works after cancellation');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'Portrait viewer stays inside the viewport');
  await page.screenshot({path:`${artifacts}viewer-portrait-orbit.png`});
  await reset.click();
  await settle();
  unchanged(await snapshot(),portrait,'Portrait reset restores its framing');
  await page.screenshot({path:`${artifacts}viewer-portrait-reset.png`});
  for(const size of [{width:360,height:640},{width:700,height:500},{width:932,height:430}]){
    await page.setViewportSize(size);
    await settle();
    const bounds=await page.locator('.car-viewer-buttons').boundingBox();
    assert(bounds&&bounds.x>=0&&bounds.x+bounds.width<=size.width,'Viewer buttons fit narrow and landscape screens');
    const start=await page.locator('#start-button').boundingBox();
    assert(bounds.y+bounds.height<=start.y,'Viewer controls stay above the session launch bar');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'Viewer layout does not overflow');
    await page.screenshot({path:`${artifacts}viewer-${size.width}x${size.height}.png`});
  }
  assert.deepEqual(errors,[],'No browser runtime or WebGL errors');
  console.log('Car viewer passed: mouse orbit/wheel, buttons, keyboard/reset, modal isolation, McLaren cockpit transition/resume, touch orbit/pinch/cancel, and portrait layout.');
}catch(error){
  await page?.screenshot({path:`${artifacts}viewer-failure.png`,timeout:15000}).catch(()=>{});
  throw error;
}finally{
  await browser.close();
}
