// Wow and flutter, and the delay-time LFO, after Clip's tape.rs.

export const LFO_SHAPES = ['Sine', 'Triangle', 'Square', 'Saw', 'Random', 'Smooth Random', 'Drunk', 'Saw Down'];

const TAU = Math.PI * 2;

export class Wobble {
  constructor() {
    this.wowPh = 0;
    this.flutPh = 0;
    this.drift = 0;
    this.driftTo = 0;
  }

  // One sample: the delay-time swing in seconds at full wow. `rand` gives -1..1.
  // The phases are kept in 32-bit floats, as in Clip, so the wobble follows the same path.
  next(newDrift, rand, speedK, sr) {
    const f = Math.fround;
    this.wowPh = f(f(this.wowPh + f(f(f(0.55) * speedK) / sr)) % 1);
    this.flutPh = f(f(this.flutPh + f(f(f(7.3) * speedK) / sr)) % 1);
    if (newDrift) this.driftTo = rand();
    this.drift += (this.driftTo - this.drift) * 2 / sr;
    return 0.0016 * Math.sin(TAU * this.wowPh) + 0.00012 * Math.sin(TAU * this.flutPh) + 0.0008 * this.drift;
  }
}

export class Lfo {
  constructor() {
    this.phase = 0;
    this.cycle = 0;
    this.held = 0;
    this.from = 0;
    this.walk = 0;
    this.out = 0;
  }

  // Advance one sample at `rate` Hz; the shape's value -1..1 after a slew of `slew` (0..1).
  next(shape, rate, slew, sr, rand) {
    this.phase += rate / sr;
    const phase = this.phase;
    const cycle = Math.floor(phase);
    if (cycle !== this.cycle) {
      this.cycle = cycle;
      this.from = this.held;
      this.held = rand();
      const step = rand() * 0.4;
      this.walk = Math.abs(this.walk + step) > 1 ? this.walk - step : this.walk + step;
    }
    const p = phase - cycle;
    let v;
    switch (shape) {
      case 1: v = 1 - 4 * Math.abs(p - 0.5); break;
      case 2: v = p < 0.5 ? 1 : -1; break;
      case 3: v = 2 * p - 1; break;
      case 4: v = this.held; break;
      case 5: v = this.from + (this.held - this.from) * (0.5 - 0.5 * Math.cos(Math.PI * p)); break;
      case 6: v = this.walk; break;
      case 7: v = 1 - 2 * p; break;
      default: v = Math.sin(TAU * p);
    }
    const s = Math.min(Math.max(slew, 0), 1);
    let secs = Math.max(2 * s * s, 0.002);
    if (shape === 6) secs = Math.max(secs, 0.5 / Math.max(rate, 1e-3) * 0.2);
    this.out += (v - this.out) * (1 - Math.exp(-1 / (secs * sr)));
    return this.out;
  }
}
