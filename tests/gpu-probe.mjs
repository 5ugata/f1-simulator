import {browserOptions} from './browser-options.mjs';
import {chromium} from 'playwright';
for(const flags of [[],['--use-gl=angle','--use-angle=gl','--enable-gpu','--ignore-gpu-blocklist'],['--use-gl=angle','--use-angle=vulkan','--enable-features=Vulkan','--enable-gpu']]){
 let browser;try{
 browser=await chromium.launch({...browserOptions(),args:[...browserOptions().args,...flags],timeout:20000});
 const page=await browser.newPage();
 console.log(flags,await page.evaluate(()=>{const c=document.createElement('canvas');const g=c.getContext('webgl2');if(!g)return'no WebGL2';const d=g.getExtension('WEBGL_debug_renderer_info');return {renderer:g.getParameter(d.UNMASKED_RENDERER_WEBGL),vendor:g.getParameter(d.UNMASKED_VENDOR_WEBGL),memory:navigator.deviceMemory};}));
 }catch(e){console.log('FAILED',e.message.slice(0,250))}finally{await browser?.close()}
}
