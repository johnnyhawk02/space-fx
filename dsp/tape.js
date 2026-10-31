// Tape: Chowdhury's physical model of an analog tape machine (DAFx-19), ported from Clip's
// src/tape.rs. Jiles-Atherton hysteresis by RK4 at 2x, wow and flutter, the play head's loss
// filter as an FIR, a 60 Hz high-pass and an LFO on the tape's travel. The echo now lives in
// its own Delay module: here the play head sits just a few ms after the record head, and the
// dry signal is held back by the same amount, so Dry/Wet blends without combing.

import { lcg, lcgValue } from './rng.js';
import { Wobble, Lfo } from './lfo.js';

const A = 0.25;
const K = A * 27 / 22;
const MS = A * 3.5e5 / 22e3;
const C = 0.17;
const ALPHA = 1.6e-3;
const OVER = 2;
const GAP = 5e-6;
const THICK = 10e-6;
const FIR_LEN = 33;

const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

function cFor(bias) {
  return C + (0.9 - C) * clamp(bias, 0, 1);
}

function dmdt(m, h, hd, c) {
  const x = (h + ALPHA * m) / A;
  let l, dl;
  if (Math.abs(x) < 1e-4) {
    l = x / 3;
    dl = 1 / 3;
  } else {
    const coth = 1 / Math.tanh(x);
    l = coth - 1 / x;
    dl = 1 / (x * x) - coth * coth + 1;
  }
  const man = MS * l;
  const ds = hd >= 0 ? 1 : -1;
  const dm = ds * (man - m) > 0 ? 1 : 0;
  let den = (1 - c) * ds * K - ALPHA * (man - m);
  if (Math.abs(den) < 1e-9) den = den < 0 || Object.is(den, -0) ? -1e-9 : 1e-9;
  const irr = (1 - c) * dm * (man - m) / den * hd;
  const rev = c * MS / A * hd * dl;
  return (irr + rev) / (1 - c * ALPHA * MS / A * dl);
}

// One side's tape magnetisation.
class Hysteresis {
  constructor() {
    this.m = 0;
    this.h = 0;
    this.hd = 0;
  }

  step(h, t, c) {
    const hd = 2 * (h - this.h) / t - 0.98 * this.hd;
    const hm = 0.5 * (h + this.h);
    const hdm = 0.5 * (hd + this.hd);
    const k1 = t * dmdt(this.m, this.h, this.hd, c);
    const k2 = t * dmdt(this.m + k1 / 2, hm, hdm, c);
    const k3 = t * dmdt(this.m + k2 / 2, hm, hdm, c);
    const k4 = t * dmdt(this.m + k3, h, hd, c);
    const m = this.m + k1 / 6 + k2 / 3 + k3 / 3 + k4 / 6;
    if (Number.isFinite(m)) {
      this.m = clamp(m, -MS, MS);
      this.h = h;
      this.hd = hd;
    } else {
      this.m = this.h = this.hd = 0;
    }
    return this.m;
  }
}

// The play head's losses for tape speed `ips` and spacing (microns), as a linear-phase FIR.
export function lossFir(rate, ips, spacingUm) {
  const v = ips * 0.0254;
  const d = spacingUm * 1e-6;
  const n = 256;
  const gain = (f) => {
    const k = 2 * Math.PI * f / v;
    if (k === 0) return 1;
    const space = Math.exp(-k * d);
    const thick = (1 - Math.exp(-k * THICK)) / (k * THICK);
    const x = k * GAP / 2;
    return space * thick * (Math.sin(x) / x);
  };
  const mags = [];
  for (let b = 0; b <= n / 2; b++) mags.push(gain(b * rate / n));
  const h = new Float32Array(FIR_LEN);
  const mid = Math.floor(FIR_LEN / 2);
  for (let i = 0; i < FIR_LEN; i++) {
    const t = i - mid;
    let s = mags[0];
    for (let b = 1; b < mags.length; b++) {
      const w = b === n / 2 ? 1 : 2;
      s += w * mags[b] * Math.cos(2 * Math.PI * b * t / n);
    }
    const hann = 0.5 - 0.5 * Math.cos(2 * Math.PI * (i + 1) / (FIR_LEN + 1));
    h[i] = s / n * hann;
  }
  let sum = 0;
  for (let i = 0; i < FIR_LEN; i++) sum += h[i];
  sum = Math.max(sum, 1e-6);
  for (let i = 0; i < FIR_LEN; i++) h[i] /= sum;
  return h;
}

export const TAPE_DEFAULTS = {
  drive: 0.5, bias: 0.9, wow: 0.3, speed: 15, spacing: 5, mix: 0.5,
  lfo_shape: 0, lfo_rate: 0.5, lfo_slow: 0, lfo_depth: 0, lfo_slew: 0,
};

