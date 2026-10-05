import {readFile,mkdir,writeFile,cp} from 'node:fs/promises';
import * as THREE from 'three';

// Lossless triangle/material conversion of the user-supplied official glTF.
// Only coordinate normalization and rigid wheel/steering partitions change.
const input=new URL('../imports/mclaren-gltf/',import.meta.url);
const output=new URL('../public/models/mclaren-mcl35m/',import.meta.url);
const source=JSON.parse(await readFile(new URL('scene.gltf',input),'utf8'));
const sourceBuffers=await Promise.all(source.buffers.map(b=>readFile(new URL(b.uri,input))));
const components={SCALAR:1,VEC2:2,VEC3:3,VEC4:4};
function accessor(index){
  const a=source.accessors[index],v=source.bufferViews[a.bufferView],buffer=sourceBuffers[v.buffer];
  const count=components[a.type],bytes=a.componentType===5123?2:4,stride=v.byteStride||bytes*count;
  if(![5123,5125,5126].includes(a.componentType))throw new Error(`Unsupported accessor ${index}`);
  const values=new (a.componentType===5126?Float32Array:Uint32Array)(a.count*count);
  for(let i=0;i<a.count;i++)for(let c=0;c<count;c++){
    const offset=(v.byteOffset||0)+(a.byteOffset||0)+i*stride+c*bytes;
    values[i*count+c]=a.componentType===5126?buffer.readFloatLE(offset):a.componentType===5123?buffer.readUInt16LE(offset):buffer.readUInt32LE(offset);
  }
  return values;
}
const records=[],overall=new THREE.Box3();
function visit(index,parent){
  const n=source.nodes[index],local=n.matrix?new THREE.Matrix4().fromArray(n.matrix):new THREE.Matrix4().compose(
    new THREE.Vector3(...(n.translation||[0,0,0])),new THREE.Quaternion(...(n.rotation||[0,0,0,1])),new THREE.Vector3(...(n.scale||[1,1,1])));
  const matrix=new THREE.Matrix4().multiplyMatrices(parent,local),normal=new THREE.Matrix3().getNormalMatrix(matrix);
  if(n.mesh!==undefined)for(const p of source.meshes[n.mesh].primitives){
    if((p.mode??4)!==4)throw new Error('Expected source triangle primitives.');
    const positions=accessor(p.attributes.POSITION),normals=accessor(p.attributes.NORMAL),uv=accessor(p.attributes.TEXCOORD_0),indices=accessor(p.indices);
    const point=new THREE.Vector3();
    for(let i=0;i<positions.length;i+=3){point.fromArray(positions,i).applyMatrix4(matrix);overall.expandByPoint(point);point.toArray(positions,i);point.fromArray(normals,i).applyNormalMatrix(normal).toArray(normals,i);}
    records.push({positions,normals,uv,indices,material:p.material,name:source.materials[p.material].name});
  }
  for(const child of n.children||[])visit(child,matrix);
}
for(const root of source.scenes[source.scene||0].nodes)visit(root,new THREE.Matrix4());
const tyre=records.find(r=>r.name==='tread_png');
if(!tyre)throw new Error('The supplied file does not contain the expected McLaren tyre material.');
const wheelBounds=new Map();
const splitZ=(overall.min.z+overall.max.z)/2;
for(let i=0;i<tyre.positions.length;i+=3){
  const p=new THREE.Vector3().fromArray(tyre.positions,i),key=`${p.z>splitZ?'F':'R'}${p.x>0?'L':'R'}`;
  if(!wheelBounds.has(key))wheelBounds.set(key,new THREE.Box3());wheelBounds.get(key).expandByPoint(p);
}
const rawWheels=[...wheelBounds].map(([key,bounds])=>({name:`wheel${key}`,front:key[0]==='F',side:key[1]==='L'?-1:1,bounds,center:bounds.getCenter(new THREE.Vector3())}));
const average=(items,fn)=>items.reduce((sum,item)=>sum+fn(item),0)/items.length;
const rawFront=average(rawWheels.filter(w=>w.front),w=>w.center.z),rawRear=average(rawWheels.filter(w=>!w.front),w=>w.center.z);
const scale=2/(overall.max.x-overall.min.x),originX=(overall.min.x+overall.max.x)/2,originZ=rawFront-(rawFront-rawRear)*.55,ground=overall.min.y;
const convert=p=>new THREE.Vector3(-(p.x-originX)*scale,(p.y-ground)*scale,-(p.z-originZ)*scale);
const wheels=rawWheels.map(w=>({...w,position:convert(w.center).toArray(),radius:(w.bounds.max.y-w.bounds.min.y)*scale/2,width:(w.bounds.max.x-w.bounds.min.x)*scale}));
const steeringRecord=records.find(r=>r.name==='st_wheel_png'),steeringBounds=new THREE.Box3();
for(let i=0;i<steeringRecord.positions.length;i+=3)steeringBounds.expandByPoint(new THREE.Vector3().fromArray(steeringRecord.positions,i));
const steeringPosition=convert(steeringBounds.getCenter(new THREE.Vector3())).toArray();
const pivots={body:[0,0,0],steering:steeringPosition,...Object.fromEntries(wheels.map(w=>[w.name,w.position]))};
const parts=new Map(Object.keys(pivots).map(name=>[name,[]]));
for(const record of records){
  const groups=new Map();
  for(let i=0;i<record.indices.length;i+=3){
    let part='body';
    if(record.name==='st_wheel_png')part='steering';
    else if(['rim_png','tread_png','tyrewall_png'].includes(record.name)){
      const centroid=new THREE.Vector3();
      for(let k=0;k<3;k++)centroid.add(new THREE.Vector3().fromArray(record.positions,record.indices[i+k]*3));
      centroid.multiplyScalar(1/3);
      part=rawWheels.reduce((best,w)=>w.center.distanceToSquared(centroid)<best.center.distanceToSquared(centroid)?w:best,rawWheels[0]).name;
    }
    if(!groups.has(part))groups.set(part,[]);groups.get(part).push(...record.indices.subarray(i,i+3));
  }
  for(const [part,indices]of groups)parts.get(part).push({record,indices});
}
const result={asset:{version:'2.0',generator:'APEX lossless McLaren coordinate/rig conversion',copyright:'Excalibur — CC BY 4.0'},
  scene:0,scenes:[{name:'McLaren MCL35M',nodes:[]}],nodes:[],meshes:[],materials:source.materials,
  textures:source.textures,images:source.images,samplers:source.samplers,accessors:[],bufferViews:[],buffers:[]};
