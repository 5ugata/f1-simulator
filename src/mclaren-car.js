import * as THREE from 'three';
import {loadCarAsset} from './car-asset.js';
import {publicAsset} from './assets.js';

const vector=values=>new THREE.Vector3(...values);
const MODEL_URL=publicAsset('models/mclaren-mcl35m/');

export async function loadMclarenCar(){
  const [asset,metadata]=await Promise.all([
    loadCarAsset(`${MODEL_URL}mcl35m.gltf`),
    fetch(`${MODEL_URL}metadata.json`).then(response=>{
      if(!response.ok)throw new Error('The McLaren model metadata could not be loaded.');
      return response.json();
    }),
  ]);
  return options=>createMclarenCar(asset,metadata,options);
}

export function createMclarenCar(asset,metadata,{ghost=false}={}){
  const group=new THREE.Group();group.name='McLaren MCL35M';
  const model=asset.scene.clone(true);model.name='Excalibur · MCL35M';
  const materials=new Set();
  model.traverse(object=>{
    if(!object.isMesh)return;
    object.castShadow=!ghost;object.receiveShadow=true;
    if(ghost){
      const tint=material=>{
        const copy=material.clone();copy.transparent=true;copy.opacity=.25;copy.depthWrite=false;
        if(copy.color)copy.color.lerp(new THREE.Color(0xd6f75b),.48);
        materials.add(copy);return copy;
      };
      object.material=Array.isArray(object.material)?object.material.map(tint):tint(object.material);
    }
  });

  // Flatten each animated part beneath a pivot in the exported model's +Y-up,
  // -Z-forward frame, preserving its complete imported world transform.
  function pivotFor(name){
    const object=model.getObjectByName(name);
    if(!object)throw new Error(`The McLaren model is missing its ${name} assembly.`);
    model.updateMatrixWorld(true);
    const pivot=new THREE.Group();pivot.name=`${name}-motion`;
    pivot.position.copy(model.worldToLocal(object.getWorldPosition(new THREE.Vector3())));
    model.add(pivot);pivot.updateMatrixWorld(true);pivot.attach(object);
    return pivot;
  }
  const wheels=metadata.wheels.map(wheel=>{
    const steer=pivotFor(wheel.name),spin=new THREE.Group();spin.name=`${wheel.name}-roll`;
    const assembly=steer.children[0];steer.add(spin);spin.attach(assembly);
    return{...wheel,steer,spin};
  });
  const steering=pivotFor('steering');
  const steeringAxis=vector(metadata.steering?.axis||[0,0,1]).normalize();
  const body=new THREE.Group();body.name='body-motion';
  for(const child of [...model.children])if(!wheels.some(wheel=>wheel.steer===child))body.add(child);
  model.add(body);

  // External artwork keeps its original handedness and UVs. This conversion
  // puts its -Z nose into the simulator's +Z convention; worldRoot's existing
  // reflection then cancels it, so lettering and asymmetric livery stay intact.
  const simulationFrame=new THREE.Group();simulationFrame.scale.z=-1;
  simulationFrame.add(model);group.add(simulationFrame);
  const dimensions={...metadata.dimensions};
  dimensions.min=new THREE.Vector3(asset.bounds.min.x,asset.bounds.min.y,-asset.bounds.max.z);
  dimensions.max=new THREE.Vector3(asset.bounds.max.x,asset.bounds.max.y,-asset.bounds.min.z);

  let elapsed=0,wheelAngle=0;
  function update(state={},dt=1/60){
    dt=THREE.MathUtils.clamp(dt,0,.1);elapsed+=dt;
    const speed=state.forwardSpeed??state.speed??0;
    wheelAngle=state.wheelRotation??(wheelAngle+speed*dt/dimensions.wheelRadius);
    for(const wheel of wheels){
      wheel.steer.rotation.y=wheel.front?-(state.steeringAngle??(state.steering||0)*.34):0;
      wheel.spin.rotation.x=-wheelAngle*dimensions.wheelRadius/wheel.radius;
    }
    steering.quaternion.setFromAxisAngle(steeringAxis,-(state.steering||0)*.95);
    const lateral=THREE.MathUtils.clamp(state.gForce?.x||0,-4,4);
    const longitudinal=THREE.MathUtils.clamp(state.gForce?.y||0,-4,4);
    body.rotation.z=THREE.MathUtils.damp(body.rotation.z,lateral*.003,9,dt);
    body.rotation.x=THREE.MathUtils.damp(body.rotation.x,longitudinal*.002,8,dt);
    const vibration=(state.surface==='kerb'?.005:.0006)*Math.min(Math.abs(speed)/18,1);
    body.position.y=(Number.isFinite(state.rideHeight)?state.rideHeight-.055:0)
      +(state.suspensionTravel||0)*.3+Math.sin(elapsed*87)*vibration;
  }
  const camera=definition=>({position:vector(definition.position),target:vector(definition.target),fov:definition.fov});
  // These descriptors are calibrated against the supplied mesh during import,
  // and use simulator coordinates just like track and vehicle positions.
  const cameraDefinitions=metadata.cameras||{
    cockpit:{position:[0,.815,.42],target:[0,.80,30],fov:74},
    pod:{position:[0,1.40,-.15],target:[0,.78,35],fov:70},
    chase:{position:[0,2.4,-7.1],target:[0,.65,6],fov:54},
    nose:{position:[0,.28,dimensions.frontExtent-.12],target:[0,.35,35],fov:79},
    lobby:{position:[5.5,2.05,6.9],target:[1.5,.75,0],fov:47},
  };
  const cameras=Object.fromEntries(Object.entries(cameraDefinitions).map(([name,definition])=>[name,camera(definition)]));
  update({},0);
  return{group,update,...cameras,dimensions,asset:metadata.source,meshCount:asset.meshes,triangles:asset.triangles,
    setCockpit(){/* The supplied source contains a steering wheel and no driver body to hide. */},
    dispose(){materials.forEach(material=>material.dispose());}};
}
