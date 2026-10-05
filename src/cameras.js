import * as THREE from 'three';
const localToWorld=(point,state,out=new THREE.Vector3())=>{
  const s=Math.sin(state.heading),c=Math.cos(state.heading);
  return out.set(state.x+point.x*c+point.z*s,point.y,state.z-point.x*s+point.z*c);
};
export class Cameras{
  constructor(camera,car,track){
    this.camera=camera;this.car=car;this.track=track;this.mode=0;this.names=['COCKPIT','TV POD','CHASE','NOSE'];
    this.position=new THREE.Vector3();this.target=new THREE.Vector3();this.look=new THREE.Vector3();
    this.smoothedHeading=0;this.initial=true;this.time=0;
    const dimensions=car.dimensions;
    this.lobbyPivot=new THREE.Vector3(0,(dimensions?.height??1.17)*.52,
      ((dimensions?.frontExtent??3.2)-(dimensions?.rearExtent??2.4))/2);
    const offset=(car.lobby?.position||new THREE.Vector3(5.6,2.15,6.9)).clone().sub(this.lobbyPivot);
    this.lobbyHome={azimuth:Math.atan2(offset.x,offset.z),elevation:Math.atan2(offset.y,Math.hypot(offset.x,offset.z)),radius:offset.length()};
    this.lobbyView={...this.lobbyHome};this.lobbyCurrent={...this.lobbyHome};
    this.lobbyLimits={minRadius:3.3,maxRadius:14,minElevation:.08,maxElevation:Math.PI/2-.045};
    this.lobbyOffset=new THREE.Vector3();
  }
  setMode(index){this.mode=((index%4)+4)%4;this.initial=true;this.car.setCockpit?.(this.mode===0);}
  cycle(){this.setMode(this.mode+1);return this.names[this.mode]}
  reset(){this.initial=true;}
  orbitLobby(horizontal,vertical){
    this.lobbyView.azimuth+=horizontal;
    this.lobbyView.elevation=THREE.MathUtils.clamp(this.lobbyView.elevation+vertical,this.lobbyLimits.minElevation,this.lobbyLimits.maxElevation);
  }
  zoomLobby(factor){
    this.lobbyView.radius=THREE.MathUtils.clamp(this.lobbyView.radius*factor,this.lobbyLimits.minRadius,this.lobbyLimits.maxRadius);
  }
  resetLobby(immediate=false){
    // Return by the shortest arc after any number of complete rotations.
    const angle=this.lobbyCurrent.azimuth-this.lobbyHome.azimuth;
    this.lobbyCurrent.azimuth=this.lobbyHome.azimuth+Math.atan2(Math.sin(angle),Math.cos(angle));
    Object.assign(this.lobbyView,this.lobbyHome);
    if(immediate)Object.assign(this.lobbyCurrent,this.lobbyHome);
  }
  lobby(state,time,dt){
    this.car.setCockpit?.(false);
    const width=window.innerWidth,height=window.innerHeight,aspect=width/height;
    const portrait=aspect<.9||(width<=700&&height>550);
    const smoothing=dt>0?1-Math.exp(-dt*18):1;
    for(const key of ['azimuth','elevation','radius'])this.lobbyCurrent[key]=THREE.MathUtils.lerp(this.lobbyCurrent[key],this.lobbyView[key],smoothing);
    const {azimuth,elevation}=this.lobbyCurrent;
    // Fit the complete car on narrow screens. Orbit around the actual model,
    // then frame it beside the home-page copy with an off-center projection.
    const radius=this.lobbyCurrent.radius*(portrait?Math.max(1,.75/aspect):1);
    const horizontal=radius*Math.cos(elevation);
    this.lobbyOffset.set(horizontal*Math.sin(azimuth),radius*Math.sin(elevation),horizontal*Math.cos(azimuth)).add(this.lobbyPivot);
    localToWorld(this.lobbyOffset,state,this.position);
    localToWorld(this.lobbyPivot,state,this.target);
    const ground=this.track.sample(state.distance).position.y;
    this.position.y+=ground;this.target.y+=ground;
    this.position.z*=-1;this.target.z*=-1;
    this.camera.position.copy(this.position);this.camera.up.set(0,1,0);this.camera.lookAt(this.target);
    this.camera.fov=(this.car.lobby?.fov??47)+(portrait?11:0);
    // Short displays reserve more of their height for launch/viewer controls.
    const centerY=portrait?height*.53-48:height*(height<=550?.45:.54);
    this.camera.setViewOffset(width,height,portrait?0:-width*.17,height/2-centerY,width,height);
    this.initial=true;
  }
  update(state,dt,time){
    if(this.camera.view?.enabled)this.camera.clearViewOffset();
    const surface=this.track.sample(state.distance);
    const speed=state.speed;
    const vibration=(Math.sin(time*58)+Math.sin(time*93)*.35)*Math.min(speed/100,1)*.003;
    const lateral=THREE.MathUtils.clamp(state.gForce?.x||0,-4,4);
    const longitudinal=THREE.MathUtils.clamp(state.gForce?.y||0,-4,4);
    let offset,lookAt,fov;
    if(this.mode===0){
      const rig=this.car.cockpit;
      const eye=rig?.position||new THREE.Vector3(0,1.12,-.15);
      offset=new THREE.Vector3().copy(eye);offset.x-=lateral*.012;offset.y+=vibration;offset.z-=longitudinal*.012;
      lookAt=new THREE.Vector3().copy(rig?.target||new THREE.Vector3(0,1.00,35));
      // Preserve the default steering glance while allowing a model to supply
      // its own sightline; a nearby target must not magnify the head turn.
      const glanceScale=Math.abs(lookAt.z-eye.z)/Math.max(1,Math.abs(35-eye.z));
      lookAt.x+=Math.sin(state.steering*.08)*20*glanceScale;
      fov=(rig?.fov??74)+Math.min(speed/110,1)*5;
    }else if(this.mode===1){
      const rig=this.car.pod;
      offset=new THREE.Vector3().copy(rig?.position||new THREE.Vector3(0,1.65,-.82));
      lookAt=new THREE.Vector3().copy(rig?.target||new THREE.Vector3(0,.8,35));
      fov=(rig?.fov??70)+speed*.035;
    }else if(this.mode===2){
      const rig=this.car.chase;
      offset=new THREE.Vector3().copy(rig?.position||new THREE.Vector3(0,2.65,-7.3));
      offset.x-=lateral*.10;offset.y+=speed*.0016;offset.z-=speed*.018;
      lookAt=new THREE.Vector3().copy(rig?.target||new THREE.Vector3(0,.8,9));
      fov=(rig?.fov??54)+speed*.06;
    }else{
      const rig=this.car.nose;
      offset=new THREE.Vector3().copy(rig?.position||new THREE.Vector3(0,.38,3.02));
      lookAt=new THREE.Vector3().copy(rig?.target||new THREE.Vector3(0,.44,35));
      fov=(rig?.fov??79)+speed*.03;
    }
    localToWorld(offset,state,this.position);this.position.y+=surface.position.y;
    localToWorld(lookAt,state,this.target);this.target.y+=surface.position.y;
    this.position.z*=-1;this.target.z*=-1;
    const smoothing=this.mode===2?1-Math.exp(-dt*8):1;
    if(this.initial){this.camera.position.copy(this.position);this.look.copy(this.target);this.initial=false;}
    else{this.camera.position.lerp(this.position,smoothing);this.look.lerp(this.target,this.mode===2?1-Math.exp(-dt*11):1);}
    this.camera.up.set(-Math.cos(state.heading)*lateral*.0016,1,-Math.sin(state.heading)*lateral*.0016).normalize();
    this.camera.lookAt(this.look);this.camera.fov=THREE.MathUtils.lerp(this.camera.fov,fov,1-Math.exp(-dt*6));this.camera.updateProjectionMatrix();
  }
}