export class Tape {
  constructor(rate) {
    this.rate = rate;
    this.c = cFor(TAPE_DEFAULTS.bias);
    this.tape = [new Hysteresis(), new Hysteresis()];
    this.prevIn = [0, 0];
    this.len = Math.round(rate * 0.25);
    this.buf = [new Float32Array(this.len), new Float32Array(this.len)];
    this.dry = [new Float32Array(this.len), new Float32Array(this.len)];
    this.i = 0;
    this.fir = lossFir(rate, TAPE_DEFAULTS.speed, TAPE_DEFAULTS.spacing);
    this.firFor = [TAPE_DEFAULTS.speed, TAPE_DEFAULTS.spacing];
    this.hist = [new Float32Array(FIR_LEN), new Float32Array(FIR_LEN)];
    this.hi = 0;
    this.hp = [0, 0];
    this.hpX = [0, 0];
    this.wobble = new Wobble();
    this.seed = 0x9e3779b9;
    this.lfo = new Lfo();
    this.rand = () => {
      this.seed = lcg(this.seed);
      return lcgValue(this.seed);
    };
  }

  // Record `x` (side `c`) onto the tape: oversampled hysteresis, back to signal level.
  record(c, x, drive) {
    const g = A * (0.6 + 3.4 * drive * drive);
    const t = 1 / (this.rate * OVER);
    let acc = 0;
    const prev = this.prevIn[c];
    for (let j = 1; j <= OVER; j++) {
      const xi = prev + (x - prev) * j / OVER;
      acc += this.tape[c].step(xi * g, t, this.c);
    }
    this.prevIn[c] = x;
    const norm = this.c + 0.095 * (1 - this.c);
    return acc / OVER / (MS / (3 * A) * norm) / g;
  }

  // Process `n` frames of L and R in place.
  process(L, R, n, p) {
    if (p.speed !== this.firFor[0] || p.spacing !== this.firFor[1]) {
      this.fir = lossFir(this.rate, p.speed, p.spacing);
      this.firFor = [p.speed, p.spacing];
    }
    this.c = cFor(p.bias);
    const len = this.len;
    const mix = clamp(p.mix, 0, 1);
    const wow = clamp(p.wow, 0, 1);
    const aHp = Math.exp(-2 * Math.PI * 60 / this.rate);
    const speedK = Math.fround(Math.sqrt(Math.fround(clamp(Math.fround(p.speed / 7.5), 0.3, 4))));
    const lfoRate = clamp(p.lfo_rate, 0.01, 20) * (p.lfo_slow ? 0.01 : 1);
    const depth = clamp(p.lfo_depth, 0, 50) * 0.001 * this.rate;
    // Head gap: room for the widest wow and LFO swing, plus 2 ms. The dry side waits as long.
    const base = Math.ceil(0.002 * this.rate + 0.0026 * wow * this.rate + depth);
    const dryDelay = base + Math.floor(FIR_LEN / 2);
    const fir = this.fir;
    const echo = [0, 0];
    const io = [L, R];
    for (let f = 0; f < n; f++) {
      const wobble = wow * this.rate * this.wobble.next(this.i % 2048 === 0, this.rand, speedK, this.rate);
      const lfo = this.lfo.next(p.lfo_shape | 0, lfoRate, p.lfo_slew, this.rate, this.rand);
      const d = clamp(base + wobble + lfo * depth, 2, len - 4);
      const pos = this.i + len - d;
      const k = Math.floor(pos);
      const fr = pos - k;
      for (let c = 0; c < 2; c++) {
        const b = this.buf[c];
        const y0 = b[(k + len - 1) % len];
        const y1 = b[(k + len) % len];
        const y2 = b[(k + len + 1) % len];
        const y3 = b[(k + len + 2) % len];
        const raw = y1 + 0.5 * fr * (y2 - y0 + fr * (2 * y0 - 5 * y1 + 4 * y2 - y3 + fr * (3 * (y1 - y2) + y3 - y0)));
        const hist = this.hist[c];
        hist[this.hi] = raw;
        let y = 0;
        for (let t = 0; t < FIR_LEN; t++) y += fir[t] * hist[(this.hi + FIR_LEN - t) % FIR_LEN];
        const hp = aHp * (this.hp[c] + y - this.hpX[c]);
        this.hpX[c] = y;
        this.hp[c] = hp;
        echo[c] = hp;
      }
      this.hi = (this.hi + 1) % FIR_LEN;
      for (let c = 0; c < 2; c++) {
        const x = io[c][f];
        this.dry[c][this.i] = x;
        this.buf[c][this.i] = this.record(c, x, p.drive);
        io[c][f] = this.dry[c][(this.i + len - dryDelay) % len] * (1 - mix) + echo[c] * mix;
      }
      this.i = (this.i + 1) % len;
    }
  }
}
