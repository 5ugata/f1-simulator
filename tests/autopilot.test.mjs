import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createTrackFromGeoJSON } from '../src/track.js';
import { VehiclePhysics } from '../src/physics.js';
import { Autopilot } from '../src/autopilot.js';
import { Session } from '../src/session.js';

for(const model of ['AP-25 default','McLaren MCL35M'])test(`demonstration driver completes three Monza laps without cuts or impacts: ${model}`, async () => {
  const geography = JSON.parse(await readFile(new URL('../public/data/monza.geojson', import.meta.url), 'utf8'));
  const track = createTrackFromGeoJSON(geography);
  const geometry=model==='McLaren MCL35M'
    ?JSON.parse(await readFile(new URL('../public/models/mclaren-mcl35m/metadata.json',import.meta.url),'utf8')).dimensions
    :undefined;
  const vehicle = new VehiclePhysics(track, { assist: true, autoGears: true, geometry });
  const driver = new Autopilot(track);
  const saved = new Map();
  const storage = { getItem: key => saved.get(key) || null, setItem: (key, value) => saved.set(key, value) };
  const session = new Session(track, storage);
  vehicle.reset(track.controlLineDistance);
  session.reset(track.controlLineDistance);
  assert.equal(session.outLap, false, 'starting at the control line permits a full timed lap');
  let maxLateral = 0, maxSpeed = 0;
  const dt = 1 / 60;
  for (let step = 0; step < 60 * 440 && session.history.length < 3; step++) {
    const input = driver.sample(vehicle.state, dt);
    for (const key of ['throttle', 'brake']) assert.ok(input[key] >= 0 && input[key] <= 1);
    assert.ok(input.steer >= -1 && input.steer <= 1);
    // Match the application's fixed physics/timing substeps while sampling the
    // demonstration controller at a realistic render cadence.
    for (let substep = 0; substep < 2; substep++) {
      vehicle.step(dt / 2, input);
      session.step(dt / 2, vehicle.state);
    }
    const state = vehicle.state;
    maxLateral = Math.max(maxLateral, Math.abs(state.lateral));
    maxSpeed = Math.max(maxSpeed, state.speed);
    assert.equal(state.offTrack, false, `left the road at ${state.distance.toFixed(1)} m`);
    assert.equal(state.damage, 0, `impact at ${state.distance.toFixed(1)} m`);
    assert.equal(state.validLap, true, `invalid lap at ${state.distance.toFixed(1)} m`);
  }
  assert.equal(session.history.length, 3, 'must drive three complete control-line-to-control-line laps');
  assert.ok(maxLateral < track.width / 2 - 1, `leave room for car width; peak offset ${maxLateral}`);
  assert.ok(maxSpeed > 78, 'must accelerate beyond 280 km/h on a straight');
  assert.ok(vehicle.state.travelDistance > track.length * 2.9);
  const lapTimes = session.history.map(lap => lap.time);
  assert.ok(lapTimes.every(time => time > 80 && time < 150), `lap times ${lapTimes}`);
  assert.ok(Math.abs(driver.speedAt(0) - driver.speedAt(track.length)) < 1e-9);
  assert.equal(session.history.length, 3, 'timing must recognize each physically driven circuit');
  assert.ok(session.history.every(lap => lap.valid && lap.sectors.length === 3));
  for (const lap of session.history) {
    assert.ok(Math.abs(lap.sectors.reduce((sum, value) => sum + value, 0) - lap.time) < 1e-6);
    assert.ok(lap.frames.length > 100);
    assert.ok(lap.frames.every((frame, index) => index === 0 || frame[0] > lap.frames[index - 1][0]));
  }
  const reloaded = new Session(track, storage);
  assert.equal(reloaded.best.time, session.best.time, 'best lap must survive a browser storage reload');
  assert.ok(reloaded.ghostAt(reloaded.best.time / 2), 'saved ghost must replay after reload');
  session.recover(vehicle.state.distance);
  assert.equal(session.valid, false, 'recovery must invalidate the active lap');
  assert.equal(session.best.time, reloaded.best.time, 'recovery must preserve the saved personal best');
});

