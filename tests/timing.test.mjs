import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createTrackFromGeoJSON} from '../src/track.js';
import {Session} from '../src/session.js';

const geography = JSON.parse(await readFile(new URL('../public/data/monza.geojson', import.meta.url), 'utf8'));
const track = createTrackFromGeoJSON(geography);
const stateAt = (distance, speed = 80) => {
  const sample = track.sample(distance);
  return {distance: sample.distance, speed, x: sample.position.x, z: sample.position.z,
    heading: sample.heading, throttle: 1, brake: 0, offTrack: false, lateral: 0};
};
const close = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-6, message);

test('published timing offsets preserve geography and DRS remains available across the grid seam', () => {
  assert.equal(track.startLineDistance, 0);
  assert.equal(track.controlLineDistance, 5484);
  assert.deepEqual(track.origin, {lat: 45.618975, lon: 9.281223});
  assert.equal(track.sample(0).position.length(), 0, 'the geographic origin must not move with the timing origin');
  assert.equal(track.toLapDistance(0), 309);
  assert.equal(track.toLapDistance(5484), 0);
  assert.equal(track.fromLapDistance(0), 5484);
  for (const raw of [-500, 0, 1234, 5484, 5496, 5793, 12000]) {
    close(track.sample(track.fromLapDistance(track.toLapDistance(raw))).distance, track.sample(raw).distance,
      'distance conversions preserve the sampled geographic location');
  }
  close(track.corners[3].distance - track.sectors[0], 233, 'S1 follows the FIA 2025 T4 offset');
  close(track.corners[7].distance - track.sectors[1], 215, 'S2 follows the FIA 2025 T8 offset');
  track.sectors.forEach((raw, i) => close(track.lapSectors[i], track.toLapDistance(raw),
    'telemetry split distances are measured from the control line'));

  assert.equal(track.isDrsZone(5495.99), false);
  for (const distance of [5496, 5700, 5792, 0, 50, track.length + 50]) {
    assert.equal(track.isDrsZone(distance), true, `main-straight DRS must be continuous at ${distance}`);
  }
  assert.equal(track.isDrsZone(track.drsZones[0].end), false, 'the authored braking gate closes the zone');
  const lesmo = track.corners[6].distance;
  assert.equal(track.isDrsZone(lesmo + 169.99), false);
  assert.equal(track.isDrsZone(lesmo + 170), true);
  assert.equal(track.isDrsZone(track.drsZones[1].end), false);
});

test('the opening grid run is an out lap and geographic distance zero never finishes a timed lap', () => {
  const saved = new Map();
  const session = new Session(track, {getItem: () => null, setItem: (key, value) => saved.set(key, value)});
  assert.equal(session.outLap, true);
  assert.equal(session.valid, true, 'an out lap is not a track-limit violation');
  const speed = 80, dt = 1 / speed;
  // One-metre steps land on both seams exactly and isolate timing from physics.
  for (let raw = 1; raw < track.controlLineDistance; raw++) session.step(dt, stateAt(raw));
  assert.equal(session.outLap, true);
  assert.equal(session.history.length, 0);
  assert.equal(session.best, null);
  session.step(dt, stateAt(track.controlLineDistance));
  assert.equal(session.outLap, false, 'first forward control-line crossing starts the timed lap');
  assert.equal(session.valid, true);
  assert.equal(session.lastEvent.message, 'FLYING LAP STARTED');
  assert.equal(session.history.length, 0, 'the shortened opening run must not enter completed-lap history');
  assert.equal(saved.size, 0, 'the shortened opening run must not become a personal best');
  close(session.lapTime, 0, 'the timer starts at the actual control line');
  assert.equal(session.frames[0][4], 0);

  for (let travelled = 1; travelled <= 309; travelled++) {
    session.step(dt, stateAt(track.fromLapDistance(travelled)));
  }
  assert.equal(session.previousState.distance, 309);
  assert.equal(session.history.length, 0, 'passing the start grid is not a lap completion');
  assert.equal(session.lap, 1);
  close(session.lapTime, 309 / speed, 'time remains continuous through the geographic seam');
  for (let travelled = 310; travelled <= track.length; travelled++) {
    session.step(dt, stateAt(track.fromLapDistance(travelled)));
  }
  assert.equal(session.history.length, 1);
  assert.equal(saved.size, 1);
  assert.equal(session.best.valid, true);
  close(session.best.time, track.length / speed, 'only the full timing lap is saved');
  const expectedSectors = [track.lapSectors[0], track.lapSectors[1] - track.lapSectors[0], track.length - track.lapSectors[1]];
  expectedSectors.forEach((metres, i) => close(session.best.sectors[i], metres / speed,
    'sector durations use the control-line origin'));
  assert.equal(session.best.frames[0][4], 0);
  assert.equal(session.best.frames.at(-1)[4], track.length);
  const control = track.sample(track.controlLineDistance).position;
  for (const time of [0, session.best.time]) {
    const ghost = session.ghostAt(time);
    assert.ok(Math.hypot(ghost.x - control.x, ghost.z - control.z) < .001,
      'both ghost endpoints are located on the physical control line');
  }
});

