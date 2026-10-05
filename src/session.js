const STORAGE_KEY = 'apex-monza-personal-best-v1';
const TRACK_VERSION = 'monza-geographic-2025-v3-control-line';
const wrap = (value, size) => ((value % size) + size) % size;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const SAMPLE_PERIOD = .10;
const EPSILON = 1e-8;
const MAX_STEP = .1;

function snapshot(state, distance = state.distance) {
  return {x: state.x, z: state.z, heading: state.heading, distance,
    speed: state.speed, throttle: state.throttle, brake: state.brake};
}

function interpolate(a, b, fraction, movement, length) {
  const amount = clamp(fraction, 0, 1);
  const heading = Math.atan2(Math.sin(b.heading - a.heading), Math.cos(b.heading - a.heading));
  return {x: a.x + (b.x - a.x) * amount, z: a.z + (b.z - a.z) * amount,
    heading: a.heading + heading * amount,
    distance: wrap(a.distance + movement * amount, length),
    speed: a.speed + (b.speed - a.speed) * amount,
    throttle: a.throttle + (b.throttle - a.throttle) * amount,
    brake: a.brake + (b.brake - a.brake) * amount};
}

function validSavedLap(data, track) {
  if (!data || data.version !== TRACK_VERSION || data.valid !== true
    || !Number.isFinite(data.time) || data.time <= 35 || data.time >= 1800
    || !Number.isFinite(data.topSpeed) || data.topSpeed < 0 || data.topSpeed > 720
    || !Array.isArray(data.frames) || data.frames.length <= 100 || data.frames.length >= 20000
    || !Array.isArray(data.sectors) || data.sectors.length !== track.sectors.length + 1
    || !data.sectors.every(value => Number.isFinite(value) && value > 0)
    || Math.abs(data.sectors.reduce((sum, value) => sum + value, 0) - data.time) > .001) return false;
  let previousTime = -1;
  for (const frame of data.frames) {
    if (!Array.isArray(frame) || frame.length < 8 || !frame.every(Number.isFinite)
      || frame[0] < 0 || frame[0] > data.time + EPSILON || frame[0] <= previousTime
      || frame[4] < 0 || frame[4] > track.length + EPSILON
      || frame[5] < 0 || frame[5] > 200
      || frame[6] < 0 || frame[6] > 1 || frame[7] < 0 || frame[7] > 1) return false;
    previousTime = frame[0];
  }
  const first = data.frames[0], last = data.frames.at(-1);
  return Math.abs(first[0]) < EPSILON && Math.abs(first[4]) < EPSILON
    && Math.abs(last[0] - data.time) < EPSILON && Math.abs(last[4] - track.length) < EPSILON;
}

export function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return '—:——.———';
  const ms = Math.floor(seconds * 1000);
  return `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}.${String(ms % 1000).padStart(3, '0')}`;
}

export class Session {
  constructor(track, storage) {
    this.track = track;
    this.storage = storage;
    this.toLapDistance = track.toLapDistance
      || (distance => wrap(distance - (track.controlLineDistance || 0), track.length));
    this.sectorDistances = (track.lapSectors || track.sectors.map(this.toLapDistance)).slice().sort((a, b) => a - b);
    // Demonstration sessions may retain timing/history while leaving the
    // driver's personal best and browser persistence untouched.
    this.recordEnabled = true;
    this.best = null;
    this.history = [];
    try {
      if (storage === undefined) this.storage = storage = globalThis.localStorage;
      const data = JSON.parse(storage?.getItem(STORAGE_KEY) || 'null');
      if (validSavedLap(data, track)) this.best = data;
    } catch { /* Private browsing or a stale save must not stop a session. */ }
    this.reset();
  }

  // Public reset/recovery positions remain geographic. Everything recorded by
  // the timer is measured forward from the control line, independently of the
  // source polyline's start-grid seam.
  reset(distance = this.track.startLineDistance ?? 0) {
    const lapDistance = this.toLapDistance(distance);
    this.elapsed = 0;
    this.lapTime = 0;
    this.lastTime = null;
    this.lap = 1;
    this.valid = true;
    this.outLap = lapDistance > EPSILON;
    this.started = false;
    this.previousDistance = lapDistance;
    this.progress = 0;
    this.expectedGate = 1;
    this.gateCount = 20;
    this.frames = [];
    this.sampleTimer = 0;
    this.sector = 0;
    this.sectorTimes = [];
    this.lastSectors = [];
    this.lastEvent = null;
    this.topSpeed = 0;
    this.delta = null;
    this.finishedLap = null;
    const start = this.track.sample(distance);
    this.previousState = {x: start.position.x, z: start.position.z, heading: start.heading,
      distance: lapDistance, speed: 0, throttle: 0, brake: 0};
  }

