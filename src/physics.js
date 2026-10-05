/**
 * A real-time planar, two-axle model of a 2025-style open-wheel car.
 * Coordinates: +Z forward at heading 0; positive heading / steer turn right.
 * Coefficients are game tuning, not proprietary or validated Formula One data.
 */
const G = 9.80665;
const STEP = 1 / 120;
const WHEELBASE = 3.60;
const FRONT_ARM = 1.98;
const REAR_ARM = WHEELBASE - FRONT_ARM;
const WHEEL_RADIUS = 0.36;
// Conservative planar bounds of the authored AP-25 mesh. Longitudinal extents
// are measured from the same center-of-mass origin as the axle lever arms,
// rounded outward to 0.1 mm. This is a collision envelope, not a mass model.
const CAR_HALF_WIDTH = 1.0;
const CAR_FRONT_EXTENT = 3.0984;
const CAR_REAR_EXTENT = 2.6572;
const YAW_INERTIA = 1260;
const RATIOS = [0, 14.8, 11.15, 8.90, 7.45, 6.50, 5.78, 5.12, 4.55];
const TYRES = {
  soft: { grip: 1.66, ideal: 94, wear: 1.0, color: '#ef4444' },
  medium: { grip: 1.58, ideal: 96, wear: 0.69, color: '#fbbf24' },
  hard: { grip: 1.51, ideal: 99, wear: 0.46, color: '#f4f4f5' },
};
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const finite = (n, fallback = 0) => Number.isFinite(n) ? n : fallback;
const approach = (current, target, rate, dt) => current + (target - current) * (1 - Math.exp(-rate * dt));
const wrap = (x, length) => ((x % length) + length) % length;
const angleWrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

/** Smooth, load-limited tire curve with a mild falloff beyond the peak. */
function lateralTireForce(slipAngle, grip) {
  const a = 10.7 * slipAngle;
  return -grip * Math.sin(1.35 * Math.atan(a + 0.15 * (a - Math.atan(a))));
}

function combineForces(longitudinal, lateral, limit) {
  const force = Math.hypot(longitudinal, lateral);
  const scale = force > limit ? limit / Math.max(force, 0.01) : 1;
  return { longitudinal: longitudinal * scale, lateral: lateral * scale, utilization: force / Math.max(limit, 1) };
}

export const VEHICLE_CONSTANTS = Object.freeze({
  fixedStep: STEP, wheelbase: WHEELBASE, dryMass: 800, startingFuel: 32,
  frontAxle: FRONT_ARM, rearAxle: -REAR_ARM, wheelRadius: WHEEL_RADIUS,
  width: 2 * CAR_HALF_WIDTH, frontExtent: CAR_FRONT_EXTENT, rearExtent: CAR_REAR_EXTENT,
  maxERSJoules: 4_000_000, maxERSPower: 120_000, redline: 12_500,
});

const GEOMETRY_KEYS = ['wheelbase', 'frontAxle', 'rearAxle', 'wheelRadius', 'width', 'frontExtent', 'rearExtent'];
const DEFAULT_GEOMETRY = Object.freeze(Object.fromEntries(GEOMETRY_KEYS.map(key => [key, VEHICLE_CONSTANTS[key]])));

function vehicleGeometry(value) {
  if (value === undefined) return DEFAULT_GEOMETRY;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Vehicle geometry must provide all seven dimensions in metres.');
  }
  const geometry = Object.fromEntries(GEOMETRY_KEYS.map(key => [key, value[key]]));
  for (const key of GEOMETRY_KEYS) {
    const dimension = key === 'rearAxle' ? -geometry[key] : geometry[key];
    // This is a road-car model. Finite, bounded lengths also prevent tiny
    // divisors or enormous lever arms from contaminating the integration.
    if (!Number.isFinite(dimension) || dimension < .01 || dimension > 20) {
      throw new RangeError(`Vehicle geometry ${key} must have the correct sign and a magnitude from 0.01 to 20 metres.`);
    }
  }
  if (Math.abs(geometry.wheelbase - (geometry.frontAxle - geometry.rearAxle)) > 1e-5) {
    throw new RangeError('Vehicle wheelbase must equal frontAxle - rearAxle.');
  }
  if (geometry.frontExtent + 1e-5 < geometry.frontAxle + geometry.wheelRadius
    || geometry.rearExtent + 1e-5 < -geometry.rearAxle + geometry.wheelRadius) {
    throw new RangeError('Vehicle front and rear extents must enclose the axles and tyre radius.');
  }
  return Object.freeze(geometry);
}

