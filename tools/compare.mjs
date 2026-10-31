// node tools/compare.mjs <in.wav> <rust-out-dir>
// Renders <in.wav> through each JS effect at its Rust defaults (Dry/Wet 100%) and compares it
// with rust-render's output: the difference left after subtracting, and loudness per octave.
// The port doesn't have to match exactly; this is a sanity check.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { decodeWav, encodeWav } from '../host/wav.js';
import { Tape } from '../dsp/tape.js';
import { Phaser } from '../dsp/phaser.js';
import { Spring } from '../dsp/spring.js';
import { defaults } from '../dsp/params.js';

const [input, dir = 'out'] = process.argv.slice(2);
mkdirSync(dir, { recursive: true });
const src = decodeWav(readFileSync(input).buffer);
const rate = src.rate;
const tail = rate * 4;
const n = src.channels[0].length + tail;
const bin = new URL('./rust-render/target/release/rust-render', import.meta.url).pathname;

const rms = (a) => Math.sqrt(a.reduce((s, v) => s + v * v, 0) / a.length);
const db = (x) => (20 * Math.log10(Math.max(x, 1e-12))).toFixed(1);

// Energy in octave bands from 63 Hz to 16 kHz (a one-pole band split, good enough here).
function bands(x) {
  const out = [];
  for (let fc = 63; fc <= 16000; fc *= 2) {
    const lo = Math.exp(-2 * Math.PI * fc / Math.SQRT2 / rate);
    const hi = Math.exp(-2 * Math.PI * Math.min(fc * Math.SQRT2, 0.45 * rate) / rate);
    let a = 0, b = 0, e = 0;
    for (let i = 0; i < x.length; i++) {
      a = x[i] + (a - x[i]) * hi;
      b = x[i] + (b - x[i]) * lo;
      const v = a - b;
      e += v * v;
    }
    out.push(Math.sqrt(e / x.length));
  }
  return out;
}

const FX = { tape: Tape, phaser: Phaser, spring: Spring };
for (const name of Object.keys(FX)) {
  const p = { ...defaults(name), mix: 1 };
  const L = new Float32Array(n);
  const R = new Float32Array(n);
  L.set(src.channels[0]);
  R.set(src.channels[1] || src.channels[0]);
  const fx = new FX[name](rate);
  for (let o = 0; o < n; o += 64) fx.process(L.subarray(o, o + 64), R.subarray(o, o + 64), Math.min(64, n - o), p, rate * 0.5);
  writeFileSync(`${dir}/${name}-js.wav`, Buffer.from(encodeWav([L, R], rate, 32)));
  execFileSync(bin, [name, input, `${dir}/${name}-rust.wav`, JSON.stringify(p), '120']);
  const rust = decodeWav(readFileSync(`${dir}/${name}-rust.wav`).buffer).channels[0];
  const diff = L.map((v, i) => v - rust[i]);
  const bj = bands(L);
  const br = bands(rust);
  const worst = Math.max(...bj.map((v, i) => Math.abs(20 * Math.log10(Math.max(v, 1e-9) / Math.max(br[i], 1e-9)))));
  console.log(`${name.padEnd(7)} level JS ${db(rms(L))} dB, Rust ${db(rms(rust))} dB | difference ${db(rms(diff) / rms(rust))} dB below the signal | octave bands within ${worst.toFixed(2)} dB`);
}
