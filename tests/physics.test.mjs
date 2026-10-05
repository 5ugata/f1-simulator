import test from 'node:test';
import assert from 'node:assert/strict';
import { VehiclePhysics, VEHICLE_CONSTANTS } from '../src/physics.js';
import { InputController } from '../src/input.js';
import { createCar } from '../src/car.js';

function straightTrack({ width = 12, barrier = 10000, barrierLeft, barrierRight, heading = 0 } = {}) {
  const sn = Math.sin(heading), cs = Math.cos(heading);
  const frame = distance => ({
    distance, position: { x: sn * distance, y: 0, z: cs * distance }, tangent: { x: sn, y: 0, z: cs },
    right: { x: cs, y: 0, z: -sn }, heading, curvature: 0, width, barrierWidth: barrier, barrierLeft, barrierRight,
  });
  return {
    length: 100000, width, sample: frame,
    nearest: (x, z) => ({ ...frame(x * sn + z * cs), lateral: x * cs - z * sn }),
    isDrsZone: () => true,
  };
}

function envelopeLaterals(state, track, geometry = VEHICLE_CONSTANTS) {
  const sn = Math.sin(state.heading), cs = Math.cos(state.heading);
  const laterals = [];
  for (const x of [-geometry.width / 2, geometry.width / 2]) {
    for (const z of [-geometry.rearExtent, geometry.frontExtent]) {
      laterals.push(track.nearest(state.x + x * cs + z * sn, state.z - x * sn + z * cs).lateral);
    }
  }
  return { min: Math.min(...laterals), max: Math.max(...laterals) };
}

function run(vehicle, duration, input, hz = 120) {
  for (let i = 0; i < Math.round(duration * hz); i++) vehicle.step(1 / hz, input);
  return vehicle.state;
}

const alternateGeometry = Object.freeze({
  wheelbase: 3.9, frontAxle: 2.15, rearAxle: -1.75,
  wheelRadius: .29, width: 2.2, frontExtent: 3.8, rearExtent: 3.1,
});

test('custom vehicle dimensions are validated, copied and retained through settings and reset', () => {
  const supplied = { ...alternateGeometry };
  const car = new VehiclePhysics(straightTrack(), { geometry: supplied });
  assert.deepEqual(car.geometry, alternateGeometry);
  assert.notEqual(car.geometry, supplied, 'the caller cannot mutate an active geometry through its input object');
  assert.ok(Object.isFrozen(car.geometry));
  supplied.wheelRadius = 0;
  car.setOptions({ assist: false, autoGears: false, geometry: undefined });
  run(car, 1, { throttle: 1 });
  car.reset(50);
  assert.deepEqual(car.geometry, alternateGeometry);
  assert.equal(car.options.assist, false);
  assert.equal(car.state.z, 50);
  assert.throws(() => car.setOptions({ geometry: { ...alternateGeometry, wheelRadius: .3 } }),
    /fixed at construction/);
  assert.deepEqual(car.geometry, alternateGeometry, 'a rejected replacement leaves the active geometry intact');

  const invalid = [null, {}, [],
    { ...alternateGeometry, width: 0 },
    { ...alternateGeometry, wheelRadius: NaN },
    { ...alternateGeometry, wheelRadius: Number.MIN_VALUE },
    { ...alternateGeometry, wheelRadius: Infinity },
    { ...alternateGeometry, frontAxle: -2.15 },
    { ...alternateGeometry, rearAxle: 1.75 },
    { ...alternateGeometry, wheelbase: 3.6 },
    { ...alternateGeometry, frontExtent: 2.2 },
    { ...alternateGeometry, rearExtent: 1.8 },
  ];
  for (const geometry of invalid) {
    assert.throws(() => new VehiclePhysics(straightTrack(), { geometry }),
      error => error instanceof TypeError || error instanceof RangeError,
      'malformed dimensions must be rejected before any state is integrated');
  }
  const defaults = new VehiclePhysics(straightTrack()).geometry;
  for (const key of Object.keys(alternateGeometry)) assert.equal(defaults[key], VEHICLE_CONSTANTS[key]);
});