  invalidate(reason = 'TRACK LIMITS — LAP INVALID') {
    if (this.valid) {
      this.valid = false;
      this.lastEvent = {type: 'invalid', message: reason};
    }
  }

  recover(distance) {
    this.invalidate('CAR RECOVERED — LAP INVALID');
    this.previousDistance = this.toLapDistance(distance);
    const start = this.track.sample(distance);
    this.previousState = {x: start.position.x, z: start.position.z, heading: start.heading,
      distance: this.previousDistance, speed: 0, throttle: 0, brake: 0};
    this.started = true;
  }

  recordFrame(time, state, distance = state.distance) {
    const frame = [time, state.x, state.z, state.heading, distance, state.speed, state.throttle, state.brake];
    const last = this.frames.at(-1);
    if (last && Math.abs(last[0] - time) < EPSILON) this.frames[this.frames.length - 1] = frame;
    else if (!last || time > last[0]) this.frames.push(frame);
    // Preserve the lap-boundary frame even during a very long practice lap.
    if (this.frames.length > 18000) this.frames.splice(1, 1);
  }

  recordSamples(startTime, duration, previous, state, movement, endFraction = 1) {
    const endTime = startTime + duration * endFraction;
    let nextTime = (Math.floor((startTime + EPSILON) / SAMPLE_PERIOD) + 1) * SAMPLE_PERIOD;
    while (nextTime <= endTime + EPSILON) {
      const at = interpolate(previous, state, (nextTime - startTime) / duration, movement, this.track.length);
      this.recordFrame(Math.min(nextTime, endTime), at);
      nextTime += SAMPLE_PERIOD;
    }
  }

  step(dt, state) {
    this.lastEvent = null;
    this.finishedLap = null;
    if (!Number.isFinite(dt) || dt <= 0) return;
    // The application supplies fixed 120 Hz steps and caps incoming frames at
    // 100 ms. A larger gap has no trustworthy crossing or ghost timeline: do
    // not invent samples for it, and re-anchor without awarding a lap crossing.
    if (dt > MAX_STEP + EPSILON) {
      this.invalidate('TIMING GAP — LAP INVALID');
      this.previousDistance = this.toLapDistance(state.distance);
      this.previousState = snapshot(state, this.previousDistance);
      this.delta = null;
      return;
    }
    if (!this.started && state.speed > .8) {
      this.started = true;
      this.recordFrame(0, this.previousState, this.previousDistance);
    }
    if (!this.started) return;
    const startTime = this.lapTime;
    const previous = this.previousState;
    this.elapsed += dt;
    this.lapTime += dt;
    this.topSpeed = Math.max(this.topSpeed, state.speed * 3.6);
    const distance = this.toLapDistance(state.distance);
    const current = snapshot(state, distance);
    let movement = distance - this.previousDistance;
    if (movement < -this.track.length / 2) movement += this.track.length;
    if (movement > this.track.length / 2) movement -= this.track.length;
    // Large discontinuities are teleports, not legitimate driving progress.
    const discontinuity = Math.abs(movement) > Math.max(20, state.speed * dt * 4 + 2);
    if (discontinuity) this.invalidate('POSITION RESET — LAP INVALID');
    this.progress += Math.max(-5, Math.min(20, movement));
    if (state.offTrack && Math.abs(state.lateral) > this.track.width / 2 + 1.25) this.invalidate();
    const gateDistance = this.expectedGate * this.track.length / this.gateCount;
    if (this.expectedGate < this.gateCount && distance >= gateDistance && distance < gateDistance + this.track.length / this.gateCount && movement >= 0) {
      this.expectedGate++;
    }
    for (let i = 0; i < this.sectorDistances.length; i++) {
      if (this.sector === i && this.previousDistance < this.sectorDistances[i] && distance >= this.sectorDistances[i] && movement > 0) {
        const crossingTime = startTime + dt * clamp((this.sectorDistances[i] - this.previousDistance) / movement, 0, 1);
        this.sectorTimes.push(crossingTime - this.sectorTimes.reduce((s, t) => s + t, 0));
        this.sector++;
      }
    }
    const crossedLine = this.previousDistance > this.track.length - 30 && distance < 30 && movement > 0;
    if (crossedLine) {
      const fraction = clamp((this.track.length - this.previousDistance) / movement, 0, 1);
      const crossingTime = startTime + dt * fraction;
      const crossingState = interpolate(previous, current, fraction, movement, this.track.length);
      crossingState.distance = 0;
      this.recordSamples(startTime, dt, previous, current, movement, fraction);
      this.recordFrame(crossingTime, crossingState, this.track.length);
      const complete = !this.outLap && this.expectedGate >= this.gateCount
        && this.progress > this.track.length * .97 && crossingTime > 35;
      if (complete) {
        this.sectorTimes.push(crossingTime - this.sectorTimes.reduce((s, t) => s + t, 0));
        const result = {time: crossingTime, valid: this.valid, topSpeed: this.topSpeed, sectors: [...this.sectorTimes], frames: [...this.frames]};
        this.lastTime = crossingTime;
        this.lastSectors = result.sectors;
        this.history.unshift(result);
        this.history.length = Math.min(this.history.length, 8);
        if (this.recordEnabled && this.valid && (!this.best || crossingTime < this.best.time)) {
          this.best = {...result, version: TRACK_VERSION, saved: Date.now()};
          try {this.storage?.setItem(STORAGE_KEY, JSON.stringify(this.best));} catch { /* Driving remains available when browser storage is full. */ }
          this.lastEvent = {type: 'best', message: `PERSONAL BEST · ${formatTime(crossingTime)}`};
        } else this.lastEvent = {type: this.valid ? 'lap' : 'invalid', message: `${this.valid ? 'LAP COMPLETE' : 'INVALID LAP'} · ${formatTime(crossingTime)}`};
        this.finishedLap = result;
        this.lap++;
      } else this.lastEvent = {type: 'lap', message: 'FLYING LAP STARTED'};
      this.lapTime = dt * (1 - fraction);
      this.valid = true;
      this.outLap = false;
      this.frames = [];
      this.recordFrame(0, crossingState, 0);
      if (this.lapTime > EPSILON) this.recordSamples(0, this.lapTime, crossingState, current, distance);
      this.progress = distance;
      this.expectedGate = 1;
      this.sector = 0;
      this.sectorTimes = [];
      this.topSpeed = state.speed * 3.6;
      // A teleport that straddles the finish also skipped the beginning of the
      // next lap; crossing the seam must not make that shortened lap eligible.
      if (discontinuity) this.invalidate('POSITION RESET — LAP INVALID');
      if (state.offTrack && Math.abs(state.lateral) > this.track.width / 2 + 1.25) this.invalidate();
    } else this.recordSamples(startTime, dt, previous, current, movement);
    this.sampleTimer = this.lapTime % SAMPLE_PERIOD;
    this.previousDistance = distance;
    this.previousState = current;
    this.delta = this.best && !this.outLap ? this.lapTime - this.bestTimeAtDistance(state.distance) : null;
  }

