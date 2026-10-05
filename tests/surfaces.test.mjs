import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createTrackFromGeoJSON} from '../src/track.js';
import {VehiclePhysics} from '../src/physics.js';

const geography = JSON.parse(await readFile(new URL('../public/data/monza.geojson', import.meta.url), 'utf8'));
const track = createTrackFromGeoJSON(geography);

test('straight paved aprons have no phantom kerbs and the visible earth shoulder remains gravel', () => {
  for (const distance of [0, 300, 3100, 4300, 5484]) {
    for (const side of [-1, 1]) {
      for (const offset of [0, 5.99, 6.02, 6.5, 7.2, 7.299]) {
        assert.equal(track.surfaceAt(distance, side * offset), 'asphalt',
          `straight road/apron at ${distance} m, lateral ${side * offset} m must be paved`);
      }
      for (const offset of [7.301, 7.6, 7.99]) {
        assert.equal(track.surfaceAt(distance, side * offset), 'gravel',
          'the raised earthy shoulder covers the last 0.1 m of the asphalt base');
      }
      assert.equal(track.surfaceAt(distance, side * 8.01), 'grass', 'the ordinary shoulder has a finite width');
    }
  }
});

test('kerb contact follows the visible corner section, side, and lateral bounds', () => {
  assert.equal(track.kerbSections.length, 14);
  for (const section of track.kerbSections) {
    for (const distance of [section.start + .01, (section.start + section.end) / 2, section.end - .01]) {
      assert.equal(track.surfaceAt(distance, section.side * 6.8), 'kerb',
        `T${section.corner} kerb geometry must have matching contact over its full interval`);
      assert.equal(track.surfaceAt(distance, section.side * 7.8), 'asphalt',
        'green paving beyond the kerb must not use kerb or loose-surface grip');
    }
  }
  const t1 = track.corners[0].distance;
  assert.equal(track.surfaceAt(t1, 6.8), 'kerb', 'the first right turn has a right-side inside kerb');
  assert.equal(track.surfaceAt(t1, -6.8), 'asphalt', 'the opposite apron is not a mirrored imaginary kerb');
  assert.equal(track.surfaceAt(t1, 6.02), 'asphalt', 'the narrow gap before the raised kerb is still asphalt');
  assert.equal(track.surfaceAt(t1, 7.56), 'asphalt', 'the painted strip starts immediately beyond the kerb');
  assert.equal(track.surfaceAt(t1, 8.81), 'grass', 'inside painted runoff has a finite outer edge');
  const first = track.kerbSections[0];
  assert.equal(track.surfaceAt(first.start - .01, 6.8), 'asphalt');
  assert.equal(track.surfaceAt(first.end + .01, 6.8), 'asphalt');
  const t4 = track.corners[3].distance;
  assert.equal(track.surfaceAt(t4, -6.8), 'kerb', 'Roggia begins with a left-side inside kerb');
  assert.equal(track.surfaceAt(t4, 6.8), 'asphalt');
});

test('painted runoff covers the gravel edge and broad traps end at the visible barrier clearance', () => {
  for (const [start, end, side] of track.runoffSections) {
    const distance = (start + end) / 2;
    for (const offset of [8.2, 9.05, 9.149]) {
      assert.equal(track.surfaceAt(distance, side * offset), 'asphalt',
        'green paving overlays the shoulder and the inner edge of the gravel trap');
    }
    assert.equal(track.surfaceAt(distance, side * 9.16), 'gravel', 'gravel begins beyond the painted overlap');
    const frame = track.sample(distance);
    const outer = (side < 0 ? frame.barrierLeft : frame.barrierRight) - 3;
    assert.equal(track.surfaceAt(distance, side * (outer - .01)), 'gravel');
    assert.equal(track.surfaceAt(distance, side * (outer + .01)), 'grass',
      'a corner gravel trap must not classify the entire park beyond its mesh as gravel');
  }
  const t1 = track.corners[0].distance;
  assert.equal(track.surfaceAt(t1, -10), 'gravel');
  assert.equal(track.surfaceAt(t1, 10), 'grass', 'runoff side is significant');
  const [start, end, side] = track.runoffSections[0];
  assert.equal(track.surfaceAt(start - .01, side * 10), 'grass');
  assert.equal(track.surfaceAt(end + .01, side * 10), 'grass');
  assert.equal(track.surfaceAt(t1, -7.45), 'asphalt', 'runoff paint lies above the earthy shoulder');
  assert.equal(track.surfaceAt(t1, 7.45), 'kerb', 'the raised kerb lies above the shoulder on the other side');
});

test('surface lookup wraps geographic distances and reaches vehicle contact without moving the track', () => {
  for (const [distance, lateral] of [[0, 6.6], [0, -7.6], [track.corners[0].distance, 6.6], [track.corners[0].distance, -10]]) {
    const expected = track.surfaceAt(distance, lateral);
    assert.equal(track.surfaceAt(distance + track.length, lateral), expected);
    assert.equal(track.surfaceAt(distance - track.length, lateral), expected);
  }
  const vehicle = new VehiclePhysics(track, {assist: true, autoGears: true});
  function driveOver(distance, lateral) {
    vehicle.reset(distance);
    const frame = track.sample(distance);
    vehicle.state.x += frame.right.x * lateral;
    vehicle.state.z += frame.right.z * lateral;
    vehicle.state.vx = frame.tangent.x * 15;
    vehicle.state.vz = frame.tangent.z * 15;
    return vehicle.step(1 / 120, {throttle: 0, brake: 0, steer: 0});
  }
  const apron = driveOver(300, 6.6);
  assert.equal(apron.surface, 'asphalt');
  assert.equal(apron.suspensionTravel, 0, 'a paved straight apron must not produce kerb suspension rumble');
  assert.equal(driveOver(track.corners[0].distance, 6.6).surface, 'kerb');
  assert.equal(track.startLineDistance, 0);
  assert.equal(track.controlLineDistance, 5484);
});
