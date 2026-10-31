// Delay: a clean stereo echo, split out of Tape. Time in notes (Sync) or ms; when Time changes
// the read point glides there, so the repeats bend in pitch like moving a tape head. Feedback
// goes through a soft clipper, a gentle low-pass and a 60 Hz high-pass, so long feedback darkens
// and can't run away.

const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

export const DELAY_DEFAULTS = { sync: 1, beats: 0.75, time_ms: 375, feedback: 0.5, mix: 0.5 };

export class Delay {
  constructor(rate) {
    this.rate = rate;
    this.len = Math.round(rate * 5);
    this.buf = [new Float32Array(this.len), new Float32Array(this.len)];
    this.i = 0;
    this.base = NaN;
    this.lp = [0, 0];
    this.hp = [0, 0];
    this.hpX = [0, 0];
  }

  // Process `n` frames of L and R in place. `beat` is a beat's length in frames.
  process(L, R, n, p, beat = this.rate / 2) {
    const synced = p.sync ?? 1;
    const target = synced
      ? Math.max(p.beats ?? 0.75, 0.0625) * beat
      : clamp(p.time_ms ?? 375, 10, 2000) * 0.001 * this.rate;
    const len = this.len;
    const want = clamp(target, 2, len - 4);
    // The read point glides to a new Time instead of jumping: about a quarter second to settle,
    // and never faster than an octave down or a fifth up.
    if (!(this.base >= 0)) this.base = want;
    const glide = 1 - Math.exp(-1 / (0.25 * this.rate));
    const fb = clamp(p.feedback, 0, 1.05);
    const mix = clamp(p.mix, 0, 1);
    const aLp = 1 - Math.exp(-2 * Math.PI * 9000 / this.rate);
    const aHp = Math.exp(-2 * Math.PI * 60 / this.rate);
    const io = [L, R];
    for (let f = 0; f < n; f++) {
      this.base += clamp((want - this.base) * glide, -0.5, 0.5);
      const pos = this.i + len - this.base;
      const k = Math.floor(pos);
      const fr = pos - k;
      for (let c = 0; c < 2; c++) {
        const b = this.buf[c];
        const y0 = b[(k + len - 1) % len];
        const y1 = b[k % len];
        const y2 = b[(k + 1) % len];
        const y3 = b[(k + 2) % len];
        const echo = y1 + 0.5 * fr * (y2 - y0 + fr * (2 * y0 - 5 * y1 + 4 * y2 - y3 + fr * (3 * (y1 - y2) + y3 - y0)));
        // The loop: soft clip, darken a little, lose the lows.
        this.lp[c] += aLp * (Math.tanh(echo) - this.lp[c]);
        const hp = aHp * (this.hp[c] + this.lp[c] - this.hpX[c]);
        this.hpX[c] = this.lp[c];
        this.hp[c] = hp;
        const x = io[c][f];
        b[this.i] = x + hp * fb;
        io[c][f] = x * (1 - mix) + echo * mix;
      }
      this.i = (this.i + 1) % len;
    }
  }
}
