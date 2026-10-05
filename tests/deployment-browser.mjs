import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,stat,mkdir,writeFile} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {browserOptions} from './browser-options.mjs';

const dist=resolve(fileURLToPath(new URL('../dist/',import.meta.url)));
const artifacts=fileURLToPath(new URL('../artifacts/',import.meta.url));
await stat(resolve(dist,'index.html')); // Build first; never fall back to source.
await mkdir(artifacts,{recursive:true});
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.gltf':'model/gltf+json','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.ttf':'font/ttf'};
let mount='/';
// No SPA fallback: a bad /textures/... URL under /repository/ really returns
// 404, instead of silently receiving index.html from a development server.
const server=createServer(async(req,res)=>{
  try{
    const path=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    if(!path.startsWith(mount)){res.writeHead(404).end();return;}
    const relative=path.slice(mount.length)||'index.html';
    const file=resolve(dist,relative);
    if(!file.startsWith(dist+sep)||!(await stat(file)).isFile()){res.writeHead(404).end();return;}
    const bytes=await readFile(file);
    res.writeHead(200,{'Content-Type':types[extname(file)]||'application/octet-stream','Content-Length':bytes.length,'Cache-Control':'no-store'}).end(bytes);
  }catch{res.writeHead(404).end();}
});
await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
const origin=`http://127.0.0.1:${server.address().port}`;
let browser;
try{
  browser=await chromium.launch(browserOptions());
  for(const [name,prefix] of [['root','/'],['subdirectory','/github-pages-smoke/']]){
    mount=prefix;
    const context=await browser.newContext({viewport:{width:1100,height:720}});
    try{
      const page=await context.newPage(),errors=[],requests=[],failures=[];
      const trace=[],binaryIds=new Set();
      const cdp=await context.newCDPSession(page);await cdp.send('Network.enable');
      cdp.on('Network.requestWillBeSent',event=>{if(/mcl35m\.(bin|gltf)$/.test(event.request.url)){binaryIds.add(event.requestId);trace.push({event:'request',...event});}});
      for(const event of ['Network.responseReceived','Network.loadingFinished','Network.loadingFailed'])cdp.on(event,data=>{if(binaryIds.has(data.requestId))trace.push({event,...data});});
      page.setDefaultTimeout(90000);
      page.on('pageerror',e=>errors.push(e.message));
      page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
      page.on('requestfailed',r=>failures.push({url:r.url(),error:r.failure()?.errorText}));
      page.on('response',r=>{if(r.status()>=400)errors.push(`${r.status()} ${r.url()}`);});
      page.on('request',r=>{if(r.url().startsWith('http'))requests.push(r.url());});
      await page.addInitScript(()=>{
        localStorage.setItem('apex-settings',JSON.stringify({quality:'performance',volume:0,camera:0}));
        // Observe the native reader without cloning or rereading its body.
        // This distinguishes a truncated response from a late CDP abort event
        // on Three.js's replacement stream after all model bytes were read.
        window.__deploymentReads=[];
        const originalFetch=window.fetch;
        window.fetch=async(...args)=>{
          const response=await originalFetch(...args);
          if(!/mcl35m\.(bin|gltf)$/.test(response.url))return response;
          const result={url:response.url,status:response.status,expected:Number(response.headers.get('Content-Length')),bytes:0,complete:false};
          window.__deploymentReads.push(result);
          const getReader=response.body.getReader.bind(response.body);
          response.body.getReader=(...options)=>{
            const reader=getReader(...options),read=reader.read.bind(reader);
            reader.read=(...options)=>read(...options).then(chunk=>{
              result.bytes+=chunk.value?.byteLength||0;result.complete=chunk.done;
              return chunk;
            });
            return reader;
          };
          return response;
        };
      });
      await page.goto(origin+prefix,{waitUntil:'domcontentloaded'});
      await page.waitForFunction(()=>window.__APEX__?.ready);
      await page.evaluate(()=>document.fonts.ready);
      const app=await page.evaluate(()=>({uid:__APEX__.car.asset.uid,triangles:__APEX__.car.triangles,buildings:__APEX__.world.landmarks.mappedBuildings,kerbs:__APEX__.world.trackDetails.kerbSections}));
      assert.deepEqual(app,{uid:'967ecec37468412083c40c62b3d7234d',triangles:102081,buildings:12,kerbs:14});
      await page.getByRole('button',{name:'ENTER COCKPIT'}).click();
      await page.waitForFunction(()=>__APEX__.phase==='drive');
      assert.equal(await page.evaluate(()=>__APEX__.world.startSignal.litCount),0);
      await page.keyboard.down('w');
      await page.waitForFunction(()=>__APEX__.state.speed>5);
      await page.keyboard.up('w');
      await page.keyboard.press('c');await page.keyboard.press('c');
      await page.waitForFunction(()=>__APEX__.camera==='CHASE');
      await page.screenshot({path:resolve(artifacts,`github-${name}.png`)});
      const reads=await page.evaluate(()=>window.__deploymentReads);
      await writeFile(resolve(artifacts,`github-${name}-network.json`),JSON.stringify({errors,failures,reads,trace,resources:await page.evaluate(()=>performance.getEntriesByType('resource').filter(r=>/mcl35m\.(bin|gltf)$/.test(r.name)).map(r=>r.toJSON()))},null,2));
      for(const result of reads)assert(result.status===200&&result.complete&&result.expected>0&&result.bytes===result.expected,`Incomplete model response: ${JSON.stringify(result)}`);
      assert.equal(reads.length,2,'Both glTF and binary bodies were fully consumed');
      for(const failure of failures){
        assert(failure.error==='net::ERR_ABORTED'&&reads.some(r=>r.url===failure.url&&r.complete&&r.bytes===r.expected),`Unfinished asset request: ${JSON.stringify(failure)}`);
        console.log(`Chromium reported a late abort after a verified complete model body: ${failure.url}`);
      }
      assert.deepEqual(errors,[],`${name}: no missing assets or runtime errors`);
      assert(requests.some(url=>url.endsWith('/mcl35m.bin')),'Full McLaren binary was requested');
      assert(requests.some(url=>url.endsWith('/sky.hdr')),'HDR loaded from the deployment');
      assert(requests.some(url=>url.endsWith('.ttf')),'Local fonts loaded from the deployment');
      for(const url of requests)assert(url.startsWith(origin+prefix),`Request escaped deployment path: ${url}`);
      console.log(`${name}: ${requests.length} local requests, complete McLaren, track, start sequence, acceleration and chase camera passed.`);
    }finally{await context.close();}
  }
}finally{
  await browser?.close();
  await new Promise(resolve=>server.close(resolve));
}
