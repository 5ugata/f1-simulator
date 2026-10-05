import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';

// The requested McLaren is loaded from an official local download. This helper
// preserves the author's geometry/materials; its inspected scene must still be
// calibrated to car-local axes and wheel/camera pivots before use in main.js.
export async function loadCarAsset(url,{onProgress,manager}={}){
  const gltf=await new GLTFLoader(manager).loadAsync(url,onProgress);
  if(!gltf.scene)throw new Error('The car file contains no default scene.');
  gltf.scene.updateMatrixWorld(true);
  const bounds=new THREE.Box3().setFromObject(gltf.scene);
  const size=bounds.getSize(new THREE.Vector3());
  if(bounds.isEmpty()||![size.x,size.y,size.z].every(Number.isFinite)){
    throw new Error('The car file contains no measurable geometry.');
  }
  let meshes=0,triangles=0;
  gltf.scene.traverse(object=>{
    if(!object.isMesh)return;
    meshes++;
    triangles+=(object.geometry.index?.count??object.geometry.attributes.position?.count??0)/3;
    object.castShadow=true;object.receiveShadow=true;
  });
  return{scene:gltf.scene,animations:gltf.animations,bounds,size,meshes,triangles,parser:gltf.parser};
}