test('custom rolling radius changes gearing, drive force, wheel rotation and downshift protection', () => {
  const small = new VehiclePhysics(straightTrack(), { geometry: alternateGeometry, autoGears: false, assist: false });
  const large = new VehiclePhysics(straightTrack(), {
    geometry: { ...alternateGeometry, wheelRadius: .36 }, autoGears: false, assist: false,
  });
  for (const car of [small, large]) {
    Object.assign(car.state, { vz: 50, speed: 50, forwardSpeed: 50, gear: 8, throttle: .3 });
    car.step(1 / 120, { throttle: .3 });
    assert.ok(Math.abs(car.state.wheelRotation - car.state.forwardSpeed / car.geometry.wheelRadius / 120) < 1e-12,
      'one step of wheel rotation must match the selected tyre circumference');
  }
  assert.ok(small.state.rpm > large.state.rpm, 'smaller tyres raise shaft speed at the same road speed and gear');
  assert.ok(small.state.acceleration > large.state.acceleration, 'rolling radius changes tractive force at the road');
  for (const car of [small, large]) {
    car.reset();
    Object.assign(car.state, { vz: 75, speed: 75, forwardSpeed: 75, gear: 8 });
    car.step(1 / 120, { gearDown: true });
  }
  assert.equal(small.state.gear, 8, 'the small tyre would over-rev seventh gear at 75 m/s');
  assert.equal(large.state.gear, 7, 'the same downshift remains safe with a larger tyre');
});

test('custom axle spacing and balance affect turning and launch while retaining fixed-step behavior', () => {
  const compact = new VehiclePhysics(straightTrack({ width: 20000 }), { assist: false, autoGears: false });
  const extended = new VehiclePhysics(straightTrack({ width: 20000 }), {
    assist: false, autoGears: false,
    geometry: { ...compact.geometry, wheelbase: 4.5, frontAxle: 2.475, rearAxle: -2.025, frontExtent: 3.4, rearExtent: 3 },
  });
  for (const car of [compact, extended]) {
    Object.assign(car.state, { vz: 3, speed: 3, forwardSpeed: 3 });
    run(car, .5, { throttle: .2, steer: .5 });
  }
  assert.ok(compact.state.heading > .04);
  assert.ok(extended.state.heading < compact.state.heading * .95,
    'a longer wheelbase turns less tightly at parking speed with the same steering input');

  const balanced = new VehiclePhysics(straightTrack(), { geometry: alternateGeometry });
  const rearLoaded = new VehiclePhysics(straightTrack(), {
    geometry: { ...alternateGeometry, frontAxle: 2.9, rearAxle: -1 },
  });
  for (const car of [balanced, rearLoaded]) run(car, 1, { throttle: 1 });
  assert.ok(rearLoaded.state.speed > balanced.state.speed + .5,
    'moving the center of mass rearward increases the rear axle launch traction');

  const cars = [30, 120].map(hz => {
    const car = new VehiclePhysics(straightTrack({ width: 20000 }), { geometry: alternateGeometry });
    run(car, 8, { throttle: 1, boost: true }, hz);
    assert.ok(car.state.speed > 55, 'alternate geometry remains driveable at speed');
    run(car, .5, { throttle: .4, steer: .3 }, hz);
    run(car, 4, { brake: 1 }, hz);
    assert.ok(car.state.speed < .1, 'alternate geometry brakes to a stable stop');
    for (const [key, value] of Object.entries(car.state)) {
      if (typeof value === 'number') assert.ok(Number.isFinite(value), `${key} must remain finite with alternate geometry`);
    }
    return car;
  });
  for (const key of ['x', 'z', 'heading', 'speed', 'fuel', 'wheelRotation']) {
    assert.ok(Math.abs(cars[0].state[key] - cars[1].state[key]) < 1e-7, `${key} differs by cadence with alternate geometry`);
  }
});

