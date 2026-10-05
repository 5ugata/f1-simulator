import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';

// Inspect an officially downloaded glTF/GLB before calibrating the simulator's
// axes, wheel pivots and cockpit. No source geometry or textures are changed.
const file=process.argv[2];
if(!file)throw new Error('Usage: node scripts/inspect-gltf.mjs path/to/scene.gltf-or-model.glb');
const bytes=await readFile(file);
let document;
if(bytes.subarray(0,4).toString()==='glTF'){
  if(bytes.readUInt32LE(4)!==2)throw new Error('Expected a glTF 2.0 GLB.');
  const length=bytes.readUInt32LE(12);
  if(bytes.readUInt32LE(16)!==0x4e4f534a||20+length>bytes.length)throw new Error('Invalid GLB JSON chunk.');
  document=JSON.parse(bytes.subarray(20,20+length).toString().trim());
}else document=JSON.parse(bytes.toString());
if(!String(document.asset?.version).startsWith('2.'))throw new Error('Expected glTF 2.0.');

const accessors=document.accessors||[];
const meshes=(document.meshes||[]).map((mesh,index)=>({index,name:mesh.name||'',
  primitives:mesh.primitives.map(p=>({mode:p.mode??4,
    vertices:accessors[p.attributes.POSITION]?.count,
    indices:accessors[p.indices]?.count,
    bounds:{min:accessors[p.attributes.POSITION]?.min,max:accessors[p.attributes.POSITION]?.max},
    material:document.materials?.[p.material]?.name||p.material,
    extensions:Object.keys(p.extensions||{})}))}));
console.log(JSON.stringify({file:resolve(file),asset:document.asset,
  extensionsRequired:document.extensionsRequired||[],extensionsUsed:document.extensionsUsed||[],
  scene:document.scene??0,scenes:document.scenes||[],
  nodes:(document.nodes||[]).map((n,index)=>({index,name:n.name||'',mesh:n.mesh,skin:n.skin,
    children:n.children,translation:n.translation,rotation:n.rotation,scale:n.scale,matrix:n.matrix})),
  meshes,materials:(document.materials||[]).map((m,index)=>({index,name:m.name||'',
    alphaMode:m.alphaMode||'OPAQUE',doubleSided:m.doubleSided||false,extensions:Object.keys(m.extensions||{})})),
  images:document.images||[],buffers:document.buffers||[],
  animations:(document.animations||[]).map(a=>({name:a.name||'',channels:a.channels.length})),
},null,2));
