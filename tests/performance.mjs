import {browserOptions} from './browser-options.mjs';
import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
const browser=await chromium.launch(browserOptions());
try{
 const page=await browser.newPage({viewport:{width:1440,height:900}});
 page.setDefaultTimeout(90000);
 await page.addInitScript(()=>localStorage.setItem('apex-settings',JSON.stringify({quality:'performance',volume:0})));
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto(process.env.APEX_URL||'http://127.0.0.1:4173');await page.waitForFunction(()=>window.__APEX__?.ready);
 await page.getByRole('button',{name:'ENTER COCKPIT'}).click();await page.waitForFunction(()=>__APEX__.phase==='drive');
 // Let normal adaptive scaling settle, then freeze it so diagnostic comparisons
 // change one variable at a time. This override exists only inside this test.
 await page.waitForTimeout(14000);
 const environment=await page.evaluate(()=>{__APEX__.rendering.adapt=()=>{};const gl=__APEX__.rendering.renderer.getContext();const ext=gl.getExtension('WEBGL_debug_renderer_info');return{viewport:[innerWidth,innerHeight],gpu:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),quality:__APEX__.rendering.quality}});
 const measurements=[];
 async function measure(label){
  const result=await page.evaluate(async()=>{
   const times=[],calls=[],triangles=[],renderer=__APEX__.rendering.renderer;
   let before=performance.now();
   for(let i=0;i<120;i++){
    await new Promise(r=>requestAnimationFrame(r));const now=performance.now();
    if(i>=20){times.push(now-before);calls.push(renderer.info.render.calls);triangles.push(renderer.info.render.triangles);}
    before=now;
   }
   const mean=values=>values.reduce((sum,value)=>sum+value,0)/values.length;
   times.sort((a,b)=>a-b);
   return{fps:1000/mean(times),medianMs:times[Math.floor(times.length*.5)],p95Ms:times[Math.floor(times.length*.95)],
    pixelRatio:renderer.getPixelRatio(),buffer:[renderer.domElement.width,renderer.domElement.height],
    draws:{mean:mean(calls),min:Math.min(...calls),max:Math.max(...calls)},triangles:{mean:mean(triangles),min:Math.min(...triangles),max:Math.max(...triangles)}};
  });
  measurements.push({label,...result});console.log(label,result);
 }
 console.log('Graphics environment',environment);
 await measure('grid / settled performance preset');
 await page.evaluate(()=>__APEX__.rendering.renderer.shadowMap.enabled=false);await measure('no shadows');
 await page.evaluate(()=>{__APEX__.rendering.renderer.shadowMap.enabled=true;document.getElementById('hud').style.display='none'});await measure('no HUD composition');
 await page.evaluate(()=>{document.getElementById('hud').style.display=''});await measure('restored baseline');
 await page.evaluate(()=>{__APEX__.rendering.renderer.setPixelRatio(.6);__APEX__.rendering.renderer.setSize(innerWidth,innerHeight,false)});await measure('60% resolution');
 await page.evaluate(()=>{__APEX__.vehicle.reset(3235);__APEX__.cameras.reset()});await measure('banking underpass approach 60%');
 await page.screenshot({path:'artifacts/bridge-cockpit.png'});
 await mkdir('artifacts',{recursive:true});
 await writeFile('artifacts/performance.json',JSON.stringify({timestamp:new Date().toISOString(),environment,measurements,errors},null,2)+'\n');
 if(errors.length)throw new Error(errors.join('\n'));
}finally{await browser.close()}
