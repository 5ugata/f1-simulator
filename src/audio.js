// Procedural V6-inspired soundscape. No downloads or microphone permissions.
// The AudioContext is created only by start(), which must follow a user gesture.
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const scalar = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;

export class EngineAudio {
  constructor({ volume = .62 } = {}) {
    this.context = null;
    this.volume = clamp(volume, 0, 1);
    this.nodes = [];
    this.sources = [];
    this.started = false;
    this.disposed = false;
    this.lastGear = null;
    this.shiftUntil = 0;
    this.lastState = {};
    this.time = 0;
  }

  async start() {
    if (this.disposed) return false;
    if (this.context) {
      await this.context.resume(); this.started = true; return true;
    }
    const AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AudioContextClass) return false;
    const ctx = this.context = new AudioContextClass({ latencyHint: 'interactive' });
    const node = n => { this.nodes.push(n); return n; };
    const gain = value => { const n = node(ctx.createGain()); n.gain.value = value; return n; };
    const filter = (type, frequency, q = .7) => {
      const n = node(ctx.createBiquadFilter()); n.type = type; n.frequency.value = frequency; n.Q.value = q; return n;
    };
    const oscillator = (type, frequency, destination) => {
      const n = node(ctx.createOscillator()); n.type = type; n.frequency.value = frequency; n.connect(destination); n.start(); this.sources.push(n); return n;
    };
    this.master = gain(0);
    const limiter = node(ctx.createDynamicsCompressor());
    limiter.threshold.value = -14; limiter.knee.value = 12; limiter.ratio.value = 5;
    limiter.attack.value = .003; limiter.release.value = .12;
    this.bus = gain(.64);
    this.bus.connect(limiter); limiter.connect(this.master); this.master.connect(ctx.destination);

    // A four-stroke V6 has three combustion events per crank revolution.
    // Its firing order and crank fundamental are rendered as separate layers.
    const real = new Float32Array(40), imag = new Float32Array(40);
    for (let harmonic = 1; harmonic < 40; harmonic++) {
      const rolloff = 1 / Math.pow(harmonic, .96);
      imag[harmonic] = rolloff * (harmonic % 3 === 0 ? .61 : 1);
      real[harmonic] = rolloff * .19 * Math.sin(harmonic * 1.36);
    }
    const combustionWave = ctx.createPeriodicWave(real, imag);
    this.engineGain = gain(.15);
    this.engineFilter = filter('lowpass', 2400, .55);
    const exhaustBody = filter('peaking', 650, .62); exhaustBody.gain.value = 3.5;
    this.engineGain.connect(this.engineFilter); this.engineFilter.connect(exhaustBody); exhaustBody.connect(this.bus);
    this.fire = oscillator('sawtooth', 225, this.engineGain); this.fire.setPeriodicWave(combustionWave);
    this.secondaryGain = gain(.045); this.secondaryGain.connect(this.engineFilter);
    this.fireSecond = oscillator('sawtooth', 226, this.secondaryGain); this.fireSecond.setPeriodicWave(combustionWave);
    this.crankGain = gain(.05); this.crankGain.connect(this.bus);
    this.crank = oscillator('triangle', 75, this.crankGain);
    this.transmissionGain = gain(0); this.transmissionGain.connect(this.bus);
    this.transmission = oscillator('sine', 290, this.transmissionGain);

    // Small cycle-to-cycle fluctuations keep the engine from sounding like a note.
    const flutter = oscillator('sine', 38, gain(0));
    const flutterDepth = gain(1.7); flutter.connect(flutterDepth);
    flutterDepth.connect(this.fire.frequency); flutterDepth.connect(this.fireSecond.frequency);
    this.flutter = flutter;

