// Filter: the Polivoks VCF (Formanta, 1982). A 12 dB/oct state-variable filter, low-pass or
// band-pass, built not from OTAs but from two K140UD12 programmable op-amps used as integrators:
// the set current that tunes the filter also starves the op-amps, so each integrator can only
// slew so fast. That slew limit is the sound: loud input and high Resonance push the integrators
// into it, the peak goes hard and gritty instead of ringing cleanly, and near the top of
// Resonance the filter screams into a slew-limited, almost triangle oscillation.
//
// Model: each integrator is an op-amp input pair driving its compensation capacitor, so its rate
// of change is the set current times tanh(input) (dy = f * tanh(u)). Two of those in a
// Chamberlin SVF loop, with the damping (Resonance) fed back through a soft rail clip and allowed
// to go slightly negative so the filter self-oscillates. An asymmetric input stage clips the
// two halves of the wave differently. Run at 4x the sample rate so the clipping and high Cutoffs
// stay clean. Env opens the Cutoff with the input's level, like an auto-wah.

const OS = 4;
const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

export const FILTER_MODES = [['LP', 0], ['BP', 1]];
export const FILTER_DEFAULTS = { mode: 0, cutoff: 1500, resonance: 0.5, drive: 0.3, env: 0, mix: 0.5 };

// Resonance (0..1) to the SVF's damping: well damped at 0, through zero (self-oscillation) at
// about 90%, a little negative at the top so it oscillates firmly.
export const damping = (res) => 1.6 - 1.75 * clamp(res, 0, 1) ** 0.8;

const ASYM = 0.25;
const asym = (x) => Math.tanh(x + ASYM) - Math.tanh(ASYM);
// The op-amps' outputs can't swing past their supply rails.
const RAIL = 1.5;

export class Filter {
  constructor(rate) {
    this.rate = rate;
    this.env = 0;
    this.logFc = Math.log(FILTER_DEFAULTS.cutoff);
    this.sides = [0, 1].map(() => ({ bp: 0, lp: 0, x: 0, dcX: 0, dcY: 0 }));
  }

  process(L, R, n, p) {
    const osRate = this.rate * OS;
    const bandpass = Math.round(p.mode ?? 0) === 1;
    const k = damping(p.resonance ?? 0.5);
    const drive = clamp(p.drive ?? 0.3, 0, 1);
    const gIn = 0.6 * 10 ** (drive * 30 / 20);
    // Make-up gain: unity while clean; past that, more Drive saturates rather than getting louder.
    const gOut = 1 / Math.min(gIn, 2);
    const envAmt = clamp(p.env ?? 0, 0, 1);
    const mix = clamp(p.mix ?? 0.5, 0, 1);
    const atk = 1 - Math.exp(-1 / (0.004 * this.rate));
    const rel = 1 - Math.exp(-1 / (0.15 * this.rate));
    const glide = 1 - Math.exp(-1 / (0.005 * this.rate));
    const dc = Math.exp(-2 * Math.PI * 8 / this.rate);
    const base = Math.log(clamp(p.cutoff ?? 1500, 30, 12000));
    const top = Math.log(Math.min(16000, osRate * 0.14));
    const io = [L, R];
    for (let i = 0; i < n; i++) {
      // Envelope follower on the louder side, up to four octaves of Cutoff.
      const a = Math.max(Math.abs(L[i]), Math.abs(R[i]));
      this.env += (a - this.env) * (a > this.env ? atk : rel);
      const want = Math.min(base + envAmt * Math.min(this.env * 2, 1) * 4 * Math.LN2, top);
      this.logFc += (want - this.logFc) * glide;
      const f = Math.min(2 * Math.sin(Math.PI * Math.exp(this.logFc) / osRate), 0.9);
      for (let c = 0; c < 2; c++) {
        const s = this.sides[c];
        const x = io[c][i];
        const xin = gIn * x;
        let acc = 0;
        for (let o = 1; o <= OS; o++) {
          // Linear interpolation up, the input stage, then the two slewing integrators.
          const u = asym(s.x + (xin - s.x) * (o / OS));
          const fb = RAIL * Math.tanh(s.bp / RAIL);
          const hp = u - s.lp - k * fb;
          s.bp = clamp(s.bp + f * Math.tanh(hp), -RAIL, RAIL);
          s.lp = clamp(s.lp + f * Math.tanh(s.bp), -RAIL, RAIL);
          acc += bandpass ? s.bp : s.lp;
        }
        s.x = xin;
        // Average down, take out the DC the asymmetric stage leaves, set the level.
        const y = acc / OS;
        const out = y - s.dcX + dc * s.dcY;
        s.dcX = y;
        s.dcY = out;
        io[c][i] = x * (1 - mix) + out * gOut * mix;
      }
    }
    for (const s of this.sides) {
      if (!Number.isFinite(s.bp) || !Number.isFinite(s.lp)) Object.assign(s, { bp: 0, lp: 0, x: 0, dcX: 0, dcY: 0 });
    }
  }
}
