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

// Center 1663 Hz and Depth 60% are the pedal as built; Spread and Feedback 0 leave it mono and
// without the resonance mod.
export const PHASER_DEFAULTS = { sync: 0, speed: 0.5, rate_beats: 8, center: 1663, depth: 0.6, spread: 0, feedback: 0, mix: 0.5 };

// Center (Hz, roughly where the notches sit mid-sweep) to the JFETs' gate voltage, from a
// straight-line fit of the all-pass corner against Vgs over the pedal's range.
const vgsFor = (hz) => LFO_CENTRE + (hz - 1663) / 8900;

export class Phaser {
  constructor(rate) {
    this.rate = rate;
    this.lfo = 0;
    this.sides = [0, 1].map(() => ({
      ap: new Float64Array(STAGES),
      v2: new Float64Array(STAGES),
      hpIn: [0, 0],
      hpOut: [0, 0],
      fb: 0,
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
    const centre = vgsFor(clamp(p.center ?? 1663, 200, 4500));
    const swing = LFO_DEPTH / 0.6 * clamp(p.depth ?? 0.6, 0, 1);
    const offset = clamp(p.spread ?? 0, 0, 180) / 360;
    const fb = clamp(p.feedback ?? 0, 0, 0.9);
    const io = [L, R];
    const tri = (ph) => (ph < LFO_DUTY ? ph / LFO_DUTY : 1 - (ph - LFO_DUTY) / (1 - LFO_DUTY));
    for (let f = 0; f < n; f++) {
      this.lfo = (this.lfo + step) % 1;
      for (let c = 0; c < 2; c++) {
        // Spread: the right side's sweep runs behind the left's by up to half a cycle.
        const vgs = centre + swing * (2 * tri((this.lfo + c * offset) % 1) - 1);
        const side = this.sides[c];
        const x = io[c][f];
        const v1 = aIn * (side.hpIn[1] + x - side.hpIn[0]);
        side.hpIn[0] = x;
        side.hpIn[1] = v1;
        // Feedback: the chain's last output back into its input, like the resonance mod.
        let y = v1 + fb * side.fb;
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
        side.fb = Math.tanh(y);
        const sum = 0.5 * (v1 + y);
        const o = aOut * (side.hpOut[1] + sum - side.hpOut[0]);
        side.hpOut[0] = sum;
        side.hpOut[1] = o;
        io[c][f] = x * (1 - mix) + o * mix;
      }
    }
  }
}
