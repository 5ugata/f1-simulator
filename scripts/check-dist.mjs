import assert from 'node:assert/strict';
import {readFile,stat} from 'node:fs/promises';
import {resolve,dirname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';

const dist=resolve(fileURLToPath(new URL('../dist/',import.meta.url)));
const inside=file=>file===dist||file.startsWith(dist+sep);
const visited=new Set();
async function check(file){
  file=resolve(file);
  assert(inside(file),`Asset escapes dist: ${file}`);
  if(visited.has(file))return;
  visited.add(file);
  assert((await stat(file)).isFile(),`Missing built asset: ${file}`);
  const ext=file.split('.').pop();
  if(!['html','css','gltf'].includes(ext))return;
  const text=await readFile(file,'utf8');
  let refs=[];
  if(ext==='html')refs=[...text.matchAll(/(?:src|href)=["']([^"']+)["']/g)].map(m=>m[1]);
  if(ext==='css')refs=[...text.matchAll(/url\(\s*["']?([^\s"')]+)["']?\s*\)/g)].map(m=>m[1]);
  if(ext==='gltf'){
    const gltf=JSON.parse(text);
    refs=[...(gltf.buffers||[]),...(gltf.images||[])].map(asset=>asset.uri).filter(Boolean);
  }
  for(const ref of refs){
    if(ref.startsWith('#')||ref.startsWith('data:'))continue;
    assert(!/^(?:\/|[a-z][a-z\d+.-]*:)/i.test(ref),`Build must use local relative URLs: ${ref} in ${file}`);
    await check(resolve(dirname(file),decodeURIComponent(ref.split(/[?#]/)[0])));
  }
}

await check(resolve(dist,'index.html'));
await check(resolve(dist,'models/mclaren-mcl35m/mcl35m.gltf'));
for(const path of [
  'models/mclaren-mcl35m/metadata.json','models/mclaren-mcl35m/license.txt',
  'data/monza.geojson','data/monza-landmarks.json','data/monza-banking-bridge.json',
  'data/f1-circuits-LICENSE.md','data/monza-landmarks-NOTICE.md','data/openstreetmap-NOTICE.md',
  'data/monza-osm-paddock.json','data/monza-osm-way-34404729.json','data/monza-osm-way-1443867793.json',
  'textures/sky.hdr','textures/park-oak-v1.png','textures/spectators-atlas-v1.png',
  'textures/race-asphalt-clean-v1-diffuse.jpg','textures/race-asphalt-clean-v1-normal.jpg','textures/race-asphalt-clean-v1-roughness.jpg',
  'textures/grass-diffuse.jpg','textures/grass-normal.jpg','textures/ATTRIBUTION.md',
  'fonts/Barlow-LICENSE.txt','fonts/BarlowCondensed-LICENSE.txt','fonts/IBMPlexMono-LICENSE.txt',
  'licenses/three-LICENSE.txt',
])await check(resolve(dist,path));
console.log(`Verified ${visited.size} built files, relative HTML/CSS/glTF dependencies, model textures and notices.`);
