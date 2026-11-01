// Renders a test signal through the JS DSP and prints { inL, inR, L, R } as JSON, so the Rust
// plugin's tests (plugin/tests/match_js.rs) can check they sound the same.
// Usage: node tools/render-js.mjs <case>   (cases below)

import { Tape } from '../dsp/tape.js';
import { Delay } from '../dsp/delay.js';
import { Filter } from '../dsp/filter.js';
import { Phaser } from '../dsp/phaser.js';
import { Spring } from '../dsp/spring.js';
import { defaults } from '../dsp/params.js';
import { Rack, rackState } from '../dsp/rack.js';

const SR = 44100;
const N = 64 * 400;

// A burst of noise and a low sine, the same in Rust (an LCG, then a sine).
function input() {
  const x = new Float32Array(N);
  let seed = 12345;
  for (let i = 0; i < N; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const noise = ((seed >>> 8) / 16777216) * 2 - 1;
    const env = i < 4000 ? 1 : 0;
    x[i] = Math.fround(0.4 * noise * env + 0.3 * Math.sin(i * 0.013));
  }
  return x;
}

// The settings each case uses; the Rust test sets the same.
const CASES = {
  tape: () => ['tape', { ...defaults('tape'), mix: 1, drive: 0.8, lfo_depth: 3, lfo_rate: 2, lfo_shape: 1 }],
  filter: () => ['filter', { ...defaults('filter'), mix: 1, resonance: 0.85, drive: 0.6, env: 0.5 }],
  'filter-bp': () => ['filter', { ...defaults('filter'), mix: 1, mode: 1, cutoff: 800 }],
  delay: () => ['delay', { ...defaults('delay'), mix: 1 }],
  'delay-ms': () => ['delay', { ...defaults('delay'), mix: 0.7, sync: 0, time_ms: 120 }],
  phaser: () => ['phaser', { ...defaults('phaser'), mix: 1, spread: 90, feedback: 0.6, speed: 2 }],
  'phaser-sync': () => ['phaser', { ...defaults('phaser'), mix: 1, sync: 1, rate_beats: 1 }],
  spring: () => ['spring', { ...defaults('spring'), mix: 1 }],
};
for (let m = 0; m < 4; m++) CASES[`rack-${m}`] = () => ['rack', { mode: m, loop: 0.6 }];

const which = process.argv[2];
const [kind, p] = CASES[which]();
const x = input();
const L = x.slice();
const R = x.map((v, i) => (i % 2 ? v : -v));
const inL = L.slice();
const inR = R.slice();
const beat = SR / 2; // 120 BPM
if (kind === 'rack') {
  const st = rackState();
  st.main.mode = p.mode;
  st.main.loop = p.loop;
  const rack = new Rack(SR);
  rack.setState(st);
  const oL = new Float32Array(N);
  const oR = new Float32Array(N);
  rack.process(inL, inR, oL, oR, N);
  L.set(oL);
  R.set(oR);
} else {
  const fx = new { tape: Tape, delay: Delay, filter: Filter, phaser: Phaser, spring: Spring }[kind](SR);
  for (let o = 0; o < N; o += 64) fx.process(L.subarray(o, o + 64), R.subarray(o, o + 64), 64, p, beat);
}
process.stdout.write(JSON.stringify({ inL: Array.from(inL), inR: Array.from(inR), L: Array.from(L), R: Array.from(R) }));
