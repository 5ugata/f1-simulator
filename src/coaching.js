import * as THREE from 'three';
const wrap=(v,n)=>((v%n)+n)%n;

export function createCoach(track,scene,profileSpeed){
  const step=4,count=Math.ceil(track.length/step),spacing=track.length/count;
  const speed=new Float32Array(count);
  const curvature=new Float32Array(count);
  for(let i=0;i<count;i++){
    let max=0;
    for(let j=-3;j<=3;j++) max=Math.max(max,Math.abs(track.sample(i*spacing+j*4).curvature));
    curvature[i]=max;
    speed[i]=profileSpeed?profileSpeed(i*spacing):Math.min(92,Math.sqrt(25/Math.max(.001,max)));
  }
  // Backwards brake integration previews a corner before the apex, then a
  // forwards acceleration bound turns that into a driveable speed envelope.
  for(let pass=0;pass<3;pass++) for(let i=count-1;i>=0;i--){
    const next=speed[(i+1)%count];
    speed[i]=Math.min(speed[i],Math.sqrt(next*next+2*26*spacing));
  }
  for(let pass=0;pass<2;pass++)for(let i=0;i<count;i++){
    const last=speed[wrap(i-1,count)];
    speed[i]=Math.min(speed[i],Math.sqrt(last*last+2*12*spacing));
  }
  const geometry=new THREE.PlaneGeometry(.28,2.0);
  geometry.rotateX(-Math.PI/2);
  const material=new THREE.MeshBasicMaterial({color:0xffffff,transparent:true,opacity:.43,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-2});
  const line=new THREE.InstancedMesh(geometry,material,count);
  const matrix=new THREE.Matrix4(),rotation=new THREE.Quaternion(),scale=new THREE.Vector3(1,1,1),color=new THREE.Color();
  for(let i=0;i<count;i++){
    const p=track.sample(i*spacing);
    const position=p.position.clone();position.y+=.043;
    rotation.setFromAxisAngle(new THREE.Vector3(0,1,0),p.heading);
    matrix.compose(position,rotation,scale);line.setMatrixAt(i,matrix);
    const decel=speed[wrap(i+5,count)]-speed[i];
    color.set(decel < -2 ? 0xff694b : speed[i]<45 ? 0xe8c34c : 0xb6e878);
    line.setColorAt(i,color);
  }
  line.instanceMatrix.needsUpdate=true;line.instanceColor.needsUpdate=true;
  line.frustumCulled=false;scene.add(line);
  function targetSpeed(distance){return speed[Math.floor(wrap(distance,track.length)/spacing)%count];}
  function nextCorner(distance){
    let next=track.corners[0],remaining=Infinity;
    // Chicane pairs are introduced as one instruction to avoid changing the
    // destination halfway through an already committed turn.
    for(const corner of track.corners.filter(c=>![2,5,9,10].includes(c.number))){
      const d=wrap(corner.distance-distance,track.length);
      if(d<remaining){next=corner;remaining=d;}
    }
    return {...next,remaining,targetSpeed:targetSpeed(next.distance)};
  }
  return {line,targetSpeed,nextCorner,speed,spacing,setVisible(value){line.visible=value}};
}