export class VehiclePhysics {
  constructor(track, options = {}) {
    if (!track || typeof track.sample !== 'function' || typeof track.nearest !== 'function') {
      throw new TypeError('VehiclePhysics requires a track with sample() and nearest().');
    }
    this.track = track;
    const { geometry, ...settings } = options;
    Object.defineProperty(this, 'geometry', { value: vehicleGeometry(geometry), enumerable: true });
    this.options = { assist: true, autoGears: true, tyre: 'soft', ...settings };
    this.state = {};
    this._accumulator = 0;
    this._gearLatch = { up: false, down: false };
    this._pendingGearUp = false;
    this._pendingGearDown = false;
    this.reset();
  }

  setOptions(options = {}) {
    const { geometry, ...settings } = options;
    if (geometry !== undefined && geometry !== this.geometry) {
      throw new TypeError('Vehicle geometry is fixed at construction; create a new VehiclePhysics to change it.');
    }
    Object.assign(this.options, settings);
    if (!(this.options.tyre in TYRES)) this.options.tyre = 'soft';
    return this;
  }

  reset(distance = 0) {
    const d = wrap(finite(distance), this.track.length || 5793);
    const sample = this.track.sample(d);
    const heading = Number.isFinite(sample.heading) ? sample.heading : Math.atan2(sample.tangent.x, sample.tangent.z);
    Object.assign(this.state, {
      x: sample.position.x, z: sample.position.z, heading,
      vx: 0, vz: 0, speed: 0, forwardSpeed: 0, lateralSpeed: 0,
      steering: 0, steeringAngle: 0, steeringLimit: 0.48, throttle: 0, brake: 0, gear: 1, rpm: 4200,
      slip: 0, frontSlip: 0, rearSlip: 0, wheelSlip: 0, yawRate: 0,
      tyreTemp: 88, tyreWear: 0, fuel: VEHICLE_CONSTANTS.startingFuel,
      ers: 1, boost: false, drs: false, drsAvailable: false, damage: 0,
      distance: d, lateral: 0, offTrack: false, surface: 'asphalt',
      gForce: { x: 0, y: 0 }, validLap: true,
      acceleration: 0, engineLoad: 0, enginePower: 0, brakeTemperature: 280,
      downforce: 0, grip: 1, gripUsage: 0, isShifting: false,
      travelDistance: 0, collision: 0, collisionSpeed: 0, elapsed: 0,
      wheelRotation: 0, rideHeight: 0.055, suspensionTravel: 0,
    });
    this._accumulator = 0;
    this._shiftTimer = 0;
    this._shiftCooldown = 0;
    this._acceleration = 0;
    this._gearLatch = { up: false, down: false };
    this._pendingGearUp = false;
    this._pendingGearDown = false;
    this._safeDistance = d;
    return this.state;
  }