test('shifted timing retains reverse, teleport and geographic recovery protections', () => {
  const session = new Session(track, {getItem: () => null, setItem: () => assert.fail('an incomplete lap cannot be saved')});
  session.reset(track.controlLineDistance);
  session.step(1 / 80, stateAt(track.controlLineDistance - 1));
  assert.equal(session.history.length, 0, 'crossing the control line backward is not a lap');
  session.step(2 / 80, stateAt(track.controlLineDistance + 1));
  assert.equal(session.history.length, 0, 're-crossing without the ordered gates is not a complete lap');
  assert.equal(session.best, null);

  session.step(1 / 120, stateAt(track.fromLapDistance(1400)));
  assert.equal(session.valid, false, 'a distance jump remains a teleport after origin conversion');
  assert.equal(session.lastEvent.message, 'POSITION RESET — LAP INVALID');
  assert.equal(session.best, null);

  const recoveryDistance = 25;
  session.reset(track.controlLineDistance);
  session.recover(recoveryDistance);
  assert.equal(session.valid, false);
  assert.equal(session.previousDistance, 334, 'recovery converts its raw geographic distance once');
  const recoveryPosition = track.sample(recoveryDistance).position;
  close(session.previousState.x, recoveryPosition.x, 'recovery keeps the geographic x position');
  close(session.previousState.z, recoveryPosition.z, 'recovery keeps the geographic z position');
  session.step(1 / 80, stateAt(recoveryDistance + 1));
  assert.equal(session.previousDistance, 335);
  assert.equal(session.lastEvent, null, 'ordinary motion after recovery must not trigger a second teleport');
  assert.equal(session.valid, false, 'recovery remains invalid until the next control-line crossing');
  assert.equal(session.history.length, 0);
});

test('a teleport across the control line invalidates the shortened next lap', () => {
  const saved = new Map();
  const session = new Session(track, {getItem: () => null, setItem: (key, value) => saved.set(key, value)});
  session.reset(track.fromLapDistance(track.length - 29));
  session.step(1 / 120, stateAt(track.fromLapDistance(29)));
  assert.equal(session.valid, false, 'the discontinuity affects both sides of the control line');
  assert.equal(session.lastEvent.message, 'POSITION RESET — LAP INVALID');
  assert.equal(session.best, null);
  for (let distance = 30; distance <= track.length; distance++) {
    session.step(1 / 80, stateAt(track.fromLapDistance(distance)));
  }
  assert.equal(session.history.length, 1);
  assert.equal(session.history[0].valid, false, 'the skipped 29 m cannot become a clean lap');
  assert.equal(session.best, null);
  assert.equal(saved.size, 0);
  assert.equal(session.valid, true, 'a subsequent continuous crossing can begin a clean lap');

  for (let distance = 1; distance <= track.length; distance++) {
    session.step(1 / 80, stateAt(track.fromLapDistance(distance)));
  }
  assert.equal(saved.size, 1, 'the next entire clean lap can set a personal best');
  close(session.best.time, track.length / 80, 'personal-best time includes every metre of the lap');
});

test('unsupported timing gaps cannot generate unbounded ghost samples or a lap crossing', () => {
  for (const dt of [.100001, 10000, Number.MAX_VALUE]) {
    const session = new Session(track, {getItem: () => null, setItem: () => assert.fail('a timing gap cannot save a lap')});
    session.reset(track.fromLapDistance(track.length - 2));
    session.step(1 / 80, stateAt(track.fromLapDistance(track.length - 1)));
    const elapsed = session.elapsed, lapTime = session.lapTime;
    const frames = structuredClone(session.frames);
    // Bound this regression itself if an implementation accidentally attempts
    // to fill a huge gap with 10 Hz samples again.
    const recordFrame = session.recordFrame.bind(session);
    let attemptedFrames = 0;
    session.recordFrame = (...args) => {
      assert.ok(++attemptedFrames < 5, 'one gap must not trigger a ghost-sampling loop');
      recordFrame(...args);
    };
    session.step(dt, stateAt(track.fromLapDistance(1)));
    assert.equal(session.valid, false, `an unsupported ${dt} s interval must invalidate timing`);
    assert.equal(session.lastEvent.message, 'TIMING GAP — LAP INVALID');
    assert.equal(session.lapTime, lapTime, 'unknown time must not enter the recorded timeline');
    assert.equal(session.elapsed, elapsed);
    assert.deepEqual(session.frames, frames, 'no ghost positions are invented inside a timing gap');
    assert.equal(attemptedFrames, 0);
    assert.equal(session.outLap, true, 'an unobserved line crossing must not start a flying lap');
    assert.equal(session.previousDistance, 1, 'the next normal step resumes at the current position');
    assert.equal(session.history.length, 0);
    assert.equal(session.best, null);
    session.step(1 / 80, stateAt(track.fromLapDistance(2)));
    assert.equal(session.valid, false);
    assert.equal(session.lastEvent, null, 're-anchoring prevents a second artificial position jump');
    assert.equal(session.previousDistance, 2);
  }

  const session = new Session(track, {getItem: () => null});
  session.reset(track.controlLineDistance);
  session.step(.1, stateAt(track.fromLapDistance(8)));
  assert.equal(session.valid, true, 'the documented 100 ms upper bound is still accepted');
  close(session.lapTime, .1, 'a supported interval advances timing normally');
  close(session.frames.at(-1)[0], .1, 'a supported interval produces the expected telemetry sample');
});
