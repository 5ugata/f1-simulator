import {writeFile} from 'node:fs/promises';
const request='https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@500;600;700;800&family=Barlow:wght@400;500;600;700;800;900&family=IBM+Plex+Mono:wght@400;500;600&display=swap';
const response=await fetch(request,{headers:{'user-agent':'Mozilla/5.0'}});
if(!response.ok)throw new Error(`Font CSS ${response.status}`);
const css=await response.text();let local=css;const paths=new Map();let index=0;
for(const match of css.matchAll(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/g)){
  const url=match[1];if(paths.has(url))continue;
  const r=await fetch(url);if(!r.ok)throw new Error(`Font ${r.status}`);
  const extension=new URL(url).pathname.split('.').pop();const path=`/fonts/apex-${index++}.${extension}`;
  await writeFile(new URL(`../public${path}`,import.meta.url),new Uint8Array(await r.arrayBuffer()));
  // fonts.css lives beside the font files, including on repository Pages URLs.
  paths.set(url,`./${path.split('/').pop()}`);
}
for(const[url,path]of paths)local=local.replaceAll(url,path);
await writeFile(new URL('../public/fonts/fonts.css',import.meta.url),local);
console.log(`Downloaded ${paths.size} local font files.`);
