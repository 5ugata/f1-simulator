import * as THREE from 'three';
import {VEHICLE_CONSTANTS} from './physics.js';

// Match the authored car's rear tyre envelope. Its origin and axle lever arm
// are shared with the physics model; the nominal rear tyre width is 405 mm.
const REAR_TYRE_WIDTH=.405;
const isPaved=surface=>surface==='asphalt'||surface==='kerb';
const isLoose=surface=>surface==='gravel'||surface==='grass';

// Bounded pools keep skid marks and loose-surface feedback inexpensive during
// long sessions. Effects are cosmetic; forces stay in the fixed-step model.
export function createDrivingEffects(root,track,dimensions=VEHICLE_CONSTANTS){
  const rearTyreWidth=dimensions.rearTyreWidth??REAR_TYRE_WIDTH;
  const rearHalfTrack=dimensions.rearTrack/2||(dimensions.width-rearTyreWidth)/2;
  const rearAxle=dimensions.rearAxle;
  const maxMarks=1000,positions=new Float32Array(maxMarks*18),colors=new Float32Array(maxMarks*18);
  const marksGeometry=new THREE.BufferGeometry();
  marksGeometry.setAttribute('position',new THREE.BufferAttribute(positions,3).setUsage(THREE.DynamicDrawUsage));
  marksGeometry.setAttribute('color',new THREE.BufferAttribute(colors,3).setUsage(THREE.DynamicDrawUsage));
  const marks=new THREE.Mesh(marksGeometry,new THREE.MeshBasicMaterial({vertexColors:true,transparent:true,opacity:.34,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-1}));
  marks.frustumCulled=false;root.add(marks);
  const maxParticles=180,particlePositions=new Float32Array(maxParticles*3),particleColors=new Float32Array(maxParticles*3),particleSize=new Float32Array(maxParticles),particleAlpha=new Float32Array(maxParticles);
  const particleGeometry=new THREE.BufferGeometry();
  particleGeometry.setAttribute('position',new THREE.BufferAttribute(particlePositions,3).setUsage(THREE.DynamicDrawUsage));
  particleGeometry.setAttribute('color',new THREE.BufferAttribute(particleColors,3).setUsage(THREE.DynamicDrawUsage));
  particleGeometry.setAttribute('size',new THREE.BufferAttribute(particleSize,1).setUsage(THREE.DynamicDrawUsage));
  particleGeometry.setAttribute('alpha',new THREE.BufferAttribute(particleAlpha,1).setUsage(THREE.DynamicDrawUsage));
  const particles=new THREE.Points(particleGeometry,new THREE.ShaderMaterial({transparent:true,depthWrite:false,vertexColors:true,
    uniforms:{pixelScale:{value:500}},
    vertexShader:`attribute float size;attribute float alpha;varying vec3 vColor;varying float vAlpha;uniform float pixelScale;
    void main(){vColor=color;vAlpha=alpha;vec4 mv=modelViewMatrix*vec4(position,1.);gl_PointSize=clamp(size*pixelScale/max(1.,-mv.z),1.,100.);gl_Position=projectionMatrix*mv;}`,
    fragmentShader:`varying vec3 vColor;varying float vAlpha;void main(){float d=length(gl_PointCoord-.5)*2.;float a=(1.-smoothstep(.05,1.,d))*vAlpha;if(a<.008)discard;gl_FragColor=vec4(vColor,a);}`
  }));
  particles.frustumCulled=false;root.add(particles);
  const pool=Array.from({length:maxParticles},()=>({life:0,maxLife:1,x:0,y:0,z:0,vx:0,vy:0,vz:0,size:1,spark:false}));
  let nextMark=0,nextParticle=0,spawnTimer=0,lastCollision=0;
  const lastContacts=[null,null];
  const wheelContact=(s,side)=>{
    const sin=Math.sin(s.heading),cos=Math.cos(s.heading);
    const x=s.x+cos*side*rearHalfTrack+sin*rearAxle;
    const z=s.z-sin*side*rearHalfTrack+cos*rearAxle;
    const nearest=track.nearest(x,z,s.distance);
    const surface=track.surfaceAt?track.surfaceAt(nearest.distance,nearest.lateral):s.surface;
    return {x,z,surface,y:surface==='kerb'?.077:.037};
  };
  function addMark(a,b,width){
    const dx=b.x-a.x,dz=b.z-a.z,len=Math.hypot(dx,dz);if(len<.2||len>8)return;
    const rx=dz/len*width,rz=-dx/len*width;
    // Counterclockwise from above, including when the car slides backwards.
    const verts=[a.x-rx,a.y,a.z-rz,b.x-rx,b.y,b.z-rz,a.x+rx,a.y,a.z+rz,b.x-rx,b.y,b.z-rz,b.x+rx,b.y,b.z+rz,a.x+rx,a.y,a.z+rz];
    positions.set(verts,nextMark*18);for(let i=0;i<18;i++)colors[nextMark*18+i]=.025;
    nextMark=(nextMark+1)%maxMarks;
    marksGeometry.attributes.position.needsUpdate=true;marksGeometry.attributes.color.needsUpdate=true;
  }
  function emit(s,point,spark=false){
    const p=pool[nextParticle];nextParticle=(nextParticle+1)%maxParticles;
    Object.assign(p,{x:point.x,y:spark?.12:.10,z:point.z,vx:(s.vx||0)*.13+(Math.random()-.5)*(spark?6:1.8),vz:(s.vz||0)*.13+(Math.random()-.5)*(spark?6:1.8),vy:spark?1+Math.random()*3.5:.5+Math.random()*.8,life:spark?.35+Math.random()*.3:1.2+Math.random()*.8,size:spark?.045:.25+Math.random()*.45,spark});
    p.maxLife=p.life;
    const color=spark?[1,.56,.15]:point.surface==='grass'?[.34,.31,.19]:[.52,.46,.34];particleColors.set(color,nextParticle===0?(maxParticles-1)*3:(nextParticle-1)*3);
  }
  function update(dt,s){
    spawnTimer+=dt;
    const contacts=[wheelContact(s,-1),wheelContact(s,1)];
    const slip=Math.abs(s.slip||0)>.07||Math.abs(s.wheelSlip||0)>.2;
    contacts.forEach((contact,i)=>{
      if(s.speed>6&&slip&&isPaved(contact.surface)){
        const previous=lastContacts[i];
        if(previous&&Math.hypot(contact.x-previous.x,contact.z-previous.z)>.7){addMark(previous,contact,rearTyreWidth/2);lastContacts[i]=contact;}
        else if(!previous)lastContacts[i]=contact;
      }else lastContacts[i]=null;
    });
    // A tyre on painted runoff must not inherit gravel from the car centre.
    const looseContacts=contacts.filter(contact=>isLoose(contact.surface));
    if(s.speed>5&&looseContacts.length&&spawnTimer>.025){for(let i=0;i<3;i++)emit(s,looseContacts[Math.floor(Math.random()*looseContacts.length)]);spawnTimer=0;}
    if(s.collision>.25&&lastCollision<=.25)for(let i=0;i<32;i++)emit(s,contacts[Math.floor(Math.random()*contacts.length)],true);
    lastCollision=s.collision;
    pool.forEach((p,i)=>{
      p.life=Math.max(0,p.life-dt);particleAlpha[i]=p.life>0?Math.min(p.life/p.maxLife*2,1)*(p.spark?.85:.30):0;
      if(p.life>0){p.x+=p.vx*dt;p.z+=p.vz*dt;p.y+=p.vy*dt;p.vy-=dt*(p.spark?9.8:.12);if(p.y<.03){p.y=.03;p.vy=Math.abs(p.vy)*.18;}p.vx*=Math.exp(-dt*.8);p.vz*=Math.exp(-dt*.8);if(!p.spark)p.size+=dt*.38;}
      particlePositions.set([p.x,p.y,p.z],i*3);particleSize[i]=p.size;
    });
    for(const attribute of ['position','color','size','alpha'])particleGeometry.attributes[attribute].needsUpdate=true;
    particles.material.uniforms.pixelScale.value=window.innerHeight*.7;
  }
  function reset(){
    positions.fill(0);marksGeometry.attributes.position.needsUpdate=true;
    pool.forEach(p=>p.life=0);
    // Reset can be followed immediately by a paused/lobby render, without an
    // update tick to hide particles. Upload their cleared alpha right away.
    particleAlpha.fill(0);particleGeometry.attributes.alpha.needsUpdate=true;
    nextMark=0;nextParticle=0;spawnTimer=0;lastContacts.fill(null);lastCollision=0;
  }
  return{update,reset};
}
