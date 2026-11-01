// Sequencer: up to 16 steps, each a level 0..1, stepping in time with the host (Sync: a note
// value per step) or free (steps per second). Slew glides from one step to the next: a curve
// like an RC portamento, 1 - e^(-4t) scaled to land exactly on the new step after Slew of the
// step's length, so it's always in time whatever the tempo. Swing pushes every other step late,
// up to a triplet feel at 100%.
//
// The position is in steps. When the host is playing it gives the song position, so the pattern
// is locked to the bar; otherwise it runs free from the last reset.

import { STEP_DEFAULTS } from './params.js';

const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
const CURVE = 4;
const NORM = 1 / (1 - Math.exp(-CURVE));
// Glide shape over 0..1 of the slew.
export const glide = (u) => (1 - Math.exp(-CURVE * u)) * NORM;

export const SEQ_DEFAULTS = { sync: 1, rate: 0.25, hz: 8, steps: 16, slew: 0.3, swing: 0, values: STEP_DEFAULTS };

// Where in the pattern a position (in steps) is: the step number (counting from the start, not
// wrapped) and how far through it, 0..1, with Swing.
export function locate(pos, swing) {
  const pair = Math.floor(pos / 2);
  const w = pos - 2 * pair;
  const split = 1 + clamp(swing, 0, 1) / 3;
  if (w < split) return [2 * pair, w / split];
  return [2 * pair + 1, (w - split) / (2 - split)];
}

export class Sequencer {
  constructor(rate) {
    this.rate = rate;
    this.reset();
  }

  reset() {
    this.pos = 0;
    this.step = -1;
    this.from = 0;
    this.out = 0;
  }

  // Frames per step.
  stepFrames(p, beat) {
    return p.sync ?? 1 ? Math.max(p.rate ?? 0.25, 1 / 32) * beat : this.rate / clamp(p.hz ?? 8, 0.05, 50);
  }

  // Fill `out` with n values 0..1. `beat` is a beat's length in frames; `songBeats` the host's
  // position in beats at the first frame, or null when it isn't playing.
  render(out, n, p, beat, songBeats = null) {
    const frames = this.stepFrames(p, beat);
    if (songBeats != null && (p.sync ?? 1)) this.pos = songBeats / Math.max(p.rate ?? 0.25, 1 / 32);
    const count = clamp(Math.round(p.steps ?? 16), 1, 16);
    const values = p.values || STEP_DEFAULTS;
    const slew = clamp(p.slew ?? 0, 0, 1);
    const swing = p.swing ?? 0;
    for (let i = 0; i < n; i++) {
      const [step, u] = locate(this.pos, swing);
      if (step !== this.step) {
        this.step = step;
        this.from = this.out;
      }
      const idx = ((step % count) + count) % count;
      const to = clamp(values[idx] ?? 0, 0, 1);
      this.out = slew > 0 && u < slew ? this.from + (to - this.from) * glide(u / slew) : to;
      out[i] = this.out;
      this.pos += 1 / frames;
    }
    // Keep the free-running position small, a whole number of 16-step bars back.
    if (this.pos >= 1 << 20) {
      this.pos -= 1 << 20;
      this.step -= 1 << 20;
    }
  }

  // The current step, wrapped, for the picture.
  current(p) {
    const count = clamp(Math.round(p.steps ?? 16), 1, 16);
    return ((this.step % count) + count) % count;
  }
}
