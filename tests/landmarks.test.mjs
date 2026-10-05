import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createTrackFromGeoJSON} from '../src/track.js';
import {projectMonzaCoordinate} from '../src/monza-landmarks.js';

test('mapped hospitality towers remain behind the shared visual and collision barrier',async()=>{
  const read=name=>readFile(new URL(`../public/data/${name}`,import.meta.url),'utf8').then(JSON.parse);
  const [geo,data]=await Promise.all([read('monza.geojson'),read('monza-landmarks.json')]);
  const track=createTrackFromGeoJSON(geo);
  const towers=data.features.filter(f=>f.role==='hospitality-tower');
  assert.equal(towers.length,2);
  for(const tower of towers){
    const center=projectMonzaCoordinate(track,tower.point),near=track.nearest(center.x,center.z);
    const clearance=track.towerClearances.find(t=>t.node===tower.osm.id);
    assert.deepEqual(clearance.coordinates,tower.point,'The barrier and scenery use the same mapped point');
    assert(track.sample(near.distance).barrierLeft>track.surfaceBands.apron.outer+.3,'Protect the paved road width');
    for(const x of [-tower.width/2,tower.width/2])for(const z of [-tower.depth/2,0,tower.depth/2]){
      const p=center.clone().addScaledVector(near.right,x).addScaledVector(near.tangent,z);
      const s=track.nearest(p.x,p.z);
      assert(-s.lateral-s.barrierLeft>.17,`${tower.name} is behind the barrier, including both ends`);
    }
    for(let offset=-40;offset<40;offset+=.5){
      const a=track.sample(near.distance+offset),b=track.sample(near.distance+offset+.5);
      assert(Math.abs(a.barrierLeft-b.barrierLeft)<.35,'The tower guardrail approaches smoothly');
    }
  }
});

test('mapped building footprints preserve their original OSM coordinates',async()=>{
  const read=name=>readFile(new URL(`../public/data/${name}`,import.meta.url),'utf8').then(JSON.parse);
  const [data,raw]=await Promise.all([read('monza-landmarks.json'),read('monza-osm-paddock.json')]);
  const nodes=new Map(raw.elements.filter(e=>e.type==='node').map(e=>[e.id,[e.lon,e.lat]]));
  for(const feature of data.features){
    if(feature.point){assert.deepEqual(feature.point,nodes.get(feature.osm.id));continue;}
    const way=raw.elements.find(e=>e.type==='way'&&e.id===feature.osm.id);
    assert(way,`${feature.name} has a source way`);
    assert.deepEqual(feature.footprint,way.nodes.map(id=>nodes.get(id)));
  }
});