test('alternate body dimensions contain rotated impacts and preserve a narrow car’s clear space', () => {
  for (const side of [-1, 1]) for (const angle of [0, .6, -.6, Math.PI / 2, -Math.PI / 2, Math.PI]) {
    const track = straightTrack({ heading: .57, barrierLeft: 7.4, barrierRight: 6.8 });
    const car = new VehiclePhysics(track, { geometry: alternateGeometry });
    car.state.heading = .57 + angle;
    const atCenter = envelopeLaterals(car.state, track, car.geometry);
    const boundary = side > 0 ? 6.8 - atCenter.max : -7.4 - atCenter.min;
    const lateral = boundary + side * .15, frame = track.sample(100);
    Object.assign(car.state, {
      x: frame.position.x + frame.right.x * lateral, z: frame.position.z + frame.right.z * lateral,
      vx: frame.right.x * side * 10 + frame.tangent.x * 6,
      vz: frame.right.z * side * 10 + frame.tangent.z * 6,
      speed: Math.hypot(10, 6),
    });
    car.step(1 / 120, {});
    const envelope = envelopeLaterals(car.state, track, car.geometry);
    assert.ok(envelope.min >= -7.4 - 1e-7 && envelope.max <= 6.8 + 1e-7,
      `custom envelope escaped a wall at angle ${angle}, side ${side}`);
    assert.ok(car.state.damage > 0);
    assert.ok(car.state.speed < Math.hypot(10, 6));
  }

  const track = straightTrack({ barrier: 7 });
  const narrow = new VehiclePhysics(track, { geometry: { ...alternateGeometry, width: 1.4 } });
  Object.assign(narrow.state, { x: 6.2, vz: 20, speed: 20 });
  const before = { ...narrow.state };
  narrow._resolveBarrier(track.nearest(narrow.state.x, narrow.state.z), 832);
  assert.deepEqual(narrow.state, before, 'a clear narrow body must not collide using the default two-metre width');
});

test('launch accelerates progressively and automatic gears shift through the range', () => {
  const car = new VehiclePhysics(straightTrack());
  const first = { ...run(car, 3, { throttle: 1 }) };
  assert.ok(first.speed > 22 && first.speed < 43, `launch speed ${first.speed}`);
  assert.ok(first.z > 20 && first.z < 90);
  const fast = run(car, 25, { throttle: 1, boost: true });
  assert.ok(fast.speed > 80 && fast.speed < 115, `top speed ${fast.speed}`);
  assert.ok(fast.gear >= 7 && fast.gear <= 8);
  assert.ok(fast.rpm >= 4000 && fast.rpm <= 12800);
  assert.ok(Math.abs(fast.x) < 1e-6, 'straight steering must not invent lateral motion');
  assert.ok(fast.fuel < VEHICLE_CONSTANTS.startingFuel);
});

test('full brake removes speed quickly without driving the car backward at rest', () => {
  const car = new VehiclePhysics(straightTrack());
  run(car, 10, { throttle: 1, boost: true });
  const initial = car.state.speed, initialZ = car.state.z;
  run(car, 4, { brake: 1 });
  assert.ok(car.state.speed < 0.1, `stopped speed ${car.state.speed}`);
  assert.ok(car.state.z - initialZ > 20 && car.state.z - initialZ < 160);
  assert.ok(initial > 65);
  run(car, 5, { brake: 1 });
  assert.ok(car.state.forwardSpeed >= -0.001);
  assert.ok(car.state.speed < 0.05);
});

test('right and left steering produce mirrored turns without following the road', () => {
  const left = new VehiclePhysics(straightTrack({ width: 20000 }));
  const right = new VehiclePhysics(straightTrack({ width: 20000 }));
  for (const car of [left, right]) run(car, 3, { throttle: 1 });
  run(left, 1, { throttle: 0.5, steer: -0.7 });
  run(right, 1, { throttle: 0.5, steer: 0.7 });
  assert.ok(right.state.x > 3 && right.state.heading > 0.1);
  assert.ok(left.state.x < -3 && left.state.heading < -0.1);
  assert.ok(Math.abs(left.state.x + right.state.x) < 0.01);
  assert.ok(Math.abs(left.state.z - right.state.z) < 0.01);
});

test('fixed-step integration is independent of 30, 60 and 120 Hz rendering', () => {
  const cars = [30, 60, 120].map(hz => {
    const car = new VehiclePhysics(straightTrack({ width: 20000 }));
    run(car, 5, { throttle: 1 }, hz);
    run(car, 1, { throttle: 0.6, steer: 0.35 }, hz);
    run(car, 2, { brake: 0.6, steer: -0.2 }, hz);
    return car;
  });
  for (const car of cars.slice(1)) {
    for (const key of ['x', 'z', 'heading', 'speed', 'fuel']) {
      assert.ok(Math.abs(car.state[key] - cars[0].state[key]) < 1e-7, `${key} differs by render cadence`);
    }
  }
});

