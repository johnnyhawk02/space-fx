// Spring: a stereo spring tank after Valimaki, Parker and Abel, ported from Clip's src/fx.rs.
// Two springs of slightly different length, each a feedback loop through a stretched all-pass
// chain (the low chirps) and one through plain all-passes (the quieter wide-band chirps).

const M_LOW = 100;
const M_HIGH = 200;

const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
// Rust's round (halves away from zero).
const roundAway = (v) => Math.sign(v) * Math.round(Math.abs(v));

// m cascaded first-order all-passes, each unit delay stretched to k samples.
class Chain {
  constructor(m, k) {
    this.k = Math.max(k, 1);
    this.m = m;
    this.x = new Float32Array(m * this.k);
    this.y = new Float32Array(m * this.k);
    this.i = 0;
  }

  process(v, a) {
    const { x, y, k, m } = this;
    for (let s = 0; s < m; s++) {
      const j = s * k + this.i;
      const out = a * v + x[j] - a * y[j];
      x[j] = v;
      y[j] = out;
      v = out;
    }
    this.i = (this.i + 1) % k;
    return v;
  }
}

class Biquad {
  constructor(f, q, rate) {
    const w = 2 * Math.PI * Math.min(f, 0.45 * rate) / rate;
    const cw = Math.cos(w);
    const alpha = Math.sin(w) / (2 * q);
    const a0 = 1 + alpha;
    const b1 = (1 - cw) / a0;
    this.b0 = b1 / 2;
    this.b1 = b1;
    this.b2 = b1 / 2;
    this.a1 = -2 * cw / a0;
    this.a2 = (1 - alpha) / a0;
    this.x1 = this.x2 = this.y1 = this.y2 = 0;
  }

  process(x) {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1;
    this.x1 = x;
    this.y2 = this.y1;
    this.y1 = y;
    return y;
  }
}

class OneSpring {
  constructor(rate, tone) {
    const k = Math.max(roundAway(rate / (2 * Math.max(tone, 500))), 1);
    this.low = new Chain(M_LOW, k);
    this.high = new Chain(M_HIGH, 1);
    this.lp = [new Biquad(tone * 0.95, 0.541, rate), new Biquad(tone * 0.95, 1.307, rate)];
    const n = Math.trunc(rate * 0.25);
    this.fbLow = new Float32Array(n);
    this.fbHigh = new Float32Array(n);
    this.i = 0;
  }
}

export const SPRING_DEFAULTS = { length: 56, decay: 0.7, tone: 4300, chirp: 0.6, mix: 0.5 };

export class Spring {
  constructor(rate) {
    this.rate = rate;
    this.tone = SPRING_DEFAULTS.tone;
    this.springs = [new OneSpring(rate, this.tone), new OneSpring(rate, this.tone)];
    this.pendingTone = this.tone;
    this.pendingFor = 0;
  }

  process(L, R, n, p) {
    if (Math.abs(p.tone - this.tone) > 1) {
      // A new transition frequency needs new chain stretches and starts the tank afresh, as in
      // Clip. Unlike Clip, wait until Tone has stopped moving for 100 ms, so a Macro sweeping
      // it doesn't empty the tank on every block.
      if (p.tone !== this.pendingTone) {
        this.pendingTone = p.tone;
        this.pendingFor = 0;
      }
      this.pendingFor += n;
      if (this.pendingFor >= 0.1 * this.rate) {
        this.tone = p.tone;
        this.springs = [new OneSpring(this.rate, p.tone), new OneSpring(this.rate, p.tone)];
      }
    }
    const g = 0.5 + 0.47 * clamp(p.decay, 0, 1);
    const aLow = 0.3 + 0.55 * clamp(p.chirp, 0, 1);
    const aHigh = -aLow;
    const mix = clamp(p.mix, 0, 1);
    const len = clamp(p.length, 10, 200) * 0.001 * this.rate;
    const size = this.springs[0].fbLow.length;
    const delays = [clamp(Math.trunc(len), 1, size - 1), clamp(Math.trunc(len * 1.13), 1, size - 1)];
    const wet = [0, 0];
    for (let f = 0; f < n; f++) {
      const x = 0.5 * (L[f] + R[f]);
      for (let c = 0; c < 2; c++) {
        const sp = this.springs[c];
        const d = delays[c];
        const back = (sp.i + size - d) % size;
        const lo = sp.low.process(x - g * sp.fbLow[back], aLow);
        const hi = sp.high.process(x - g * 0.9 * sp.fbHigh[back], aHigh);
        sp.fbLow[sp.i] = lo;
        sp.fbHigh[sp.i] = hi;
        sp.i = (sp.i + 1) % size;
        const loOut = sp.lp[1].process(sp.lp[0].process(lo));
        wet[c] = 1.2 * loOut + 0.06 * hi;
      }
      L[f] = L[f] * (1 - mix) + wet[0] * mix;
      R[f] = R[f] * (1 - mix) + wet[1] * mix;
    }
  }
}