    // One deterministic stereo noise buffer feeds independently filtered layers.
    // Stereo channels have independent signals, giving wind a diffuse image.
    const buffer = ctx.createBuffer(2, Math.floor(ctx.sampleRate * 3.17), ctx.sampleRate);
    let random = 0x723af35;
    for (let ch = 0; ch < 2; ch++) {
      const data = buffer.getChannelData(ch);
      let brown = 0;
      for (let i = 0; i < data.length; i++) {
        random = (Math.imul(random, 1664525) + 1013904223) | 0;
        const white = (random >>> 0) / 2147483648 - 1;
        brown = (brown + .024 * white) / 1.025;
        data[i] = white * .78 + brown * 1.65;
      }
    }
    const noiseLayer = (type, frequency, q = .7, amount = 0, offset = 0) => {
      const source = node(ctx.createBufferSource()); source.buffer = buffer; source.loop = true;
      const shape = filter(type, frequency, q), level = gain(amount);
      source.connect(shape); shape.connect(level); level.connect(this.bus);
      source.start(0, offset); this.sources.push(source);
      return { source, filter: shape, gain: level };
    };
    this.exhaust = noiseLayer('bandpass', 1100, .55, .012, .12);
    this.intake = noiseLayer('bandpass', 2150, .55, 0, .9);
    this.wind = noiseLayer('lowpass', 1800, .5, 0, .33);
    this.road = noiseLayer('lowpass', 490, .7, 0, 1.3);
    this.tyres = noiseLayer('bandpass', 1240, 1.1, 0, 1.83);
    this.gravel = noiseLayer('bandpass', 720, .6, 0, 2.3);
    this.brakes = noiseLayer('bandpass', 2850, 1.6, 0, 2.8);
    this.turboGain = gain(0); this.turboGain.connect(this.bus);
    this.turbo = oscillator('sine', 2100, this.turboGain);
    this.kerbGain = gain(0); this.kerbGain.connect(this.bus);
    this.kerb = oscillator('triangle', 70, this.kerbGain);
    this.tyreToneGain = gain(0); this.tyreToneGain.connect(this.bus);
    this.tyreTone = oscillator('sine', 520, this.tyreToneGain);
    this.shiftGain = gain(0); this.shiftGain.connect(this.bus);
    this.shiftThud = oscillator('sine', 86, this.shiftGain);
    await ctx.resume();
    this.started = true;
    this.master.gain.setTargetAtTime(this.volume * .66, ctx.currentTime, .12);
    this.update(this.lastState, 0);
    return true;
  }

  update(state = {}, dt = 1 / 60) {
    this.lastState = state;
    this.time += clamp(scalar(dt, 0), 0, .1);
    const ctx = this.context;
    if (!ctx || ctx.state !== 'running' || this.disposed) return;
    const now = ctx.currentTime;
    const target = (parameter, value, lag = .045) => {
      if (Number.isFinite(value)) parameter.setTargetAtTime(value, now, lag);
    };
    const speed = Math.abs(scalar(state.speed ?? state.velocity?.length?.()));
    const throttle = clamp(scalar(state.throttle ?? state.inputs?.throttle), 0, 1);
    const brake = clamp(scalar(state.brake ?? state.inputs?.brake), 0, 1);
    const rpm = clamp(scalar(state.rpm, 4300 + speed * 82), 2200, 16000);
    const gear = scalar(state.gear, 0);
    const speedRatio = clamp(speed / 95, 0, 1.25);
    const rpmRatio = clamp((rpm - 3000) / 10000, 0, 1);
    const onKerb = !!(state.onKerb || state.onCurb || state.kerb || state.surface === 'kerb');
    // Crossing a white line can leave the tyres on a paved apron. Use the
    // contacted material for loose-surface sound; the lap-limit flag is separate.
    const offTrack = state.surface ? state.surface === 'grass' || state.surface === 'gravel'
      : !!(state.offTrack || state.offRoad);
    // Physics may provide normalized tyreSlip; slipAngle values are radians.
    const tireSlip = clamp(Math.abs(scalar(state.tyreSlip ?? state.tireSlip ?? state.slip ?? state.slipAngle)) - .06, 0, 1);
    const scrub = Math.pow(tireSlip, .72) * clamp(speed / 15, 0, 1);
    if (this.lastGear !== null && gear !== this.lastGear && speed > 3) {
      this.shiftUntil = now + (gear > this.lastGear ? .085 : .055);
      this.shiftGain.gain.cancelScheduledValues(now);
      this.shiftGain.gain.setValueAtTime(.06, now);
      this.shiftGain.gain.exponentialRampToValueAtTime(.0001, now + .085);
      this.shiftThud.frequency.setValueAtTime(gear > this.lastGear ? 105 : 170, now);
      this.shiftThud.frequency.exponentialRampToValueAtTime(55, now + .09);
    }
    this.lastGear = gear;
    const cut = now < this.shiftUntil ? .28 : 1;
    const load = .26 + throttle * .74;
    // Mild firing irregularity is tied to the crank, never a large random pitch wobble.
    const firing = rpm / 20;
    target(this.fire.frequency, firing, .020);
    target(this.fireSecond.frequency, firing * 1.0022, .023);
    target(this.crank.frequency, rpm / 60, .026);
    target(this.flutter.frequency, 27 + rpm / 205, .06);
    target(this.engineGain.gain, (.087 + load * .075 + rpmRatio * .016) * cut, .018);
    target(this.secondaryGain.gain, (.018 + throttle * .023) * cut, .020);
    target(this.crankGain.gain, (.021 + throttle * .024) * cut);
    target(this.engineFilter.frequency, 1500 + rpmRatio * 2700 + throttle * 1900);
    target(this.exhaust.gain.gain, (.012 + throttle * .018 + rpmRatio * .009) * cut);
    target(this.exhaust.filter.frequency, 700 + rpmRatio * 1050);
    target(this.intake.gain.gain, throttle * (.014 + rpmRatio * .035));
    target(this.intake.filter.frequency, 1650 + rpmRatio * 1950);
    target(this.turbo.frequency, 1700 + rpm * .235, .08);
    target(this.turboGain.gain, throttle * throttle * (.0015 + rpmRatio * .0037), .09);
    target(this.transmission.frequency, 190 + speed * (gear ? 9.2 / Math.sqrt(Math.abs(gear)) : 7));
    target(this.transmissionGain.gain, speedRatio * .008 * (.42 + (1 - throttle) * .58));
    target(this.wind.gain.gain, speedRatio ** 2 * (state.cameraMode === 'cockpit' ? .16 : .11), .18);
    target(this.wind.filter.frequency, 900 + speedRatio * 2350, .15);
    target(this.road.gain.gain, speedRatio * (.024 + (onKerb ? .06 : 0)));
    target(this.road.filter.frequency, onKerb ? 800 : 390 + speedRatio * 300);
    target(this.tyres.gain.gain, scrub * .19, .055);
    target(this.tyres.filter.frequency, 1050 + scrub * 730 + speedRatio * 270);
    target(this.tyreTone.frequency, 530 + scrub * 410 + Math.sin(this.time * 26) * scrub * 40);
    target(this.tyreToneGain.gain, Math.max(0, scrub - .27) * .022, .06);
    target(this.gravel.gain.gain, offTrack ? Math.min(speedRatio * .25, .20) : 0, .028);
    target(this.kerb.frequency, Math.max(20, speed / .37));
    target(this.kerbGain.gain, onKerb ? .045 * clamp(speed / 20, 0, 1) : 0, .018);
    target(this.brakes.gain.gain, brake * clamp(speed / 22, 0, 1) * .0065);
    target(this.master.gain, this.volume * .66, .07);
  }

  setVolume(volume) {
    this.volume = clamp(scalar(volume), 0, 1);
    if (this.context && this.master) this.master.gain.setTargetAtTime(this.volume * .66, this.context.currentTime, .05);
  }

  async suspend() {
    if (this.context && this.context.state === 'running') await this.context.suspend();
  }

  async resume() {
    if (this.context && !this.disposed) await this.context.resume();
    else if (!this.disposed) return this.start();
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true; this.started = false;
    this.sources.forEach(n => { try { n.stop(); } catch { /* already stopped */ } });
    this.nodes.forEach(n => { try { n.disconnect(); } catch { /* already disconnected */ } });
    if (this.context && this.context.state !== 'closed') this.context.close();
    this.nodes.length = 0; this.sources.length = 0;
  }
}
