const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const deadzone = (value, threshold = 0.09) => Math.abs(value) <= threshold ? 0
  : Math.sign(value) * (Math.abs(value) - threshold) / (1 - threshold);
const smooth = (current, target, rate, dt) => current + (target - current) * (1 - Math.exp(-rate * dt));
const DRIVING_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'Space', 'ShiftLeft', 'ShiftRight', 'KeyE', 'KeyZ', 'KeyX']);

/** Keyboard, standard gamepad and externally bound touch controls. */
export class InputController {
  constructor(element = typeof window !== 'undefined' ? window : null) {
    this.element = element;
    this.enabled = true;
    this.gamepadConnected = false;
    this.gamepadName = '';
    this.touch = { throttle: 0, brake: 0, steer: 0, boost: false, drs: false, gearUp: false, gearDown: false };
    this.keys = new Set();
    this._steer = 0;
    this._throttle = 0;
    this._brake = 0;
    this._upPressed = false;
    this._downPressed = false;
    this._lastPadUp = false;
    this._lastPadDown = false;
    this._lastTouchUp = false;
    this._lastTouchDown = false;
    this._listeners = [];
    this._listen(element, 'keydown', (event) => this._keyDown(event));
    this._listen(element, 'keyup', (event) => this._keyUp(event));
    this._listen(typeof window !== 'undefined' ? window : element, 'blur', () => this.clear());
    this._listen(typeof document !== 'undefined' ? document : null, 'visibilitychange', () => {
      if (document.hidden) this.clear();
    });
    this._listen(typeof window !== 'undefined' ? window : element, 'gamepaddisconnected', () => {
      this.gamepadConnected = false;
      this._lastPadUp = this._lastPadDown = false;
    });
  }

  _listen(target, name, fn) {
    if (!target?.addEventListener) return;
    target.addEventListener(name, fn);
    this._listeners.push([target, name, fn]);
  }

  _keyDown(event) {
    if (!this.enabled || event.target?.matches?.('input, textarea, select, [contenteditable="true"]')) return;
    if (!DRIVING_KEYS.has(event.code)) return;
    event.preventDefault();
    if (!event.repeat && !this.keys.has(event.code)) {
      if (event.code === 'KeyX') this._upPressed = true;
      if (event.code === 'KeyZ') this._downPressed = true;
    }
    this.keys.add(event.code);
  }

  _keyUp(event) {
    this.keys.delete(event.code);
    if (this.enabled && DRIVING_KEYS.has(event.code)) event.preventDefault();
  }

  setEnabled(enabled) {
    this.enabled = Boolean(enabled);
    if (!this.enabled) this.clear();
  }

  clear() {
    this.keys.clear();
    this._steer = this._throttle = this._brake = 0;
    this._upPressed = this._downPressed = false;
    this._lastPadUp = this._lastPadDown = false;
    this._lastTouchUp = this._lastTouchDown = false;
    Object.assign(this.touch, { throttle: 0, brake: 0, steer: 0, boost: false, drs: false, gearUp: false, gearDown: false });
  }

  sample(dt = 1 / 60) {
    const result = { throttle: 0, brake: 0, steer: 0, boost: false, drs: false, gearUp: false, gearDown: false };
    if (!this.enabled) return result;
    const delta = clamp(Number.isFinite(dt) ? dt : 1 / 60, 0, 0.1);
    const held = (...codes) => codes.some(code => this.keys.has(code));
    const keyboardSteer = Number(held('KeyD', 'ArrowRight')) - Number(held('KeyA', 'ArrowLeft'));
    const touchSteer = clamp(Number(this.touch.steer) || 0, -1, 1);
    let targetSteer = Math.abs(touchSteer) > Math.abs(keyboardSteer) ? touchSteer : keyboardSteer;
    let throttle = Math.max(Number(held('KeyW', 'ArrowUp')), Number(this.touch.throttle) || 0);
    let brake = Math.max(Number(held('KeyS', 'ArrowDown', 'Space')), Number(this.touch.brake) || 0);
    result.boost = held('ShiftLeft', 'ShiftRight') || Boolean(this.touch.boost);
    result.drs = held('KeyE') || Boolean(this.touch.drs);
    result.gearUp = this._upPressed || (this.touch.gearUp && !this._lastTouchUp);
    result.gearDown = this._downPressed || (this.touch.gearDown && !this._lastTouchDown);
    this._lastTouchUp = Boolean(this.touch.gearUp);
    this._lastTouchDown = Boolean(this.touch.gearDown);
    this._upPressed = this._downPressed = false;

    const gamepads = typeof navigator !== 'undefined' && typeof navigator.getGamepads === 'function'
      ? navigator.getGamepads() : [];
    let pad = null;
    for (const candidate of gamepads) if (candidate?.connected) { pad = candidate; break; }
    this.gamepadConnected = Boolean(pad);
    this.gamepadName = pad?.id || '';
    let analog = false;
    if (pad) {
      const value = index => pad.buttons[index]?.value || 0;
      const pressed = index => Boolean(pad.buttons[index]?.pressed);
      const axis = deadzone(clamp(pad.axes[0] || 0, -1, 1));
      // A mild expo gives fine placement around the stick center.
      const padSteer = Math.sign(axis) * Math.pow(Math.abs(axis), 1.35);
      if (Math.abs(padSteer) > Math.abs(targetSteer)) { targetSteer = padSteer; analog = true; }
      throttle = Math.max(throttle, value(7));
      brake = Math.max(brake, value(6));
      result.boost ||= pressed(0);
      result.drs ||= pressed(3);
      const up = pressed(5), down = pressed(4);
      result.gearUp ||= up && !this._lastPadUp;
      result.gearDown ||= down && !this._lastPadDown;
      this._lastPadUp = up;
      this._lastPadDown = down;
    }
    const steeringRate = analog ? 20 : targetSteer === 0 ? 8.5 : Math.sign(targetSteer) !== Math.sign(this._steer) ? 10.5 : 5.8;
    this._steer = smooth(this._steer, targetSteer, steeringRate, delta);
    this._throttle = smooth(this._throttle, clamp(throttle, 0, 1), 15, delta);
    this._brake = smooth(this._brake, clamp(brake, 0, 1), 22, delta);
    result.steer = Math.abs(this._steer) < 0.0001 ? 0 : this._steer;
    result.throttle = Math.abs(this._throttle) < 0.0001 ? 0 : this._throttle;
    result.brake = Math.abs(this._brake) < 0.0001 ? 0 : this._brake;
    return result;
  }

  dispose() {
    for (const [target, name, fn] of this._listeners) target.removeEventListener(name, fn);
    this._listeners.length = 0;
    this.clear();
  }
}
