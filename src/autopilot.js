/**
 * Demonstration driver. Produces ordinary pedal/steering inputs; the car still
 * goes through VehiclePhysics and is never positioned or attached to the road.
 */
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const wrap = (x, n) => ((x % n) + n) % n;
const angle = a => Math.atan2(Math.sin(a), Math.cos(a));

export class Autopilot {
  constructor(track, options = {}) {
    this.track = track;
    this.options = { maxSpeed: 88, cornerAcceleration: 13, aeroAllowance: 0.002,
      brakingAcceleration: 14, curvatureSpan: 30, boost: true, ...options };
    this.spacing = 3;
    this.count = Math.ceil(track.length / this.spacing);
    this.spacing = track.length / this.count;
    this.targetSpeed = 0;
    this.lookAhead = 0;
    this.profile = this._buildProfile();
    this.reset();
  }

  reset() {
    this.targetSpeed = 0;
    this.lookAhead = 0;
    this.lastInput = { throttle: 0, brake: 0, steer: 0, boost: false, drs: false, gearUp: false, gearDown: false };
  }

  _buildProfile() {
    const n = this.count, track = this.track;
    const speeds = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const d = i * this.spacing;
      // Use the heading change across a finite span rather than a derivative at
      // a single geographic-polyline join. The driver rounds those joins within
      // the road width instead of treating a tiny map kink as a hairpin.
      let curvature = 0;
      const halfSpan = this.options.curvatureSpan / 2;
      for (const delta of [-4, 0, 4]) {
        const before = track.sample(d + delta - halfSpan), after = track.sample(d + delta + halfSpan);
        curvature = Math.max(curvature, Math.abs(angle(after.heading - before.heading)) / this.options.curvatureSpan);
      }
      // The aero allowance represents increasing cornering ability with speed;
      // it is deliberately below the car's peak capacity to leave recovery room.
      speeds[i] = Math.min(this.options.maxSpeed,
        Math.sqrt(this.options.cornerAcceleration / Math.max(curvature - this.options.aeroAllowance, 0.0004)));
    }
    // Periodic backward braking envelope followed by an acceleration envelope.
    // Repeated passes carry the constraint across the start/finish seam.
    for (let pass = 0; pass < 3; pass++) {
      for (let i = n - 1; i >= 0; i--) speeds[i] = Math.min(speeds[i],
        Math.sqrt(speeds[(i + 1) % n] ** 2 + 2 * this.options.brakingAcceleration * this.spacing));
      for (let i = 0; i < n; i++) speeds[i] = Math.min(speeds[i],
        Math.sqrt(speeds[wrap(i - 1, n)] ** 2 + 2 * 8 * this.spacing));
    }
    return speeds;
  }

  speedAt(distance) {
    const index = wrap(distance, this.track.length) / this.spacing;
    const i = Math.floor(index), t = index - i;
    return this.profile[i] * (1 - t) + this.profile[(i + 1) % this.count] * t;
  }

  sample(state, dt = 1 / 60) {
    const speed = Math.max(0, state.speed || 0);
    const nearest = this.track.nearest(state.x, state.z, state.distance);
    const lookAhead = clamp(4 + speed * 0.24, 5, 24);
    const target = this.track.sample(nearest.distance + lookAhead);
    const dx = target.position.x - state.x, dz = target.position.z - state.z;
    const targetHeading = Math.atan2(dx, dz);
    const headingError = angle(targetHeading - state.heading);
    const targetCurvature = 2 * Math.sin(headingError) / Math.max(Math.hypot(dx, dz), 2);
    const desiredYaw = targetCurvature * speed;
    const steerAngle = Math.atan(3.6 * targetCurvature) + clamp((desiredYaw - (state.yawRate || 0)) * 0.035, -0.06, 0.06);
    const steeringLimit = Math.max(state.steeringLimit || 0.48, 0.008);
    const steer = clamp(steerAngle / steeringLimit, -1, 1);
    let targetSpeed = this.speedAt(nearest.distance + speed * 0.30);
    // Recover safely if the driver hands over while the car is misaligned.
    targetSpeed *= clamp(1 - Math.max(0, Math.abs(nearest.lateral) - 2) * 0.08, 0.35, 1);
    targetSpeed *= clamp(1 - Math.max(0, Math.abs(headingError) - 0.25) * 0.65, 0.4, 1);
    const error = targetSpeed - speed;
    let throttle = clamp(0.08 + speed * speed * 0.00013 + error * 0.35, 0, 1);
    let brake = error < -0.65 ? clamp((-error - 0.40) * 0.16, 0, 1) : 0;
    if (brake > 0) throttle = 0;
    if (Math.abs(headingError) > 1.25 && speed > 12) { throttle = 0; brake = Math.max(brake, 0.6); }
    this.targetSpeed = targetSpeed;
    this.lookAhead = lookAhead;
    this.lastInput = {
      throttle, brake, steer,
      boost: this.options.boost && throttle > 0.96 && targetSpeed - speed > 5 && speed > 28,
      drs: Boolean(this.track.isDrsZone?.(nearest.distance)) && brake < 0.03,
      gearUp: false, gearDown: false,
    };
    return this.lastInput;
  }

  update(state, dt) { return this.sample(state, dt); }
}

export const createAutopilot = (track, options) => new Autopilot(track, options);
