// Phaser: the MXR Phase 90 after Giampiccolo et al. (DAFx24), ported from Clip's src/phaser.rs.
// Four JFET-controlled first-order all-passes, a 65% rising triangle LFO, and the pedal's
// input and output high-passes. The shifted signal is summed with the dry one, so notches sweep.

const VP = -2.021;
const IS0 = 5.367e-3;
const LAMBDA = 4e-3;
const R5 = 24e3;
const C2 = 47e-9;
const LFO_CENTRE = 3.25 - 5.1;
const LFO_DEPTH = 0.15;
const LFO_DUTY = 0.65;
const STAGES = 4;

const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

function rJfet(vgs, v2) {
  v2 = Math.abs(v2);
  const over = vgs - VP;
  if (over < 0) return Infinity;
  if (over >= v2) return VP * VP / Math.max(2 * IS0 * (over - v2 / 2), 1e-12);
  return v2 / Math.max(IS0 * (1 - vgs / VP) ** 2 * (1 + LAMBDA * v2), 1e-12);
}

export const PHASER_DEFAULTS = { sync: 0, speed: 0.5, rate_beats: 8, mix: 0.5 };

export class Phaser {
  constructor(rate) {
    this.rate = rate;
    this.lfo = 0;
    this.sides = [0, 1].map(() => ({
      ap: new Float64Array(STAGES),
      v2: new Float64Array(STAGES),
      hpIn: [0, 0],
      hpOut: [0, 0],
    }));
  }

  // `beat` is a beat's length in frames, for Sync.
  process(L, R, n, p, beat = this.rate / 2) {
    const ts = 1 / this.rate;
    const hp = (fc) => Math.exp(-2 * Math.PI * fc * ts);
    const aIn = hp(1 / (2 * Math.PI * (10e3 + 470e3) * 0.01e-6));
    const aOut = hp(22);
    const hz = p.sync ? this.rate / beat / Math.max(p.rate_beats ?? 8, 0.0625) : p.speed;
    const step = clamp(hz, 0.01, 12) * ts;
    const mix = clamp(p.mix, 0, 1);
    const io = [L, R];
    for (let f = 0; f < n; f++) {
      this.lfo = (this.lfo + step) % 1;
      const tri = this.lfo < LFO_DUTY ? this.lfo / LFO_DUTY : 1 - (this.lfo - LFO_DUTY) / (1 - LFO_DUTY);
      const vgs = LFO_CENTRE + LFO_DEPTH * (2 * tri - 1);
      for (let c = 0; c < 2; c++) {
        const side = this.sides[c];
        const x = io[c][f];
        const v1 = aIn * (side.hpIn[1] + x - side.hpIn[0]);
        side.hpIn[0] = x;
        side.hpIn[1] = v1;
        let y = v1;
        for (let k = 0; k < STAGES; k++) {
          const rj = rJfet(vgs, side.v2[k]);
          const r = Number.isFinite(rj) ? R5 * rj / (R5 + rj) : R5;
          const wb = 1 / (r * C2);
          const t = Math.tan(wb * ts / 2);
          const c1 = -(1 - t) / (1 + t);
          const out = c1 * y + side.ap[k];
          side.ap[k] = y - c1 * out;
          side.v2[k] = 0.5 * (y - out);
          y = out;
        }
        const sum = 0.5 * (v1 + y);
        const o = aOut * (side.hpOut[1] + sum - side.hpOut[0]);
        side.hpOut[0] = sum;
        side.hpOut[1] = o;
        io[c][f] = x * (1 - mix) + o * mix;
      }
    }
  }
}
