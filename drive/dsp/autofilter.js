// Filter: a resonant state-variable filter, low-, band- or high-pass, whose Cutoff moves with the
// Sequencer (Seq) and the input's level (Env). The filter is Zavalishin's topology-preserving
// (zero-delay feedback) SVF from "The Art of VA Filter Design": trapezoidal integrators solved
// without the unit delay in the loop, so it keeps its tuning and resonance right up to Nyquist
// and stays stable however fast the Cutoff is swept, which a sequenced filter does every step.
//
// Seq and Env are each +-4 octaves at full turn. Res runs from a flat Q of 0.5 to a ringing Q
// of about 8; the low- and high-pass are turned down by sqrt(k/2) as the resonance rises so the
// peak doesn't jump out, and the band-pass is normalised to unity at its centre.

const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

export const FILTER_DEFAULTS = { mode: 0, cutoff: 600, res: 0.5, env: 0, seq: 0.5, pre: 0 };

export const damping = (res) => 2 - 1.88 * clamp(res, 0, 1);

// The Cutoff after modulation, in Hz: Seq value and envelope both 0..1.
export function modCutoff(p, seq, env, rate) {
  const oct = 4 * (clamp(p.seq ?? 0, -1, 1) * seq + clamp(p.env ?? 0, -1, 1) * env);
  return clamp(clamp(p.cutoff ?? 600, 40, 16000) * 2 ** oct, 20, rate * 0.45);
}

export class AutoFilter {
  constructor(rate) {
    this.rate = rate;
    this.env = 0;
    this.logFc = Math.log(FILTER_DEFAULTS.cutoff);
    this.fc = FILTER_DEFAULTS.cutoff;
    this.ic = [new Float64Array(2), new Float64Array(2)];
    this.atk = 1 - Math.exp(-1 / (0.003 * rate));
    this.rel = 1 - Math.exp(-1 / (0.12 * rate));
    this.glide = 1 - Math.exp(-1 / (0.0007 * rate));
  }

  // `seq` holds the Sequencer's value for each frame (null: no Sequencer).
  process(L, R, n, p, seq) {
    const mode = clamp(Math.round(p.mode ?? 0), 0, 2);
    const k = damping(p.res ?? 0.5);
    const lpGain = Math.sqrt(k / 2);
    for (let i = 0; i < n; i++) {
      const a = Math.max(Math.abs(L[i]), Math.abs(R[i]));
      this.env += (a - this.env) * (a > this.env ? this.atk : this.rel);
      const want = Math.log(modCutoff(p, seq ? seq[i] : 0, Math.min(this.env * 2, 1), this.rate));
      this.logFc += (want - this.logFc) * this.glide;
      this.fc = Math.exp(this.logFc);
      const g = Math.tan((Math.PI * this.fc) / this.rate);
      const a1 = 1 / (1 + g * (g + k));
      const a2 = g * a1;
      const a3 = g * a2;
      for (let c = 0; c < 2; c++) {
        const io = c ? R : L;
        const s = this.ic[c];
        const x = io[i];
        const v3 = x - s[1];
        const v1 = a1 * s[0] + a2 * v3;
        const v2 = s[1] + a2 * s[0] + a3 * v3;
        s[0] = 2 * v1 - s[0];
        s[1] = 2 * v2 - s[1];
        io[i] = mode === 0 ? v2 * lpGain : mode === 1 ? k * v1 : (x - k * v1 - v2) * lpGain;
      }
    }
    for (const s of this.ic) if (!Number.isFinite(s[0]) || !Number.isFinite(s[1])) s.fill(0);
  }
}
