// Drive: a waveshaper with first-order antiderivative antialiasing (ADAA, Parker, Zavalishin and
// Le Bivic, DAFx-16; Bilbao et al., IEEE SPL 2017) running at twice the sample rate.
//
// Each Type is a memoryless curve f with a closed-form antiderivative F. Instead of f(x[n]) the
// shaper outputs the average of f over the straight line from x[n-1] to x[n]:
//     y[n] = (F(x[n]) - F(x[n-1])) / (x[n] - x[n-1])
// which is f convolved with a one-sample box: the corners of the clipped wave are rounded just
// enough that their harmonics stop folding back as aliasing. Two-times oversampling (a 47-tap
// half-band FIR each way) pushes what's left above hearing. Bias shifts the curve's operating
// point, f(x + b) - f(b), so the two halves of the wave clip differently (even harmonics, as an
// unbalanced tube or transistor stage does); its antiderivative is F(x + b) - x f(b).
//
//   Soft   tanh: a balanced transistor or op-amp stage, smooth and round.
//   Diode  asinh: the static solution of a diode pair to ground (Yeh, Abel and Smith, DAFx-07):
//          it never flattens, it grows logarithmically, so it stays open and dynamic.
//   Fuzz   hard clip: square-edged, with ADAA keeping the edges clean.
//   Fold   sine wavefolder (after the Serge / Lockhart folders, Esqueda et al. 2017): past full
//          scale the wave folds back on itself, so more Drive adds new partials, not just level.
//
// Then a DC blocker (Bias leaves an offset), a tilt Tone (one-pole split at 800 Hz, +-12 dB),
// level make-up so Drive changes the colour more than the loudness, Output and Dry/Wet (the dry
// side delayed to line up with the oversampler).

export const TAPS = 47;
export const LATENCY = (TAPS - 1) / 2; // frames at the base rate
const CUT = 0.21; // of the doubled rate: just under the base Nyquist
const LN2 = Math.LN2;
const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

// The half-band low-pass shared by the up- and down-sampler: a Blackman-windowed sinc, sum 1.
export function halfband() {
  const h = new Float64Array(TAPS);
  const m = (TAPS - 1) / 2;
  let sum = 0;
  for (let j = 0; j < TAPS; j++) {
    const t = j - m;
    const sinc = t === 0 ? 2 * CUT : Math.sin(2 * Math.PI * CUT * t) / (Math.PI * t);
    const w = 0.42 - 0.5 * Math.cos((2 * Math.PI * j) / (TAPS - 1)) + 0.08 * Math.cos((4 * Math.PI * j) / (TAPS - 1));
    h[j] = sinc * w;
    sum += h[j];
  }
  for (let j = 0; j < TAPS; j++) h[j] /= sum;
  return h;
}

// log(cosh(x)), without overflow.
const logcosh = (x) => {
  const a = Math.abs(x);
  return a + Math.log1p(Math.exp(-2 * a)) - LN2;
};

// Each Type's curve f and antiderivative F.
export const CURVES = [
  { f: Math.tanh, F: logcosh },
  { f: Math.asinh, F: (x) => x * Math.asinh(x) - Math.sqrt(x * x + 1) },
  { f: (x) => clamp(x, -1, 1), F: (x) => (Math.abs(x) <= 1 ? 0.5 * x * x : Math.abs(x) - 0.5) },
  { f: Math.sin, F: (x) => -Math.cos(x) },
];

// Drive (0..1) to input gain: 0 to +40 dB.
export const driveGain = (amount) => 10 ** ((clamp(amount, 0, 1) * 40) / 20);
// Bias (0..1) to the offset on the curve.
export const biasOffset = (bias) => clamp(bias, 0, 1) * 0.9;
// Make-up: unity for a -12 dBFS signal, whatever the Drive. Fold uses Soft's (sin dips to 0).
export function makeup(type, gain) {
  const f = CURVES[type === 3 ? 0 : type].f;
  return 0.25 / Math.max(Math.abs(f(0.25 * gain)), 1e-6);
}

export const DRIVE_DEFAULTS = { type: 0, amount: 0.5, bias: 0, tone: 0.5, output: 0, mix: 1 };

// Changing Type crossfades from the old curve to the new over FADE seconds (a further change
// waits for the fade in progress to finish, so it never jumps mid-fade), and every sample
// works the ADAA difference out with the curve and Bias of that sample (both ends of the line),
// so moving Bias or switching Type never makes the difference quotient jump.
const FADE = 0.03;

