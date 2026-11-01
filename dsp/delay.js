// Delay: a clean stereo echo, split out of Tape. Time in notes (Sync) or ms; when Time changes
// the read point glides there, so the echo bends in pitch like moving a tape head. One repeat:
// more come from the Routing panel's Feedback.
//
// Ping Pong: the input is summed to mono and the echo is thrown hard to one side, the side
// flipping every Time. Each repeat from the Routing Feedback comes back through here Time later,
// so it lands on the other side: L, R, L, R.

const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

export const DELAY_DEFAULTS = { sync: 1, beats: 0.75, time_ms: 375, pingpong: 0, mix: 0.5 };

export class Delay {
  constructor(rate) {
    this.rate = rate;
    this.len = Math.round(rate * 5);
    this.buf = [new Float32Array(this.len), new Float32Array(this.len)];
    this.i = 0;
    this.base = NaN;
    this.side = 0; // Ping Pong: where the echo is thrown, 0..1 a full cycle (left half, right half)
    this.pan = 0; // 0 left .. 1 right, following the side with a short glide
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
    const mix = clamp(p.mix, 0, 1);
    const ping = !!p.pingpong;
    const panGlide = 1 - Math.exp(-1 / (0.003 * this.rate));
    const io = [L, R];
    const echo = [0, 0];
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
        echo[c] = y1 + 0.5 * fr * (y2 - y0 + fr * (2 * y0 - 5 * y1 + 4 * y2 - y3 + fr * (3 * (y1 - y2) + y3 - y0)));
      }
      if (ping) {
        // The mono echo, thrown to the side of the moment: equal-power, unity at either side.
        this.side = (this.side + 0.5 / this.base) % 1;
        this.pan += ((this.side < 0.5 ? 0 : 1) - this.pan) * panGlide;
        const e = 0.5 * (echo[0] + echo[1]);
        echo[0] = e * Math.cos(this.pan * Math.PI / 2);
        echo[1] = e * Math.sin(this.pan * Math.PI / 2);
      }
      for (let c = 0; c < 2; c++) {
        const x = io[c][f];
        this.buf[c][this.i] = x;
        io[c][f] = x * (1 - mix) + echo[c] * mix;
      }
      this.i = (this.i + 1) % len;
    }
  }
}