const chunks=[];let byteLength=0;
function append(values,type,target,bounds){
  const pad=(4-byteLength%4)%4;if(pad){chunks.push(Buffer.alloc(pad));byteLength+=pad;}
  const data=Buffer.from(values.buffer,values.byteOffset,values.byteLength),view=result.bufferViews.length;
  result.bufferViews.push({buffer:0,byteOffset:byteLength,byteLength:data.length,target});chunks.push(data);byteLength+=data.length;
  const index=result.accessors.length;
  result.accessors.push({bufferView:view,componentType:values instanceof Float32Array?5126:5125,count:values.length/components[type],type,...bounds});return index;
}
let triangleCount=0;
for(const [part,groups]of parts){
  const primitives=[],pivot=new THREE.Vector3(...pivots[part]);
  for(const {record,indices}of groups){
    const remap=new Map(),p=[],n=[],u=[],compact=[],bounds=new THREE.Box3();
    for(const old of indices){
      if(!remap.has(old)){
        remap.set(old,remap.size);
        const point=convert(new THREE.Vector3().fromArray(record.positions,old*3)).sub(pivot);
        bounds.expandByPoint(point);p.push(...point.toArray());n.push(-record.normals[old*3],record.normals[old*3+1],-record.normals[old*3+2]);u.push(record.uv[old*2],record.uv[old*2+1]);
      }
      compact.push(remap.get(old));
    }
    primitives.push({attributes:{POSITION:append(new Float32Array(p),'VEC3',34962,{min:bounds.min.toArray(),max:bounds.max.toArray()}),NORMAL:append(new Float32Array(n),'VEC3',34962),TEXCOORD_0:append(new Float32Array(u),'VEC2',34962)},indices:append(new Uint32Array(compact),'SCALAR',34963),material:record.material,mode:4});
    triangleCount+=indices.length/3;
  }
  result.scenes[0].nodes.push(result.nodes.length);result.nodes.push({name:part,translation:pivots[part],mesh:result.meshes.length});result.meshes.push({name:part,primitives});
}
const originalTriangles=records.reduce((sum,r)=>sum+r.indices.length/3,0);
if(triangleCount!==originalTriangles)throw new Error('Conversion changed the triangle count.');
result.buffers.push({uri:'mcl35m.bin',byteLength});
const front=wheels.filter(w=>w.front),rear=wheels.filter(w=>!w.front),minimum=convert(new THREE.Vector3(overall.max.x,overall.min.y,overall.max.z)),maximum=convert(new THREE.Vector3(overall.min.x,overall.max.y,overall.min.z));
const wheelbase=(rawFront-rawRear)*scale;
const metadata={source:{uid:'967ecec37468412083c40c62b3d7234d',name:'F1 2021 McLaren MCL35M',author:'Excalibur',url:'https://sketchfab.com/3d-models/f1-2021-mclaren-mcl35m-967ecec37468412083c40c62b3d7234d',license:'CC-BY-4.0',licenseUrl:'https://creativecommons.org/licenses/by/4.0/'},
  triangles:triangleCount,basis:{up:'+Y',front:'-Z',right:'+X'},normalization:{scale,sourceOrigin:[originX,ground,originZ],rotationYDegrees:180},bounds:{min:minimum.toArray(),max:maximum.toArray()},
  dimensions:{width:2,length:maximum.z-minimum.z,height:maximum.y-minimum.y,wheelbase,frontAxle:wheelbase*.55,rearAxle:-wheelbase*.45,wheelRadius:average(rear,w=>w.radius),frontExtent:-minimum.z,rearExtent:maximum.z,frontTrack:Math.abs(front[0].position[0]-front[1].position[0]),rearTrack:Math.abs(rear[0].position[0]-rear[1].position[0]),frontTyreWidth:average(front,w=>w.width),rearTyreWidth:average(rear,w=>w.width)},
  wheels:wheels.map(({name,front,side,position,radius,width})=>({name,front,side,position,radius,width})),steering:{position:steeringPosition,axis:[0,0,1]},
  changes:['Uniform scale to 2 m total width; original proportions preserved','Rigid coordinate rotation and center-of-mass origin alignment','Wheel and steering triangles partitioned for runtime animation','Original material parameters, UVs and PNG files preserved; no decimation'],
};
await mkdir(output,{recursive:true});await cp(new URL('textures',input),new URL('textures',output),{recursive:true});
await cp(new URL('license.txt',input),new URL('license.txt',output));
await writeFile(new URL('mcl35m.bin',output),Buffer.concat(chunks));await writeFile(new URL('mcl35m.gltf',output),JSON.stringify(result));await writeFile(new URL('metadata.json',output),JSON.stringify(metadata,null,2)+'\n');
console.log(JSON.stringify({output:output.pathname,triangles:triangleCount,dimensions:metadata.dimensions,wheels:metadata.wheels,steering:metadata.steering},null,2));
