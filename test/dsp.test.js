import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Tape } from '../dsp/tape.js';
import { Phaser } from '../dsp/phaser.js';
import { Spring } from '../dsp/spring.js';
import { defaults } from '../dsp/params.js';
import { Rack, rackState, chainRoutes, toRack, MODULES } from '../dsp/rack.js';
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

test('tape echo bounded at full feedback', () => {
  const [L, R] = impulse(SR * 4);
  const t = new Tape(SR);
  const p = { ...defaults('tape'), feedback: 1.05, drive: 1, mix: 1 };
  for (let o = 0; o < L.length; o += 128) t.process(L.subarray(o, o + 128), R.subarray(o, o + 128), 128, p, 22050);
  assert.ok(finite(L) && peak(L) < 8, `peak ${peak(L)}`);
  assert.ok(peak(L.subarray(16000, 18000)) > 0.01, 'an echo after 3/16 at 120');
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
  st.routes.phaser.tape = -6; // feedback from the end back to the start
  st.macros[0].maps.push({ target: 'slot', slot: 'tape', param: 'feedback', min: 0.2, max: 1 });
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
  by.routes = chainRoutes(['phaser', 'spring', 'tape']);
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
  assert.equal(st.routes.in.spring, 0);
  assert.equal(st.routes.spring.tape, 0);
  assert.equal(st.routes.tape.out, 0);
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


test('tape glides to a new Time instead of jumping', () => {
  const rate = 48000;
  const t = new Tape(rate);
  const p = defaults('tape');
  const L = new Float32Array(64);
  const R = new Float32Array(64);
  t.process(L, R, 64, p, rate / 2);
  const start = t.base;
  p.beats = 1.5; // twice as long
  t.process(L, R, 64, p, rate / 2);
  assert.ok(t.base > start && t.base - start <= 32 + 1e-9, 'moves at most half a frame per frame');
  for (let i = 0; i < 3000; i++) t.process(L, R, 64, p, rate / 2);
  assert.ok(Math.abs(t.base - (1.5 * rate / 2 - 16)) < 1, 'settles on the new Time');
});