  /** Accepts render-frame deltas; forces are always integrated at 120 Hz. */
  step(dt, input = {}) {
    if (!Number.isFinite(dt) || dt <= 0) return this.state;
    const safeInput = {
      throttle: clamp(finite(input.throttle), 0, 1),
      brake: clamp(finite(input.brake), 0, 1),
      steer: clamp(finite(input.steer), -1, 1),
      boost: Boolean(input.boost), drs: Boolean(input.drs),
    };
    if (input.gearUp && !this._gearLatch.up) this._pendingGearUp = true;
    if (input.gearDown && !this._gearLatch.down) this._pendingGearDown = true;
    this._gearLatch.up = Boolean(input.gearUp);
    this._gearLatch.down = Boolean(input.gearDown);
    // A backgrounded browser cannot inject seconds of stale held controls.
    this._accumulator += Math.min(dt, 0.1);
    while (this._accumulator + 1e-10 >= STEP) {
      this._integrate(STEP, safeInput);
      this._accumulator -= STEP;
    }
    return this.state;
  }

  _changeGear(delta) {
    const s = this.state;
    if (this._shiftCooldown > 0) return;
    const next = clamp(s.gear + delta, 1, 8);
    if (next === s.gear) return;
    const predictedRpm = Math.abs(s.forwardSpeed) * RATIOS[next] * 60 / (2 * Math.PI * this.geometry.wheelRadius);
    // Electronic protection: a downshift that would over-rev is refused.
    if (delta < 0 && predictedRpm > 12_200) return;
    s.gear = next;
    this._shiftTimer = delta > 0 ? 0.065 : 0.045;
    this._shiftCooldown = 0.18;
  }

  _surface(nearest) {
    const halfWidth = finite(nearest.width, finite(this.track.width, 12)) / 2;
    const outside = Math.abs(nearest.lateral) - halfWidth;
    const surface = typeof this.track.surfaceAt === 'function'
      ? this.track.surfaceAt(nearest.distance, nearest.lateral)
      : outside <= 0 ? 'asphalt' : outside < 1.25 ? 'kerb' : outside < 5 ? 'grass' : 'gravel';
    const name = typeof surface === 'string' ? surface : surface?.type || 'asphalt';
    if (name === 'gravel') return { name, friction: 0.46, resistance: 1.4, bump: 0.028, halfWidth };
    if (name === 'grass') return { name, friction: 0.53, resistance: 0.55, bump: 0.018, halfWidth };
    if (name === 'kerb') return { name, friction: 0.9, resistance: 0.03, bump: 0.012, halfWidth };
    return { name: 'asphalt', friction: 1, resistance: 0, bump: 0, halfWidth };
  }

