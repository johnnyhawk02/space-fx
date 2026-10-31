import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Tape } from '../dsp/tape.js';
import { Delay } from '../dsp/delay.js';
import { Phaser } from '../dsp/phaser.js';
import { Spring } from '../dsp/spring.js';
import { defaults } from '../dsp/params.js';
import { Rack, rackState, chainRoutes, toRack, MODULES, MODES } from '../dsp/rack.js';
import { randomRack } from '../dsp/random.js';
import { presetName } from '../dsp/names.js';

const SR = 44100;

function impulse(n) {
  const L = new Float32Array(n);
  const R = new Float32Array(n);
  L[0] = R[0] = 1;
  return [L, R];
}

const peak = (a) => a.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
const finite = (a) => a.every(Number.isFinite);

test('spring echoes and stays finite', () => {
  const [L, R] = impulse(SR * 2);
  const s = new Spring(SR);
  const p = { ...defaults('spring'), mix: 1 };
  for (let o = 0; o < L.length; o += 128) s.process(L.subarray(o, o + 128), R.subarray(o, o + 128), 128, p);
  assert.ok(finite(L) && peak(L) < 4);
  assert.ok(peak(L.subarray(SR)) > 1e-4, 'still echoing after a second');
});

test('delay echo bounded at full feedback', () => {
  const [L, R] = impulse(SR * 4);
  const d = new Delay(SR);
  const p = { ...defaults('delay'), feedback: 1.05, mix: 1 };
  for (let o = 0; o < L.length; o += 128) d.process(L.subarray(o, o + 128), R.subarray(o, o + 128), 128, p, 22050);
  assert.ok(finite(L) && peak(L) < 8, `peak ${peak(L)}`);
  assert.ok(peak(L.subarray(16000, 18000)) > 0.01, 'an echo after 3/16 at 120');
});

test('tape colours without echoing, and Dry/Wet lines up', () => {
  const n = SR;
  const x = Float32Array.from({ length: n }, (_, i) => 0.5 * Math.sin(i * 0.02));
  const run = (mix) => {
    const L = x.slice();
    const R = x.slice();
    new Tape(SR).process(L, R, n, { ...defaults('tape'), wow: 0, mix });
    return L;
  };
  const wet = run(1);
  assert.ok(finite(wet) && peak(wet) > 0.05 && peak(wet) < 4);
  const dry = run(0);
  // Dry at 0% is the input, a few ms late; the late part matches the wet's average timing.
  let best = Infinity;
  for (let lag = 0; lag < 400; lag++) {
    let e = 0;
    for (let i = 2000; i < 6000; i++) e += Math.abs(dry[i] - x[i - lag]);
    best = Math.min(best, e);
  }
  assert.ok(best < 1e-3, 'dry is the input, delayed');
});

test('phaser notch moves', () => {
  const n = SR;
  const L = new Float32Array(n).map((_, i) => 0.5 * Math.sin(2 * Math.PI * 700 * i / SR));
  const R = L.slice();
  const ph = new Phaser(SR);
  ph.process(L, R, n, { speed: 2, mix: 1 });
  const env = [];
  for (let o = 4410; o + 441 <= n; o += 441) env.push(peak(L.subarray(o, o + 441)));
  assert.ok(Math.min(...env) < Math.max(...env) * 0.6 && Math.max(...env) < 1);
});

test('rack: chain, bypass, feedback send, macro on a send', () => {
  const st = rackState();
  st.main.mode = null; // hand-made sends
  st.routes.phaser.tape = -6; // feedback from the end back to the start
  st.macros[0].maps.push({ target: 'slot', slot: 'delay', param: 'feedback', min: 0.2, max: 1 });
  st.macros[1].maps.push({ target: 'route', src: 'spring', dst: 'out', min: 0, max: 1 });
  st.macros[0].value = 1;
  st.macros[1].value = 0.5;
  const rack = new Rack(SR);
  rack.setState(st);
  const [L, R] = impulse(SR * 3);
  const oL = new Float32Array(L.length);
  const oR = new Float32Array(L.length);
  rack.process(L, R, oL, oR, L.length);
  assert.ok(finite(oL) && peak(oL) <= 1);
  assert.ok(peak(oL.subarray(SR * 2)) > 1e-4, 'feedback keeps it going');
  // Everything bypassed: output is the input, with no delay, whatever order the sends run in.
  const by = rackState();
  by.slots.forEach((s) => (s.on = false));
  by.main.mode = null;
  by.routes = chainRoutes(['phaser', 'spring', 'delay', 'tape']);
  const r2 = new Rack(SR);
  r2.setState(by);
  const x = new Float32Array(1000).map((_, i) => 0.3 * Math.sin(i / 7));
  const y = new Float32Array(1000);
  const y2 = new Float32Array(1000);
  r2.process(x, x, y, y2, 1000);
  assert.ok(x.every((v, i) => Math.abs(v - y[i]) < 1e-6));
});