test('off-track surfaces reduce acceleration, invalidate lap and retain free movement', () => {
  const asphalt = new VehiclePhysics(straightTrack());
  const gravel = new VehiclePhysics(straightTrack());
  gravel.state.x = 13;
  run(asphalt, 3, { throttle: 1 });
  run(gravel, 3, { throttle: 1 });
  assert.equal(gravel.state.surface, 'gravel');
  assert.equal(gravel.state.offTrack, true);
  assert.equal(gravel.state.validLap, false);
  assert.ok(gravel.state.speed < asphalt.state.speed * 0.7);
  assert.equal(gravel.state.x, 13);
});

test('barrier contacts contain the car, dissipate impact energy and record damage', () => {
  const car = new VehiclePhysics(straightTrack({ barrier: 19 }));
  car.state.x = 17;
  car.state.vx = 35;
  car.state.vz = 15;
  car.state.heading = Math.atan2(35, 15);
  run(car, 0.2, {});
  const envelope = envelopeLaterals(car.state, car.track);
  assert.ok(envelope.max <= 19 + 1e-7);
  assert.ok(envelope.min >= -19 - 1e-7);
  assert.ok(car.state.speed < 30);
  assert.ok(car.state.damage > 0);
  assert.equal(car.state.validLap, false);
  assert.ok(Number.isFinite(car.state.heading));
});

test('collision dimensions enclose the authored car and agree with its axles and tires', () => {
  const mesh = createCar();
  try {
    const d = mesh.dimensions;
    assert.equal(VEHICLE_CONSTANTS.wheelbase, d.wheelbase);
    assert.equal(VEHICLE_CONSTANTS.frontAxle, d.frontAxle);
    assert.equal(VEHICLE_CONSTANTS.rearAxle, d.rearAxle);
    assert.equal(VEHICLE_CONSTANTS.wheelRadius, d.wheelRadius);
    assert.ok(Math.abs(VEHICLE_CONSTANTS.width - d.width) < 1e-6);
    assert.ok(VEHICLE_CONSTANTS.frontExtent >= d.max.z);
    assert.ok(VEHICLE_CONSTANTS.rearExtent >= -d.min.z);
    assert.ok(VEHICLE_CONSTANTS.frontExtent - d.max.z < .001);
    assert.ok(VEHICLE_CONSTANTS.rearExtent + d.min.z < .001);
  } finally { mesh.dispose(); }
});

test('parallel, oblique and sideways impacts contain every envelope corner on either wall', () => {
  for (const roadHeading of [0, .73]) for (const angle of [0, .55, -.55, Math.PI / 2, -Math.PI / 2, 2.2, Math.PI]) for (const side of [-1, 1]) {
    const label = `road=${roadHeading}, angle=${angle}, side=${side}`;
    const left = 7.4, right = 6.8;
    const track = straightTrack({ barrierLeft: left, barrierRight: right, heading: roadHeading });
    const car = new VehiclePhysics(track);
    car.state.heading = roadHeading + angle;
    const atCenter = envelopeLaterals(car.state, track);
    const boundary = side > 0 ? right - atCenter.max : -left - atCenter.min;
    const lateral = boundary + side * .18;
    const frame = track.sample(100);
    Object.assign(car.state, {
      x: frame.position.x + frame.right.x * lateral,
      z: frame.position.z + frame.right.z * lateral,
      vx: frame.right.x * side * 12 + frame.tangent.x * 8,
      vz: frame.right.z * side * 12 + frame.tangent.z * 8,
      speed: Math.hypot(12, 8), yawRate: side * .4,
    });
    const before = Math.hypot(car.state.vx, car.state.vz);
    car.step(1 / 120, {});
    const envelope = envelopeLaterals(car.state, track);
    assert.ok(envelope.max <= right + 1e-7, `${label}: nose/rear crossed right wall`);
    assert.ok(envelope.min >= -left - 1e-7, `${label}: nose/rear crossed left wall`);
    assert.ok(car.state.damage > 0 && car.state.collision > 0, `${label}: no impact recorded`);
    assert.ok(car.state.speed < before, `${label}: impact added energy`);
    assert.ok(Math.abs(car.state.yawRate) < .4, `${label}: unstable impact yaw`);
    assert.equal(car.state.validLap, true, `${label}: wall touch alone invalidated lap`);
  }
});