  _integrate(dt, input) {
    const s = this.state;
    const {wheelbase, frontAxle: frontArm, rearAxle, wheelRadius} = this.geometry;
    const rearArm = -rearAxle;
    const nearest = this.track.nearest(s.x, s.z, s.distance);
    const surface = this._surface(nearest);
    const speed = Math.hypot(s.vx, s.vz);
    let sn = Math.sin(s.heading), cs = Math.cos(s.heading);
    let longitudinalSpeed = s.vx * sn + s.vz * cs;
    let lateralSpeed = s.vx * cs - s.vz * sn;
    const absForward = Math.abs(longitudinalSpeed);
    const mass = VEHICLE_CONSTANTS.dryMass + s.fuel;
    const tyre = TYRES[this.options.tyre] || TYRES.soft;
    const warmPenalty = clamp(1 - Math.abs(s.tyreTemp - tyre.ideal) * 0.0023, 0.73, 1);
    const wearPenalty = 1 - s.tyreWear * 0.22;
    const mu = tyre.grip * warmPenalty * wearPenalty * surface.friction;

    s.throttle = approach(s.throttle, input.throttle, 12, dt);
    s.brake = approach(s.brake, input.brake, input.brake > s.brake ? 22 : 30, dt);
    s.steering = approach(s.steering, input.steer, this.options.assist ? 10 : 16, dt);
    s.elapsed += dt;
    s.collision = Math.max(0, s.collision - dt * 2.7);
    this._shiftTimer = Math.max(0, this._shiftTimer - dt);
    this._shiftCooldown = Math.max(0, this._shiftCooldown - dt);

    if (this._pendingGearUp) { this._changeGear(1); this._pendingGearUp = false; }
    if (this._pendingGearDown) { this._changeGear(-1); this._pendingGearDown = false; }
    const wheelRpm = absForward * 60 / (2 * Math.PI * wheelRadius);
    let shaftRpm = wheelRpm * RATIOS[s.gear];
    if (this.options.autoGears && this._shiftCooldown === 0) {
      if (shaftRpm > 11_850 && s.gear < 8) this._changeGear(1);
      else if (shaftRpm < (s.brake > 0.1 ? 8300 : 7200) && s.gear > 1) this._changeGear(-1);
      shaftRpm = wheelRpm * RATIOS[s.gear];
    }
    const clutchRpm = Math.max(4200, s.throttle * 6500);
    s.rpm = approach(s.rpm, clamp(Math.max(shaftRpm, clutchRpm), 4200, 12_800), 22, dt);
    s.isShifting = this._shiftTimer > 0;

    const zoneFlag = typeof this.track.isDrsZone === 'function'
      ? this.track.isDrsZone(nearest.distance)
      : nearest.drsZone ?? nearest.drsAvailable ?? (Math.abs(finite(nearest.curvature)) < 0.0008);
    s.drsAvailable = Boolean(zoneFlag) && speed > 35 && !s.offTrack;
    s.drs = input.drs && s.drsAvailable && s.brake < 0.06 && Math.abs(s.steering) < 0.8;
    const airDensity = 1.20;
    const dragArea = 1.48 * (s.drs ? 0.80 : 1) * (1 + s.damage * 0.28);
    const liftArea = 3.10 * (s.drs ? 0.79 : 1) * (1 - s.damage * 0.32);
    const downforce = 0.5 * airDensity * liftArea * speed * speed;
    const weightTransfer = clamp(mass * this._acceleration * 0.31 / wheelbase, -mass * G * 0.27, mass * G * 0.27);
    const frontLoad = Math.max(200, mass * G * rearArm / wheelbase + downforce * 0.46 - weightTransfer);
    const rearLoad = Math.max(200, mass * G * frontArm / wheelbase + downforce * 0.54 + weightTransfer);
    // Small load sensitivity makes doubling downforce less than double grip.
    const frontGrip = mu * frontLoad * Math.pow(frontLoad / (mass * G * 0.45), -0.075);
    const rearGrip = mu * rearLoad * Math.pow(rearLoad / (mass * G * 0.55), -0.075);

    const availableLateralAccel = (frontGrip + rearGrip) / mass;
    const steerLimit = this.options.assist
      ? clamp(Math.atan(wheelbase * availableLateralAccel * 0.94 / (speed * speed + 20)), 0.013, 0.48)
      : 0.48;
    s.steeringLimit = steerLimit;
    s.steeringAngle = s.steering * steerLimit;
    const steeringAngle = s.steeringAngle;
    const cosSteer = Math.cos(steeringAngle), sinSteer = Math.sin(steeringAngle);
    const slipDenominator = Math.max(absForward, 7);
    const frontSlip = Math.atan2(lateralSpeed + frontArm * s.yawRate, slipDenominator) - steeringAngle;
    const rearSlip = Math.atan2(lateralSpeed - rearArm * s.yawRate, slipDenominator);
    let frontLateral = lateralTireForce(frontSlip, frontGrip);
    let rearLateral = lateralTireForce(rearSlip, rearGrip);

    const rpmForTorque = clamp(Math.max(shaftRpm, clutchRpm), 4200, 12_800);
    const torqueCurve = rpmForTorque < 10_500
      ? 0.77 + (rpmForTorque - 4200) / 6300 * 0.23
      : Math.max(0.65, 1 - (rpmForTorque - 10_500) / 16_500);
    const limiter = shaftRpm > 12_450 ? clamp((12_800 - shaftRpm) / 350, 0, 1) : 1;
    const engineTorque = 545 * torqueCurve * s.throttle * limiter * (s.fuel > 0 ? 1 : 0);
    let driveForce = engineTorque * RATIOS[s.gear] / wheelRadius * 0.94 * (s.isShifting ? 0.12 : 1);
    s.boost = input.boost && s.ers > 0.002 && s.throttle > 0.65 && speed > 5 && s.fuel > 0;
    const boostPower = s.boost ? 120_000 : 0;
    driveForce += boostPower / Math.max(absForward, 16);

    if (this.options.assist) {
      // Traction control only manages tire force; it never steers toward the road.
      const tractionBudget = Math.sqrt(Math.max(rearGrip * rearGrip - rearLateral * rearLateral * 0.87, 0));
      driveForce = Math.min(driveForce, tractionBudget * 0.995);
    }
    const brakeForce = s.brake * 38_000;
    const motionSign = absForward > 0.25 ? Math.sign(longitudinalSpeed) : 1;
    let frontLongitudinal = -brakeForce * 0.57 * motionSign;
    let rearLongitudinal = driveForce - brakeForce * 0.43 * motionSign;
    // Approximate closed-throttle pumping losses / engine braking.
    if (longitudinalSpeed > 1) rearLongitudinal -= (1 - s.throttle) * (220 + shaftRpm * 0.028);
    if (this.options.assist && s.brake > 0) {
      frontLongitudinal = Math.max(frontLongitudinal, -frontGrip * 0.97);
      rearLongitudinal = Math.max(rearLongitudinal, -rearGrip * 0.97);
    }
    const front = combineForces(frontLongitudinal, frontLateral, frontGrip);
    const rear = combineForces(rearLongitudinal, rearLateral, rearGrip);
    frontLateral = front.lateral;
    rearLateral = rear.lateral;
    const lateralForce = frontLateral * cosSteer + front.longitudinal * sinSteer + rearLateral;
    const dragForce = 0.5 * airDensity * dragArea * speed * longitudinalSpeed;
    const rollingResistance = Math.tanh(longitudinalSpeed * 1.5) * (mass * G * 0.014 + surface.resistance * mass);
    const longitudinalForce = front.longitudinal * cosSteer - frontLateral * sinSteer + rear.longitudinal - dragForce - rollingResistance;
    const longitudinalAcceleration = longitudinalForce / mass;
    const lateralAcceleration = lateralForce / mass;
    let yawAcceleration = (frontArm * (frontLateral * cosSteer + front.longitudinal * sinSteer) - rearArm * rearLateral) / YAW_INERTIA;

    if (this.options.assist) {
      const kinematicYaw = longitudinalSpeed / wheelbase * Math.tan(steeringAngle);
      const desiredYaw = clamp(kinematicYaw, -availableLateralAccel / Math.max(speed, 8), availableLateralAccel / Math.max(speed, 8));
      yawAcceleration += (desiredYaw - s.yawRate) * 1.5;
    }
    yawAcceleration -= s.yawRate * 0.10;
    s.yawRate = clamp(s.yawRate + yawAcceleration * dt, -3.7, 3.7);
    longitudinalSpeed += (longitudinalAcceleration + s.yawRate * lateralSpeed) * dt;
    lateralSpeed += (lateralAcceleration - s.yawRate * longitudinalSpeed) * dt;

    // Blend to a stable parking-speed model to remove the tire-slip singularity.
    const lowSpeedBlend = clamp((7 - absForward) / 6, 0, 1);
    if (lowSpeedBlend > 0) {
      const targetYaw = longitudinalSpeed / wheelbase * Math.tan(steeringAngle);
      s.yawRate = approach(s.yawRate, targetYaw, lowSpeedBlend * 26, dt);
      lateralSpeed = approach(lateralSpeed, rearArm * s.yawRate, lowSpeedBlend * 20, dt);
    }
    if (s.brake > 0.02 && absForward < 1 && longitudinalSpeed < 0 && s.throttle < s.brake) longitudinalSpeed = 0;
    if (s.throttle < 0.02 && Math.abs(longitudinalSpeed) < 0.065) longitudinalSpeed = 0;
    if (Math.abs(longitudinalSpeed) < 0.04 && Math.abs(lateralSpeed) < 0.08) {
      lateralSpeed = 0;
      s.yawRate = approach(s.yawRate, 0, 30, dt);
    }
    s.heading = angleWrap(s.heading + s.yawRate * dt);
    sn = Math.sin(s.heading); cs = Math.cos(s.heading);
    s.vx = longitudinalSpeed * sn + lateralSpeed * cs;
    s.vz = longitudinalSpeed * cs - lateralSpeed * sn;
    s.x += s.vx * dt;
    s.z += s.vz * dt;

    const updated = this.track.nearest(s.x, s.z, nearest.distance);
    this._resolveBarrier(updated, mass);
    s.speed = Math.hypot(s.vx, s.vz);
    s.forwardSpeed = s.vx * Math.sin(s.heading) + s.vz * Math.cos(s.heading);
    s.lateralSpeed = s.vx * Math.cos(s.heading) - s.vz * Math.sin(s.heading);
    s.distance = wrap(updated.distance, this.track.length || 5793);
    s.lateral = updated.lateral;
    s.offTrack = Math.abs(s.lateral) > surface.halfWidth + 0.8;
    const updatedSurface = this._surface(updated);
    s.surface = updatedSurface.name;
    if (Math.abs(s.lateral) > surface.halfWidth + 1.8) s.validLap = false;
    if (!s.offTrack && s.speed < 100) this._safeDistance = s.distance;
    s.slip = Math.max(Math.abs(frontSlip), Math.abs(rearSlip));
    s.frontSlip = frontSlip;
    s.rearSlip = rearSlip;
    s.wheelSlip = clamp(Math.max(front.utilization, rear.utilization) - 1, 0, 2);
    s.gripUsage = clamp(Math.max(front.utilization, rear.utilization), 0, 1.5);
    s.grip = mu / tyre.grip;
    s.downforce = downforce;
    s.acceleration = approach(s.acceleration, longitudinalAcceleration, 14, dt);
    s.gForce.x = approach(s.gForce.x, lateralAcceleration / G, 14, dt);
    s.gForce.y = approach(s.gForce.y, longitudinalAcceleration / G, 14, dt);
    this._acceleration = approach(this._acceleration, longitudinalAcceleration, 10, dt);
    s.engineLoad = approach(s.engineLoad, s.throttle * (s.isShifting ? 0.25 : 1), 18, dt);
    s.enginePower = engineTorque * rpmForTorque * Math.PI / 30 + boostPower;
    s.travelDistance += s.speed * dt;
    s.wheelRotation = (s.wheelRotation + s.forwardSpeed / wheelRadius * dt) % (Math.PI * 2);
    s.rideHeight = 0.057 - Math.min(downforce / 1_200_000, 0.025);
    s.suspensionTravel = updatedSurface.bump * Math.sin(s.travelDistance * 4.1) * clamp(s.speed / 30, 0, 1);

    const tireWork = Math.abs(frontLateral * (lateralSpeed + frontArm * s.yawRate))
      + Math.abs(rearLateral * (lateralSpeed - rearArm * s.yawRate));
    const thermalTarget = 70 + clamp(speed / 70, 0, 1) * 14 + s.gripUsage * 12 + clamp(tireWork / 24_000, 0, 1) * 15;
    s.tyreTemp = clamp(approach(s.tyreTemp, thermalTarget, 0.021, dt), 35, 150);
    s.tyreWear = clamp(s.tyreWear + dt * tyre.wear * (0.000011 + s.gripUsage * 0.000024 + s.wheelSlip * 0.000035)
      * (surface.name === 'gravel' ? 2.5 : 1), 0, 1);
    s.brakeTemperature = approach(s.brakeTemperature, 220 + s.brake * Math.min(speed / 65, 1) * 920, s.brake > 0.05 ? 0.6 : 0.055, dt);
    s.fuel = Math.max(0, s.fuel - dt * (0.0012 + Math.max(0, s.enginePower - boostPower) / 22_000_000));
    const recoveredPower = Math.min(120_000, brakeForce * absForward * 0.30) + (!s.boost && s.throttle < 0.55 ? 16_000 : 0);
    s.ers = clamp(s.ers + dt * (recoveredPower - boostPower) / VEHICLE_CONSTANTS.maxERSJoules, 0, 1);

    // Recover safely if malformed custom geometry ever contaminates the state.
    if (![s.x, s.z, s.heading, s.vx, s.vz].every(Number.isFinite)) this.reset(this._safeDistance);
  }

