import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Tape } from '../dsp/tape.js';
import { Phaser } from '../dsp/phaser.js';
import { Spring } from '../dsp/spring.js';
import { defaults } from '../dsp/params.js';
import { Rack, emptyState, newSlot, newMixer } from '../dsp/rack.js';
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

test('rack: series chain, bypass, feedback mixer, macros', () => {
  const st = emptyState();
  st.slots[0] = newSlot('s1', 'tape');
  st.slots[1] = newSlot('s2', 'spring');
  st.slots[2] = newSlot('s3', 'phaser');
  const m = newMixer('A');
  m.channels[0].source = 'in';
  m.channels[1] = { source: 'slot:s3', level: -6, pan: 0 };
  st.mixers.push(m);
  st.slots[0].input = 'mix:A';
  st.macros[0].maps.push({ target: 'slot', slot: 's1', param: 'feedback', min: 0.2, max: 1 });
  st.macros[0].value = 1;
  const rack = new Rack(SR);
  rack.setState(st);
  const [L, R] = impulse(SR * 3);
  const oL = new Float32Array(L.length);
  const oR = new Float32Array(L.length);
  rack.process(L, R, oL, oR, L.length);
  assert.ok(finite(oL) && peak(oL) <= 1);
  assert.ok(peak(oL.subarray(SR * 2)) > 1e-4, 'feedback keeps it going');
  // Everything bypassed: output is the input.
  st.slots.forEach((s) => (s.on = false));
  st.slots[0].input = 'auto';
  const r2 = new Rack(SR);
  r2.setState(st);
  const x = new Float32Array(1000).map((_, i) => 0.3 * Math.sin(i / 7));
  const y = new Float32Array(1000);
  const y2 = new Float32Array(1000);
  r2.process(x, x, y, y2, 1000);
  assert.ok(x.every((v, i) => Math.abs(v - y[i]) < 1e-6));
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

test('patchbay runs modules in patch order, with no delay on forward cables', async () => {
  const { patchbayState, toPatchbay } = await import('../dsp/rack.js');
  const st = patchbayState();
  st.slots.forEach((s) => (s.on = false));
  // Patch backwards against the array order: in -> phaser -> spring -> tape -> out.
  st.slots.find((s) => s.id === 'phaser').input = 'in';
  st.slots.find((s) => s.id === 'spring').input = 'slot:phaser';
  st.slots.find((s) => s.id === 'tape').input = 'slot:spring';
  st.out = 'slot:tape';
  const rack = new Rack(SR);
  rack.setState(st);
  const x = new Float32Array(512).map((_, i) => 0.3 * Math.sin(i / 5));
  const y = new Float32Array(512);
  const z = new Float32Array(512);
  rack.process(x, x, y, z, 512);
  assert.ok(x.every((v, i) => Math.abs(v - y[i]) < 1e-6));
  // An old 4-slot preset becomes the three modules, chained in its old order.
  const old = emptyState();
  old.slots[0] = newSlot('s1', 'spring');
  old.slots[1] = newSlot('s2', 'tape');
  const pb = toPatchbay(old);
  assert.deepEqual(pb.slots.map((s) => s.id), ['tape', 'spring', 'phaser']);
  assert.equal(pb.slots.find((s) => s.id === 'spring').input, 'in');
  assert.equal(pb.slots.find((s) => s.id === 'tape').input, 'slot:spring');
});