test('exact lap boundaries, demonstration isolation, and corrupt ghost rejection', async () => {
  const geography = JSON.parse(await readFile(new URL('../public/data/monza.geojson', import.meta.url), 'utf8'));
  const track = createTrackFromGeoJSON(geography);
  const saved = new Map();
  const storage = { getItem: key => saved.get(key) || null, setItem: (key, value) => saved.set(key, value) };
  const session = new Session(track, storage);
  session.reset(track.controlLineDistance);
  session.recordEnabled = false;
  const createState = (distance, speed = 80) => {
    const sample = track.sample(distance);
    return { distance, speed, x: sample.position.x, z: sample.position.z, heading: sample.heading,
      throttle: 1, brake: 0, offTrack: false, lateral: 0 };
  };
  // Two laps at constant speed isolate temporal sampling from tire dynamics.
  const dt = 1 / 120, lapSpeed = 80;
  let totalDistance = 0;
  while (session.history.length < 2) {
    totalDistance += lapSpeed * dt;
    session.step(dt, createState(track.fromLapDistance(totalDistance)));
    if (session.history.length === 1 && !session.recordEnabled) {
      assert.equal(session.best, null, 'demonstration may time laps but must not set a personal best');
      assert.equal(saved.size, 0, 'demonstration must not write personal-best storage');
      session.recordEnabled = true;
    }
  }
  assert.equal(saved.size, 1, 'a subsequent manual session may save its clean lap');
  for (const lap of session.history) {
    assert.ok(Math.abs(lap.time - track.length / lapSpeed) < 1e-6,
      'crossing interpolation must recover the exact constant-speed lap duration');
  }
  const start = track.sample(track.controlLineDistance).position;
  const ghost = session.ghostAt(0);
  assert.ok(Math.hypot(ghost.x - start.x, ghost.z - start.z) < 1,
    'ghost must start on the timing line, not at the first 10 Hz sample several meters ahead');
  assert.ok(Math.abs(session.bestTimeAtDistance(track.controlLineDistance)) < 0.01,
    'reference time at the control line must be zero');
  assert.ok(Math.abs(session.bestTimeAtDistance(track.fromLapDistance(1234.567)) - 1234.567 / lapSpeed) < 1e-6,
    'spatial delta lookup converts geographic distance and interpolates telemetry');
  assert.ok(Math.abs(session.bestTimeAtDistance(0) - 309 / lapSpeed) < 1e-6,
    'the geographic start-grid seam is 309 m into a timed lap');
  assert.ok(Math.abs(session.delta) < 1e-6, 'matching pace keeps the delta continuous across the lap seam');
  const end = session.ghostAt(session.best.time);
  assert.ok(Math.hypot(end.x - start.x, end.z - start.z) < 1,
    'ghost must finish on the timing line, not freeze at the last pre-finish sample');

  const stored = JSON.parse([...saved.values()][0]);
  const malformedSaves = [
    data => { data.version = 'monza-geographic-2025-v2'; },
    data => { data.frames[5][0] = data.frames[4][0]; },
    data => { data.frames[5][1] = null; },
    data => { data.frames[5][6] = 2; },
    data => { data.frames[0][0] = .1; },
    data => { data.frames.at(-1)[4] = 0; },
    data => { data.sectors[0] = -1; },
    data => { data.topSpeed = 'invalid'; },
  ];
  for (const corrupt of malformedSaves) {
    const data = structuredClone(stored);
    corrupt(data);
    const recovered = new Session(track, { getItem: () => JSON.stringify(data) });
    assert.equal(recovered.best, null, 'corrupt saves must not enter ghost interpolation');
  }
  const deniedStorage = new Session(track, { getItem() { throw new Error('Storage denied'); } });
  assert.equal(deniedStorage.best, null, 'storage errors must not block driving');
});
