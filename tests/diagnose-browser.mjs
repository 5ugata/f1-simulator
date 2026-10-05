import {browserOptions} from './browser-options.mjs';
import {chromium} from 'playwright';
const browser=await chromium.launch(browserOptions());
try{
 const page=await browser.newPage({viewport:{width:1000,height:650}});
 await page.addInitScript(()=>localStorage.setItem('apex-settings',JSON.stringify({quality:'performance',volume:0})));
 page.on('pageerror',e=>console.log('PAGE ERROR',e.stack));page.on('console',m=>{if(m.type()==='error')console.log('ERROR',m.text().slice(0,700))});
 await page.goto(process.env.APEX_URL||'http://127.0.0.1:4173');
 await page.waitForFunction(()=>window.__APEX__?.ready,null,{timeout:120000});
 console.log('READY',await page.evaluate(()=>({fps:__APEX__.fps,phase:__APEX__.phase,hidden:document.hidden,renderer:__APEX__.rendering.renderer.info.render})));
 await page.getByRole('button',{name:'ENTER COCKPIT'}).click();
 for(let i=0;i<6;i++){await page.waitForTimeout(5000);console.log(await page.evaluate(()=>({fps:__APEX__.fps,phase:__APEX__.phase,hidden:document.hidden,counter:document.getElementById('countdown').textContent,modal:document.getElementById('modal-title').textContent,speed:__APEX__.state.speed})));}
 await page.screenshot({path:'artifacts/diagnostic.png',timeout:90000});
}finally{await browser.close()}