test('a clear rotated envelope does not collide prematurely or alter free motion', () => {
  for (const roadHeading of [0, -.83]) for (const angle of [0, .6, -.6, Math.PI / 2, -Math.PI / 2, Math.PI]) for (const side of [-1, 1]) {
    const nearTrack = straightTrack({ barrierLeft: 7.4, barrierRight: 6.8, heading: roadHeading });
    const openTrack = straightTrack({ heading: roadHeading });
    const car = new VehiclePhysics(nearTrack), reference = new VehiclePhysics(openTrack);
    car.state.heading = roadHeading + angle;
    const atCenter = envelopeLaterals(car.state, nearTrack);
    const boundary = side > 0 ? 6.8 - atCenter.max : -7.4 - atCenter.min;
    const lateral = boundary - side * .3, frame = nearTrack.sample(100);
    Object.assign(car.state, {
      x: frame.position.x + frame.right.x * lateral,
      z: frame.position.z + frame.right.z * lateral,
      vx: frame.tangent.x * 10, vz: frame.tangent.z * 10, speed: 10,
    });
    Object.assign(reference.state, car.state, { gForce: { ...car.state.gForce } });
    car.step(1 / 120, {}); reference.step(1 / 120, {});
    assert.equal(car.state.collision, 0);
    assert.equal(car.state.damage, 0);
    for (const key of ['x', 'z', 'vx', 'vz', 'heading', 'yawRate']) assert.equal(car.state[key], reference.state[key], key);
  }
});

test('a nose can contact either wall while the center remains on the opposite side', () => {
  for (const side of [-1, 1]) {
    const track = straightTrack({ width: 4, barrierLeft: side < 0 ? 2.8 : 12, barrierRight: side > 0 ? 2.8 : 12, heading: .45 });
    const car = new VehiclePhysics(track), frame = track.sample(100);
    Object.assign(car.state, {
      x: frame.position.x - frame.right.x * side * .1, z: frame.position.z - frame.right.z * side * .1,
      heading: .45 + side * Math.PI / 2, vx: frame.right.x * side * 8, vz: frame.right.z * side * 8, speed: 8,
    });
    car.step(1 / 120, {});
    assert.ok(car.state.lateral * side < 0, 'center remains on the opposite side');
    const envelope = envelopeLaterals(car.state, track);
    assert.ok(side > 0 ? envelope.max <= 2.8 + 1e-7 : envelope.min >= -2.8 - 1e-7);
    assert.ok(car.state.damage > 0);
    assert.equal(car.state.validLap, true);
  }
});

test('depenetration while moving away adds no impulse, damage or lap invalidation', () => {
  const track = straightTrack({ barrierLeft: 7, barrierRight: 7 });
  const car = new VehiclePhysics(track);
  Object.assign(car.state, { x: 6.2, z: 100, vx: -3, vz: 20, heading: 0, yawRate: .2 });
  const before = { vx: car.state.vx, vz: car.state.vz, yawRate: car.state.yawRate };
  const nearest = track.nearest(car.state.x, car.state.z);
  car._resolveBarrier(nearest, 832);
  assert.equal(car.state.x, 6);
  assert.equal(nearest.lateral, 6);
  assert.deepEqual({ vx: car.state.vx, vz: car.state.vz, yawRate: car.state.yawRate }, before);
  assert.equal(car.state.damage, 0);
  assert.equal(car.state.validLap, true);
});

test('wall projection uses a normalized road frame and works without an explicit tangent', () => {
  const track = straightTrack({ heading: .67, barrier: 7 });
  const frame = track.sample(100);
  for (const normalScale of [0, 3]) {
    const car = new VehiclePhysics(track);
    const lateral = 7 - VEHICLE_CONSTANTS.frontExtent + .2;
    Object.assign(car.state, {
      heading: .67 + Math.PI / 2,
      x: frame.position.x + frame.right.x * lateral, z: frame.position.z + frame.right.z * lateral,
    });
    const nearest = track.nearest(car.state.x, car.state.z);
    delete nearest.tangent;
    if (normalScale) nearest.right = { x: frame.right.x * normalScale, z: frame.right.z * normalScale };
    else delete nearest.right;
    car._resolveBarrier(nearest, 832);
    assert.ok(Math.abs(envelopeLaterals(car.state, track).max - 7) < 1e-9);
    assert.ok(Math.abs(nearest.lateral - (7 - VEHICLE_CONSTANTS.frontExtent)) < 1e-9);
    assert.equal(car.state.damage, 0);
  }
});