test('old presets become the grid', () => {
  // Four slots, Spring then Tape.
  const old = { tempo: 100, slots: [
    { id: 's1', type: 'spring', on: true, input: 'auto', params: { decay: 0.4 } },
    { id: 's2', type: 'tape', on: false, input: 'auto', params: {} },
    { id: 's3', type: null, input: 'auto', params: {} },
    { id: 's4', type: null, input: 'auto', params: {} }], mixers: [], out: 'auto', macros: [], main: { dryWet: 1 } };
  const st = toRack(old);
  assert.deepEqual(st.slots.map((s) => s.id), MODULES);
  assert.equal(st.main.mode, 0, 'starts in Series');
  assert.equal(st.slots.find((s) => s.id === 'spring').params.decay, 0.4);
  assert.equal(st.slots.find((s) => s.id === 'tape').on, false);
});

test('random racks are finite', () => {
  let seed = 1;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let k = 0; k < 10; k++) {
    const st = randomRack(rand);
    const rack = new Rack(SR);
    rack.setState(st);
    const [L, R] = impulse(SR);
    const oL = new Float32Array(SR);
    const oR = new Float32Array(SR);
    rack.process(L, R, oL, oR, SR);
    assert.ok(finite(oL) && peak(oL) <= 1, st.name);
  }
});

test('preset names', () => {
  const taken = new Set();
  for (let i = 0; i < 300; i++) {
    const n = presetName(taken);
    assert.ok(n.length <= 24 && !taken.has(n), n);
    taken.add(n);
  }
});


test('delay glides to a new Time instead of jumping', () => {
  const rate = 48000;
  const t = new Delay(rate);
  const p = defaults('delay');
  const L = new Float32Array(64);
  const R = new Float32Array(64);
  t.process(L, R, 64, p, rate / 2);
  const start = t.base;
  p.beats = 1.5; // twice as long
  t.process(L, R, 64, p, rate / 2);
  assert.ok(t.base > start && t.base - start <= 32 + 1e-9, 'moves at most half a frame per frame');
  for (let i = 0; i < 3000; i++) t.process(L, R, 64, p, rate / 2);
  assert.ok(Math.abs(t.base - 1.5 * rate / 2) < 1, 'settles on the new Time');
});

test('every Mode passes sound, and Feedback keeps it going', () => {
  for (let mode = 0; mode < MODES.length; mode++) {
    for (const loop of [0, 1]) {
      const st = rackState();
      st.main.mode = mode;
      st.main.loop = loop;
      st.slots.forEach((s) => (s.params.mix = 1));
      st.slots.find((s) => s.id === 'delay').params.feedback = 0;
      const rack = new Rack(SR);
      rack.setState(st);
      const [L, R] = impulse(SR * 3);
      const oL = new Float32Array(L.length);
      const oR = new Float32Array(L.length);
      rack.process(L, R, oL, oR, L.length);
      assert.ok(finite(oL) && peak(oL) <= 1 && peak(oL) > 1e-3, `mode ${mode} loop ${loop}`);
      if (loop) assert.ok(peak(oL.subarray(SR * 2)) > 1e-5, `mode ${mode} feeds back`);
    }
  }
});

test('phaser: Spread makes the sides differ, Feedback stays bounded', () => {
  const n = SR * 2;
  const make = () => Float32Array.from({ length: n }, (_, i) => 0.5 * Math.sin(i * 0.05) + 0.3 * Math.sin(i * 0.31));
  const L = make();
  const R = make();
  new Phaser(SR).process(L, R, n, { speed: 1, mix: 1, spread: 180, feedback: 0.9, depth: 1, center: 4500 });
  assert.ok(finite(L) && finite(R) && peak(L) < 4 && peak(R) < 4);
  let diff = 0;
  for (let i = 0; i < n; i++) diff = Math.max(diff, Math.abs(L[i] - R[i]));
  assert.ok(diff > 0.05, 'left and right sweep apart');
});

test('a rack from before Delay gets one, with the old Tape echo settings', () => {
  const old = rackState();
  old.slots = old.slots.filter((s) => s.type !== 'delay');
  Object.assign(old.slots[0].params, { sync: 0, time_ms: 500, feedback: 0.7, mix: 0.3 });
  old.main.mode = 2;
  const st = toRack(old);
  assert.deepEqual(st.slots.map((s) => s.id), MODULES);
  const d = st.slots.find((s) => s.id === 'delay').params;
  assert.equal(d.time_ms, 500);
  assert.equal(d.feedback, 0.7);
  assert.equal(d.sync, 0);
  assert.equal(st.main.mode, 2);
  assert.ok(!('feedback' in st.slots[0].params));
});