  _resolveBarrier(nearest, mass) {
    const s = this.state;
    const {width, frontExtent, rearExtent} = this.geometry;
    const halfWidth = finite(nearest.width, finite(this.track.width, 12)) / 2;
    const fallbackWall = finite(nearest.barrierWidth,
      halfWidth + finite(nearest.runoffWidth, finite(this.track.runoffWidth, 13)));
    const wallLeft = Math.max(0, finite(nearest.barrierLeft, fallbackWall));
    const wallRight = Math.max(0, finite(nearest.barrierRight, fallbackWall));
    const heading = finite(nearest.heading, Math.atan2(nearest.tangent?.x || 0, nearest.tangent?.z ?? 1));
    let nx = finite(nearest.right?.x, Math.cos(heading));
    let nz = finite(nearest.right?.z, -Math.sin(heading));
    const normalLength = Math.hypot(nx, nz);
    if (normalLength > 1e-8) { nx /= normalLength; nz /= normalLength; }
    else { nx = Math.cos(heading); nz = -Math.sin(heading); }

    // Project all four corners of the asymmetric car rectangle onto the local
    // road normal. At an angle, the nose can reach one wall while the longer
    // center-to-front arm changes the opposite wall's available clearance.
    const delta = angleWrap(s.heading - Math.atan2(-nz, nx));
    const sinDelta = Math.sin(delta);
    const widthSupport = width / 2 * Math.abs(Math.cos(delta));
    const rightSupport = widthSupport + (sinDelta >= 0 ? frontExtent * sinDelta : -rearExtent * sinDelta);
    const leftSupport = widthSupport + (sinDelta >= 0 ? rearExtent * sinDelta : -frontExtent * sinDelta);
    const minLateral = -wallLeft + leftSupport;
    const maxLateral = wallRight - rightSupport;
    const lateral = nearest.lateral;
    if (lateral >= minLateral - 1e-9 && lateral <= maxLateral + 1e-9) return;

    // Check both walls, independent of the center's sign. If a custom corridor
    // cannot fit this heading, balance its unavoidable overlap without bouncing
    // the center between the two sides. Rotation remains the driving model's job.
    const fits = minLateral <= maxLateral;
    const correctedLateral = fits ? clamp(lateral, minLateral, maxLateral) : (minLateral + maxLateral) * .5;
    const excess = lateral - correctedLateral;
    const side = Math.sign(excess) || Math.sign(s.vx * nx + s.vz * nz) || 1;
    s.x -= nx * excess;
    s.z -= nz * excess;
    const normalSpeed = (s.vx * nx + s.vz * nz) * side;
    if (normalSpeed > 0) {
      const impulse = normalSpeed * 1.12;
      s.vx -= nx * side * impulse;
      s.vz -= nz * side * impulse;
      const scrub = clamp(1 - normalSpeed * 0.014, 0.62, 0.98);
      s.vx *= scrub;
      s.vz *= scrub;
      s.yawRate *= 0.35;
      s.collision = clamp(normalSpeed / 9, 0.15, 1);
      s.collisionSpeed = normalSpeed;
      s.damage = clamp(s.damage + normalSpeed * normalSpeed * mass / 9_000_000, 0, 1);
    }
    nearest.lateral = correctedLateral;
  }
}
