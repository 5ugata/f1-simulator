import * as THREE from 'three';

// Plan positions and dimensions: OSM footprints. Vertical dimensions and
// facade modules: authored from the inspected 2022/2023 Google panoramas and
// the circuit's hospitality brochure. See docs/references/pit-complex.md.
export function createPitComplex({track, root, material, mesh, box, textures, sceneryClearances}, reference) {
  const features=reference?.features||[];
  const metres=6371008.8*Math.PI/180*track.scale;
  const longitudeMetres=metres*Math.cos(track.origin.lat*Math.PI/180);
  const project=([lon,lat])=>new THREE.Vector3((lon-track.origin.lon)*longitudeMetres,0,(lat-track.origin.lat)*metres);
  const silver=material({color:0xbfc6c6,metalness:.65,roughness:.4});
  const pale=material({color:0xc4c8c2,roughness:.91});
  const white=material({color:0xe2e3dc,roughness:.78});
  const dark=material({color:0x20292b,roughness:.7,metalness:.35});
  const recess=material({color:0x111b1d,roughness:.97});
  const glass=material({color:0x385763,roughness:.18,metalness:.65});
  const blue=material({color:0x2676a8,roughness:.68});
  const green=material({color:0x174a35,roughness:.76});
  const ochre=material({color:0xb69849,roughness:.94});
  const metadata={sources:[],garageBays:0,balconySeats:0,referenceImages:['Google Maps · Sep 2022','Google Maps · Jul 2023','Monza 2026 hospitality brochure']};

  function frame(id){
    const feature=features.find(f=>f.osm?.id===id);if(!feature)return null;
    const points=feature.footprint.slice(0,-1).map(project);
    let longest=new THREE.Vector3();
    points.forEach((p,i)=>{const edge=points[(i+1)%points.length].clone().sub(p);if(edge.lengthSq()>longest.lengthSq())longest=edge;});
    if(id===219396377){
      const middle=points.reduce((sum,p)=>sum.add(p),new THREE.Vector3()).multiplyScalar(1/points.length);
      longest.copy(track.sample(track.nearest(middle.x,middle.z).distance).tangent);
    }
    if(longest.z<0)longest.negate();
    const along=longest.normalize(),across=new THREE.Vector3(along.z,0,-along.x);
    const xs=points.map(p=>p.dot(across)),zs=points.map(p=>p.dot(along));
    const minX=Math.min(...xs),maxX=Math.max(...xs),minZ=Math.min(...zs),maxZ=Math.max(...zs);
    const center=across.clone().multiplyScalar((minX+maxX)/2).addScaledVector(along,(minZ+maxZ)/2);
    const width=maxX-minX,length=maxZ-minZ,heading=Math.atan2(along.x,along.z);
    const at=(x,y,z)=>center.clone().addScaledVector(across,x).addScaledVector(along,z).add(new THREE.Vector3(0,y,0));
    const part=(mat,x,y,z,size,cast=true)=>box(mat,at(x,y,z),size,heading,cast);
    sceneryClearances.push({center,heading,width:width+10,length:length+10});
    const nearest=track.nearest(center.x,center.z);
    metadata.sources.push({name:feature.name,id,station:nearest.distance,lateral:nearest.lateral,width,length,footprintSource:feature.osm.url});
    return {feature,points,center,across,along,at,part,width,length,heading};
  }
  function label(text,width,height){
    const canvas=document.createElement('canvas');canvas.width=1024;canvas.height=128;
    const ctx=canvas.getContext('2d');ctx.fillStyle='#163d31';ctx.fillRect(0,0,1024,128);
    ctx.fillStyle='#e7e8d8';ctx.font='600 68px Arial';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(text,512,64,960);
    const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
    texture.repeat.x=-1;texture.offset.x=1;texture.anisotropy=4;textures.push(texture);
    const m=material({map:texture,roughness:.8,side:THREE.DoubleSide});
    return mesh(new THREE.PlaneGeometry(width,height),m,false,false);
  }

  const garages=frame(34404652);
  if(garages){
    const {part,width,length,at,heading}=garages,front=-width/2;
    // Open lower bays, a recessed interior and the long glazed upper floor.
    part(pale,1,6.9,0,[width-2,5.05,length]);
    part(pale,width/2-.25,2.15,0,[.5,4.3,length]);
    part(dark,front+4,1.85,0,[.22,3.7,length-.6],false);
    part(pale,0,.08,0,[width,.16,length]);
    part(glass,front-.025,6.52,0,[.15,2.35,length-.8]);
    part(silver,front-.20,4.55,0,[.65,.6,length+.4]);
    part(green,front-.27,5.03,0,[.11,.52,length-.4]);
    part(silver,front-.18,8.23,0,[.6,.3,length+.5]);
    part(white,front-.10,9.01,0,[.42,.5,length+.8]);
    part(dark,front-.14,8.62,0,[.13,.31,length-.6],false);
    part(silver,-.8,9.46,0,[width+3,.20,length+2]);
    const bays=Math.round(length/4.6),pitch=length/bays;
    metadata.garageBays=bays;
    for(let i=0;i<bays;i++){
      const z=-length/2+(i+.5)*pitch;
      part(recess,front+.15,1.86,z,[.16,3.65,pitch-.38],false);
      // Some roller shutters are raised; rolled slats and lintels remain visible.
      part(silver,front-.08,3.9,z,[.30,.47,pitch-.45]);
      for(let y=3.72;y<4.16;y+=.09)part(dark,front-.242,y,z,[.018,.017,pitch-.5],false);
      part(pale,front-.1,2.1,z-pitch/2,[.65,4.2,.34]);
      part(silver,front-.23,6.92,z-pitch/2,[.16,4.8,.11],false);
      part(silver,front-.1,9.9,z-pitch/2,[.12,1.05,.12],false);
      if(i%3===0){
        part(blue,front+1,5.44,z,[1.25,.25,1.55],false);
        part(ochre,front-2.2,.035,z,[4.2,.012,.10],false);
        part(ochre,front-4.2,.036,z+pitch*.43,[.10,.013,pitch*.86],false);
      }
      if(i%6===0){
        part(dark,front-.5,1.2,z,[1.05,1.45,1.4]);
        part(silver,width*.1,10.03,z,[2.8,.95,2.1]);
      }
      // Silver roof pergola ribs visible above the media-room glazing.
      if(i%2===0)part(silver,-.4,10.42,z,[width+4,.12,.11],false);
    }
    for(const y of [5.6,7.74,10.43])part(silver,front-.34,y,0,[.09,.08,length],false);
    const title=label('AUTODROMO NAZIONALE MONZA',32,.8);
    title.position.copy(at(front-.35,5.06,0));title.rotation.y=heading-Math.PI/2;
  }

  const hospitality=frame(194458105);
  if(hospitality){
    const {part,width,length,at,heading}=hospitality,front=-width/2;
    const radius=Math.min(width*.42,10.5),zEnd=-length/2+radius;
    const straightLength=length-radius,straightCenter=radius/2;
    // Distinct three-level hospitality building, with exposed grandstand
    // balconies and blue seating instead of an opaque continuous tower block.
    part(pale,width*.18,6.5,straightCenter,[width*.64,13,straightLength]);
    part(recess,front+4.6,6.25,straightCenter,[.3,12.5,straightLength-.8],false);
    for(const floor of [1.15,4.85,8.55]){
      part(pale,-1,floor-.18,straightCenter,[width+1.8,.36,straightLength+.6]);
      part(glass,front+4.25,floor+1.55,straightCenter,[.14,2.85,straightLength-.6]);
      part(silver,front-1.12,floor+.24,straightCenter,[.16,.28,straightLength+1.2]);
      part(glass,front-1.02,floor+.70,straightCenter,[.065,.74,straightLength+.8],false);
      part(silver,front-1.10,floor+1.12,straightCenter,[.075,.08,straightLength+1.2],false);
      for(let z=zEnd+1;z<length/2;z+=2.5){
        part(silver,front-1.08,floor+.65,z,[.07,1.05,.07],false);
        part(silver,front+4.1,floor+1.6,z,[.12,3.05,.10],false);
      }
      for(let row=0;row<3;row++){
        const x=front+.05+row*.82,y=floor+row*.28;
        part(pale,x,y,straightCenter,[.86,.18,straightLength-.9],false);
        for(let z=zEnd+1;z<length/2-1;z+=.70){
          if(Math.abs(z%14)<1.6)continue;
          part(blue,x,y+.41,z,[.47,.11,.44],false);
          part(blue,x+.24,y+.66,z,[.08,.47,.45],false);
          metadata.balconySeats++;
        }
      }
    }
    part(dark,-1.6,12.69,straightCenter,[width+5.3,.20,straightLength+3]);
    part(silver,front-3,12.87,straightCenter,[.26,.3,straightLength+3]);
    for(let z=zEnd;z<=length/2;z+=5.7){
      part(silver,front+3.75,7.06,z,[.22,11.7,.19]);
      part(silver,-1.6,12.53,z,[width+5.1,.23,.20]);
    }
    // Rounded southern lounge face, visible from the garages. Radius and
    // height are photo proportions; its centre is tied to the mapped block.
    for(const [bottom,top] of [[.9,4.65],[4.9,8.35],[8.6,12.45]]){
      const cylinder=new THREE.CylinderGeometry(radius,radius,top-bottom,32,1,true,Math.PI/2,Math.PI);
      const facade=mesh(cylinder,glass);facade.position.copy(at(0,(bottom+top)/2,zEnd));facade.rotation.y=heading;
      const lip=mesh(new THREE.CylinderGeometry(radius+.3,radius+.3,.24,32,1,false,Math.PI/2,Math.PI),silver);
      lip.position.copy(at(0,top+.02,zEnd));lip.rotation.y=heading;
    }
    for(let i=0;i<=16;i++){
      const angle=Math.PI/2+i*Math.PI/16;
      part(silver,radius*Math.sin(angle),6.66,zEnd+radius*Math.cos(angle),[.095,11.9,.095],false);
    }
  }

  const podium=frame(219396377);
  if(podium){
    const {center,at,part,heading,width,length}=podium;
    const radius=Math.max(width,length)/2;
    for(const [y,h,r,mat] of [[5.74,.42,radius,pale],[6.03,.15,radius-.12,dark],[9.08,.28,radius+.35,silver]]){
      const platform=mesh(new THREE.CylinderGeometry(r,r,h,48),mat,true,true);
      platform.position.copy(center).add(new THREE.Vector3(0,y,0));
      platform.name='Monza circular podium';
    }
    part(dark,radius*.65,2.78,0,[1.3,5.55,2.5]);
    part(green,radius*.38,7.48,0,[.35,2.65,radius*1.65]);
    for(let i=0;i<24;i++){
      const angle=i*Math.PI*2/24;
      part(silver,Math.cos(angle)*(radius-.12),6.55,Math.sin(angle)*(radius-.12),[.045,1.02,.045],false);
    }
    const rail=mesh(new THREE.TorusGeometry(radius-.12,.035,5,48),silver,false,false);
    rail.rotation.x=Math.PI/2;rail.position.copy(center).add(new THREE.Vector3(0,7.06,0));
    if(garages){
      const to=garages.at(-garages.width/2,5.84,0);
      const reach=to.clone().sub(center).dot(podium.across);
      part(pale,reach/2,5.77,0,[reach,.28,3.2]);
      for(const z of [-1.55,1.55]){
        part(silver,reach/2,6.98,z,[reach,.065,.065],false);
        for(let x=radius;x<reach;x+=1.5)part(silver,x,6.45,z,[.065,1.05,.065],false);
      }
    }
    const title=label('MONZA',radius*1.6,1.1);title.position.copy(at(-radius-.025,7.5,0));title.rotation.y=heading-Math.PI/2;
  }
  root.userData.pitComplex=metadata;
  return metadata;
}