test('an impossibly narrow custom corridor has a stable, finite projection', () => {
  const track = straightTrack({ width: 2, barrier: 1.1 });
  const car = new VehiclePhysics(track);
  Object.assign(car.state, { x: 5, z: 100, heading: Math.PI / 2 });
  car._resolveBarrier(track.nearest(car.state.x, car.state.z), 832);
  const initialX = car.state.x;
  for (let i = 0; i < 20; i++) car._resolveBarrier(track.nearest(car.state.x, car.state.z), 832);
  assert.ok(Number.isFinite(car.state.x));
  assert.ok(Math.abs(car.state.x - initialX) < 1e-12, 'center must not alternate between infeasible walls');
  const envelope = envelopeLaterals(car.state, track);
  assert.ok(Math.abs((envelope.max - 1.1) - (-1.1 - envelope.min)) < 1e-9, 'unavoidable overlap is balanced');
  assert.equal(car.state.damage, 0, 'static overlap has no invented impact speed');
});

test('manual shifts trigger once per press and reset restores all drive state', () => {
  const car = new VehiclePhysics(straightTrack(), { autoGears: false });
  run(car, 1, { gearUp: true });
  assert.equal(car.state.gear, 2);
  car.step(1 / 60, {});
  car.step(1 / 60, { gearUp: true });
  assert.equal(car.state.gear, 3);
  run(car, 2, { throttle: 1 });
  const previousState = car.state;
  car.reset(100);
  assert.equal(car.state, previousState, 'state object remains usable by render subscribers');
  assert.equal(car.state.gear, 1);
  assert.equal(car.state.speed, 0);
  assert.equal(car.state.z, 100);
  assert.equal(car.state.validLap, true);
  assert.equal(car.state.ers, 1);
  assert.equal(car.state.damage, 0);
});

test('boost consumes stored energy, braking recovers it, and DRS closes on brake', () => {
  const car = new VehiclePhysics(straightTrack());
  run(car, 7, { throttle: 1, boost: true, drs: true });
  const initialEnergy = car.state.ers;
  assert.ok(initialEnergy < 0.9);
  assert.equal(car.state.drs, true);
  run(car, 1, { brake: 1, drs: true });
  assert.equal(car.state.drs, false);
  assert.ok(car.state.ers > initialEnergy);
  assert.ok(car.state.brakeTemperature > 300);
});

test('all state remains finite after large frame gaps and extreme steering', () => {
  const car = new VehiclePhysics(straightTrack({ width: 20000 }), { assist: false });
  run(car, 7, { throttle: 1 });
  car.step(20, { throttle: 1, steer: 1 });
  for (let i = 0; i < 2000; i++) car.step(1 / 120, {
    throttle: i % 300 < 200 ? 1 : 0, brake: i % 300 < 200 ? 0 : 1,
    steer: Math.sin(i * 0.017), boost: true,
  });
  for (const [key, value] of Object.entries(car.state)) {
    if (typeof value === 'number') assert.ok(Number.isFinite(value), `${key} must remain finite`);
  }
  assert.ok(car.state.speed < 120);
  car.step(NaN, { throttle: 1 });
  assert.ok(Number.isFinite(car.state.speed));
});

test('input is smoothed, releases on blur/disable, and shifts are press events', () => {
  const events = new EventTarget();
  const input = new InputController(events);
  const key = (type, code) => {
    const event = new Event(type, { cancelable: true });
    Object.defineProperty(event, 'code', { value: code });
    events.dispatchEvent(event);
  };
  key('keydown', 'KeyW');
  key('keydown', 'KeyD');
  const first = input.sample(1 / 60);
  assert.ok(first.throttle > 0 && first.throttle < 1);
  assert.ok(first.steer > 0 && first.steer < 1);
  key('keydown', 'KeyX');
  assert.equal(input.sample(1 / 60).gearUp, true);
  assert.equal(input.sample(1 / 60).gearUp, false);
  events.dispatchEvent(new Event('blur'));
  assert.equal(input.sample(1 / 60).throttle, 0);
  input.touch.throttle = 1;
  assert.ok(input.sample(1 / 60).throttle > 0);
  input.setEnabled(false);
  assert.equal(input.sample(1 / 60).throttle, 0);
  input.dispose();
});
