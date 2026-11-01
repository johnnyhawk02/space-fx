// Renders a test signal through Space Drive's JS DSP and prints { inL, inR, L, R } as JSON, so
// the Rust plugin's tests (plugin/drive/tests/match_js.rs) can check they sound the same.
// Usage: node tools/render-drive.mjs <case>   (cases below)

import { SpaceDrive } from '../drive/dsp/engine.js';
import { driveState } from '../drive/dsp/params.js';

const SR = 44100;
const N = 64 * 400;

// The same input as tools/render-js.mjs: a burst of noise and a low sine.
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

// Each case changes the defaults; the Rust test makes the same changes.
const CASES = {
  default: () => {},
  soft: (s) => Object.assign(s.drive, { amount: 0.9, bias: 0.5, tone: 0.8 }),
  diode: (s) => Object.assign(s.drive, { type: 1, amount: 0.7, mix: 0.6, output: -3 }),
  fuzz: (s) => Object.assign(s.drive, { type: 2, amount: 1, bias: 0.3, tone: 0.2 }),
  fold: (s) => Object.assign(s.drive, { type: 3, amount: 0.8 }),
  'filter-bp': (s) => Object.assign(s.filter, { mode: 1, res: 0.9, env: 0.6, pre: 1 }),
  'filter-hp': (s) => Object.assign(s.filter, { mode: 2, cutoff: 2000, seq: -0.8 }),
  'seq-free': (s) => Object.assign(s.seq, { sync: 0, hz: 13, steps: 5, slew: 0.8, swing: 0.6 }),
  'seq-song': (s) => Object.assign(s.seq, { rate: 1 / 6, slew: 0, swing: 0.3 }),
  off: (s) => Object.assign(s.on, { drive: false, seq: false }),
};

const which = process.argv[2];
const st = driveState();
CASES[which](st);
const x = input();
const L = x.slice();
const R = x.map((v, i) => (i % 2 ? v : -v));
const inL = L.slice();
const inR = R.slice();
const fx = new SpaceDrive(SR);
fx.setState(st);
// Host blocks of 100 frames; 'seq-song' plays from beat 3.5 with the song position each block.
const B = 100;
const beat = SR / 2;
for (let o = 0; o < N; o += B) {
  const n = Math.min(B, N - o);
  fx.process(L.subarray(o, o + n), R.subarray(o, o + n), n, which === 'seq-song' ? 3.5 + o / beat : null);
}
process.stdout.write(JSON.stringify({ inL: Array.from(inL), inR: Array.from(inR), L: Array.from(L), R: Array.from(R) }));