export class Shaper {
  constructor(rate) {
    this.rate = rate;
    this.h = halfband();
    this.half = (TAPS + 1) / 2;
    this.sides = [0, 1].map(() => ({
      up: new Float64Array(this.half), // base-rate input, newest first
      down: new Float64Array(TAPS), // doubled-rate shaped signal, newest first
      xp: 0,
      dry: new Float64Array(LATENCY),
      dc: [0, 0],
      lp: 0,
    }));
    this.di = 0;
    this.sm = null;
    this.type = -1;
    this.from = 0;
    this.fade = 1;
    this.smooth = 1 - Math.exp(-1 / (0.02 * rate));
    this.fadeStep = 1 / (FADE * rate);
    this.dcR = Math.exp((-2 * Math.PI * 10) / rate);
    this.toneA = 1 - Math.exp((-2 * Math.PI * 800) / rate);
  }

  process(L, R, n, p) {
    const type = clamp(Math.round(p.type ?? 0), 0, 3);
    if (this.type < 0) this.type = type;
    const want = {
      gain: driveGain(p.amount ?? 0.5),
      b: biasOffset(p.bias ?? 0),
      out: 10 ** (clamp(p.output ?? 0, -24, 12) / 20),
      tone: (clamp(p.tone ?? 0.5, 0, 1) - 0.5) * 24,
      mix: clamp(p.mix ?? 1, 0, 1),
    };
    if (!this.sm) this.sm = { ...want };
    const sm = this.sm;
    const k = this.smooth;
    const h = this.h;
    const io = [L, R];
    // One curve's antialiased output for the step from xp to u.
    const adaa = (c, xp, u, b, fb) => {
      const d = u - xp;
      return Math.abs(d) > 1e-6 ? (c.F(u + b) - u * fb - (c.F(xp + b) - xp * fb)) / d : c.f(0.5 * (u + xp) + b) - fb;
    };
    for (let i = 0; i < n; i++) {
      for (const key of ['gain', 'b', 'out', 'tone', 'mix']) sm[key] += (want[key] - sm[key]) * k;
      // A new Type starts its crossfade once the last one has finished.
      if (this.fade >= 1 && type !== this.type) {
        this.from = this.type;
        this.type = type;
        this.fade = 0;
      }
      this.fade = Math.min(this.fade + this.fadeStep, 1);
      const a = this.fade;
      const cur = CURVES[this.type];
      const old = CURVES[this.from];
      const fbNew = cur.f(sm.b);
      const fbOld = old.f(sm.b);
      const mkNew = makeup(this.type, sm.gain);
      const mkOld = makeup(this.from, sm.gain);
      const gh = 10 ** (sm.tone / 40);
      const gl = 1 / gh;
      for (let c = 0; c < 2; c++) {
        const s = this.sides[c];
        const x = io[c][i];
        // Up: the new sample into the history, then the two polyphase outputs.
        s.up.copyWithin(1, 0, this.half - 1);
        s.up[0] = x;
        for (let ph = 0; ph < 2; ph++) {
          let u = 0;
          for (let j = ph; j < TAPS; j += 2) u += h[j] * s.up[(j - ph) >> 1];
          u *= 2 * sm.gain;
          let y = adaa(cur, s.xp, u, sm.b, fbNew) * mkNew;
          if (a < 1) y = y * a + adaa(old, s.xp, u, sm.b, fbOld) * mkOld * (1 - a);
          s.xp = u;
          s.down.copyWithin(1, 0, TAPS - 1);
          s.down[0] = y;
        }
        // Down: filter, keep every other sample.
        let y = 0;
        for (let j = 0; j < TAPS; j++) y += h[j] * s.down[j];
        // DC blocker, then the tilt.
        const dcOut = y - s.dc[0] + this.dcR * s.dc[1];
        s.dc[0] = y;
        s.dc[1] = dcOut;
        s.lp += (dcOut - s.lp) * this.toneA;
        const wet = (gl * s.lp + gh * (dcOut - s.lp)) * sm.out;
        const dry = s.dry[this.di];
        s.dry[this.di] = x;
        io[c][i] = dry * (1 - sm.mix) + wet * sm.mix;
      }
      this.di = (this.di + 1) % LATENCY;
    }
    for (const s of this.sides) {
      if (!Number.isFinite(s.xp) || !Number.isFinite(s.lp) || !Number.isFinite(s.dc[1])) {
        s.up.fill(0);
        s.down.fill(0);
        s.xp = s.lp = 0;
        s.dc = [0, 0];
      }
    }
  }
}
