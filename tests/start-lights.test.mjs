import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createStartGantry, getStartSequence, START_GANTRY, START_SEQUENCE} from '../src/start-lights.js';

test('standing start adds one red column at each one-second boundary, then extinguishes every column', () => {
  for (const elapsed of [-2, 0, .699999]) {
    assert.equal(getStartSequence(elapsed).litCount, 0);
    assert.equal(getStartSequence(elapsed).released, false);
  }
  for (let column = 0; column < 5; column++) {
    const at = .7 + column;
    assert.equal(getStartSequence(at - .000001).litCount, column);
    assert.equal(getStartSequence(at).litCount, column + 1);
    assert.equal(getStartSequence(at).released, false);
  }
  const duration = getStartSequence(0).duration;
  assert.equal(getStartSequence(duration - .000001).litCount, 5);
  for (const elapsed of [duration, duration + 1, duration + 100]) {
    assert.deepEqual(getStartSequence(elapsed), {litCount: 0, released: true, duration});
  }
});

test('caller-supplied final hold changes release timing without changing the five-column cadence', () => {
  const before = {...START_SEQUENCE};
  const short = getStartSequence(0, .7), long = getStartSequence(0, 2.2);
  assert.ok(Math.abs(long.duration - short.duration - 1.5) < 1e-12);
  for (const elapsed of [.7, 1.7, 2.7, 3.7, 4.7]) {
    assert.equal(getStartSequence(elapsed, .7).litCount, getStartSequence(elapsed, 2.2).litCount);
  }
  assert.equal(getStartSequence(short.duration, .7).released, true);
  assert.equal(getStartSequence(short.duration, 2.2).litCount, 5);
  assert.equal(getStartSequence(long.duration, 2.2).litCount, 0);
  const snapshot = getStartSequence(2.7);
  snapshot.litCount = 99;
  assert.equal(getStartSequence(2.7).litCount, 3);
  assert.deepEqual(START_SEQUENCE, before);
});

test('gantry has ten upstream-facing red lenses, five independent states, and clear road space', () => {
  const root = new THREE.Group(), materials = [], textures = [];
  const track = {sample: station => ({position: new THREE.Vector3(0, 0, station), heading: 0})};
  const gantry = createStartGantry({track, root, textures,
    material: parameters => {const value = new THREE.MeshStandardMaterial(parameters); materials.push(value); return value;}});
  assert.equal(gantry.root.position.z, START_GANTRY.station);
  assert.equal(gantry.columns.length, 5);
  assert.equal(gantry.columns.reduce((sum, lamps) => sum + lamps.count, 0), 10);
  assert.equal(gantry.metadata.minimumClearance, 5.06);
  assert.ok(gantry.metadata.supportLateral < -14.8);
  assert.equal(new Set(gantry.columns.map(lamps => lamps.material)).size, 5);
  assert.ok(gantry.root.children.length <= 12, 'gantry hardware must remain batched');

  for (let count = 0; count <= 5; count++) {
    gantry.setState(count);
    assert.equal(gantry.litCount, count);
    assert.deepEqual(gantry.columns.map(lamps => lamps.userData.lit), [0, 1, 2, 3, 4].map(i => i < count));
    assert.ok(gantry.columns.every(lamps => lamps.geometry.attributes.normal.getZ(0) < -.99));
    assert.ok(gantry.columns.every(lamps => lamps.material.toneMapped === false));
    assert.ok(gantry.columns.filter(lamps => lamps.userData.lit).every(({material}) =>
      material.emissive.r > 0 && material.emissive.g === 0 && material.emissive.b === 0
      && material.emissiveIntensity > 0 && material.emissiveIntensity <= 1));
  }
  gantry.setState(0);
  assert.ok(gantry.columns.every(lamps => lamps.material.emissiveIntensity === 0));
  const pose = gantry.root.position.clone();
  gantry.setState(2); gantry.setState(0);
  assert.deepEqual(gantry.root.position, pose);
  gantry.setState(NaN);
  assert.equal(gantry.litCount, 0);
  gantry.setState(9);
  assert.equal(gantry.litCount, 5);
  gantry.setState(-3);
  assert.equal(gantry.litCount, 0);

  const geometries = new Set();
  root.traverse(object => {if (object.geometry) geometries.add(object.geometry);});
  geometries.forEach(geometry => geometry.dispose());
  materials.forEach(material => material.dispose());
  textures.forEach(texture => texture.dispose());
});