  bestTimeAtDistance(distance) {
    if (!this.best?.frames.length) return 0;
    const frames = this.best.frames;
    // Like vehicle.state.distance, this public argument uses the geographic
    // origin. Saved frame distances use the control-line origin instead.
    const target = this.toLapDistance(distance);
    if (target <= 0) return 0;
    if (target >= this.track.length) return this.best.time;
    // Interpolate forward distance crossings to avoid a 100 ms staircase in the
    // live delta. Reverse sections are skipped; distance is not globally sorted.
    let closest = frames[0];
    let difference = Infinity;
    for (let i = 0; i < frames.length; i++) {
      const frame = frames[i], next = frames[i + 1];
      if (next && frame[4] <= target && next[4] >= target && next[4] > frame[4]) {
        return frame[0] + (next[0] - frame[0]) * (target - frame[4]) / (next[4] - frame[4]);
      }
      const delta = Math.abs(frame[4] - target);
      if (delta < difference) {difference = delta; closest = frame;}
    }
    return closest[0];
  }

  ghostAt(time) {
    const frames = this.best?.frames;
    if (!frames?.length || time > this.best.time || time < 0) return null;
    let low = 0, high = frames.length - 1;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (frames[middle][0] < time) low = middle + 1;
      else high = middle;
    }
    const b = frames[low], a = frames[Math.max(0, low - 1)];
    const fraction = Math.min(1, Math.max(0, (time - a[0]) / (b[0] - a[0] || 1)));
    const angle = Math.atan2(Math.sin(b[3] - a[3]), Math.cos(b[3] - a[3]));
    return {x:a[1] + (b[1]-a[1])*fraction, z:a[2]+(b[2]-a[2])*fraction, heading:a[3]+angle*fraction,
      speed:a[5]+(b[5]-a[5])*fraction, steering:0, rpm:10000, throttle:a[6], brake:a[7], gear:4};
  }

  clearBest() {
    this.best = null;
    try {this.storage?.removeItem(STORAGE_KEY);} catch { /* Storage is optional. */ }
  }
}
