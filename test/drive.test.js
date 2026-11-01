// Space Drive's DSP in Node: antialiasing, the Sequencer's timing and slew, latency, stability.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Shaper, CURVES, LATENCY } from '../drive/dsp/shaper.js';
import { Sequencer, locate } from '../drive/dsp/sequencer.js';
import { SpaceDrive } from '../drive/dsp/engine.js';
import { driveState, DEVICES, fromNorm, toNorm } from '../drive/dsp/params.js';

const SR = 44100;

// Energy off the harmonics of bin k0 against on them, in dB.
function aliasDb(x, k0) {
  const n = x.length;
  let harm = 0;
  let other = 0;
  for (let k = 1; k < n / 2; k++) {
    let re = 0;
    let im = 0;
    for (let i = 0; i < n; i++) {
      const a = (2 * Math.PI * k * i) / n;
      re += x[i] * Math.cos(a);
      im -= x[i] * Math.sin(a);
    }
    if (k % k0 === 0) harm += re * re + im * im;
    else other += re * re + im * im;
  }
  return 10 * Math.log10(other / harm);
}

test('antialiasing beats naive clipping by 20 dB on every Type', () => {
  const n = 2048;
  const k0 = 93;
  const pre = 1024;
  const f0 = (SR * k0) / n;
  for (let type = 0; type < 4; type++) {
    const L = new Float32Array(n + pre).map((_, i) => 0.9 * Math.sin((2 * Math.PI * f0 * i) / SR));
    const naive = Array.from(L.subarray(pre), (v) => CURVES[type].f(v * 100));
    const R = L.slice();
    new Shaper(SR).process(L, R, L.length, { type, amount: 1, bias: 0, tone: 0.5, output: 0, mix: 1 });
    const a = aliasDb(naive, k0);
    const b = aliasDb(Array.from(L.subarray(pre)), k0);
    assert.ok(b < a - 20, `type ${type}: ${b.toFixed(1)} dB against naive ${a.toFixed(1)} dB`);
  }
});

test('the dry side and the bypass are exactly LATENCY late', () => {
  const fx = new SpaceDrive(SR);
  const st = driveState();
  st.on.drive = false;
  st.on.filter = false;
  fx.setState(st);
  const L = new Float32Array(1024);
  L[0] = 1;
  const R = L.slice();
  fx.process(L, R, L.length);
  assert.equal(L.indexOf(Math.max(...L)), LATENCY);
});

test('steps land on the beat and glide over Slew of the step', () => {
  const beat = SR / 2;
  const values = new Array(16).fill(0);
  values[1] = 1;
  const s = new Sequencer(SR);
  const out = new Float64Array(beat);
  s.render(out, out.length, { sync: 1, rate: 0.25, steps: 16, slew: 0.5, swing: 0, values }, beat, 0);
  const step = Math.floor(beat / 4);
  assert.equal(out[step - 1], 0);
  assert.ok(out[step + Math.floor(step / 8)] > 0.2 && out[step + Math.floor(step / 8)] < 0.95);
  assert.ok(Math.abs(out[step + Math.floor(step / 2) + 2] - 1) < 1e-9);
  // Swing: the odd step starts late, up to a triplet.
  assert.deepEqual(locate(1.2, 1), [0, 1.2 / (4 / 3)]);
});

test('every dial round-trips through its position', () => {
  for (const dev of Object.values(DEVICES)) {
    for (const spec of dev.params) {
      if (spec.kind === 'toggle') continue;
      const v = spec.def;
      const back = fromNorm(spec, toNorm(spec, v));
      assert.ok(Math.abs(back - v) < 1e-9 * Math.max(1, Math.abs(v)), `${dev.name} ${spec.label}`);
    }
  }
});

test('stays finite pushed hard, in either order', () => {
  for (const pre of [0, 1]) {
    for (let type = 0; type < 4; type++) {
      const fx = new SpaceDrive(SR);
      const st = driveState();
      Object.assign(st.drive, { type, amount: 1, output: 12 });
      Object.assign(st.filter, { res: 1, pre, env: 1 });
      fx.setState(st);
      const L = new Float32Array(20000).map((_, i) => (((i * 7919) % 2000) / 1000 - 1) * 4);
      const R = L.slice();
      fx.process(L, R, L.length);
      assert.ok(L.every((v) => Number.isFinite(v) && Math.abs(v) < 50));
    }
  }
});

test('switching Type and moving Bias while it plays makes no spikes', () => {
  const fx = new SpaceDrive(SR);
  const st = driveState();
  st.on.filter = false;
  fx.setState(st);
  const L = new Float32Array(SR).map((_, i) => 0.3 * Math.sin((2 * Math.PI * 110 * i) / SR));
  const R = L.slice();
  // A new Type every 3 ms (far faster than a hand on the dial) and Bias jumping about.
  for (let o = 0; o < L.length; o += 128) {
    st.drive.type = (o / 128) % 4;
    st.drive.bias = ((o / 128) % 7) / 6;
    fx.process(L.subarray(o, o + 128), R.subarray(o, o + 128), 128);
  }
  let jump = 0;
  for (let i = 1000; i < L.length; i++) jump = Math.max(jump, Math.abs(L[i] - L[i - 1]));
  assert.ok(jump < 0.05, `largest step between samples ${jump}`);
});
