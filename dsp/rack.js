// The rack: 4 slots, each with an In and an Out, Sub Mixers that blend sources and can feed
// them back up the chain, 8 Macros, Main Dry/Wet and a safety limiter. Plain JS with no DOM or
// Web Audio, so the same code runs in the AudioWorklet, in Node and later behind a VST3.
//
// Sources a slot In, a mixer channel or Rack Out can take:
//   'auto'      the slot before (Rack In for the first slot); for Rack Out, the last slot
//   'in'        Rack In
//   'slot:<id>' a slot's Out (slots keep their id when reordered, so patches follow them)
//   'mix:<id>'  a Sub Mixer's Out
//   'none'      silence
// A source that hasn't been worked out yet in this block (it's further down the chain) comes
// from the block before: that's feedback, 64 frames late, and goes through a soft clipper.

import { Tape } from './tape.js';
import { Phaser } from './phaser.js';
import { Spring } from './spring.js';
import { DEVICES, defaults, fromNorm, MIXER_PARAMS, CHANNEL_PARAMS } from './params.js';

export const BLOCK = 64;
export const SLOTS = 4;
export const MAX_MIXERS = 4;
export const MACROS = 8;
export const MIXER_IDS = ['A', 'B', 'C', 'D'];

const EFFECTS = { tape: Tape, phaser: Phaser, spring: Spring };
const MAX_DELAY_S = 1.1;

export function emptyState() {
  return {
    tempo: 120,
    slots: ['s1', 's2', 's3', 's4'].map((id) => ({ id, type: null, on: true, input: 'auto', params: {} })),
    mixers: [],
    out: 'auto',
    macros: Array.from({ length: MACROS }, (_, i) => ({ name: `Macro ${i + 1}`, value: 0, maps: [] })),
    main: { dryWet: 1, volume: 0 },
  };
}

export function newMixer(id) {
  return {
    id,
    low_cut: 20,
    high_cut: 20000,
    delay: 0,
    channels: Array.from({ length: 4 }, () => ({ source: 'none', level: 0, pan: 0 })),
  };
}

// The patchbay: one each of Tape, Spring and Phaser, patched in that order to start.
export const MODULES = ['tape', 'spring', 'phaser'];

export function patchbayState() {
  const st = emptyState();
  st.slots = MODULES.map((t) => newSlot(t, t));
  st.slots[0].input = 'in';
  st.slots[1].input = 'slot:tape';
  st.slots[2].input = 'slot:spring';
  st.out = 'slot:phaser';
  return st;
}

// Make any saved state a patchbay: the three modules, keeping settings and patching where they
// can be kept (older presets had 4 slots with any effect in each).
export function toPatchbay(st) {
  if (st.slots.length === MODULES.length && st.slots.every((s, i) => s.id === MODULES[i] && s.type === MODULES[i])) return st;
  const out = patchbayState();
  out.name = st.name;
  out.tempo = st.tempo ?? 120;
  out.main = { ...out.main, ...st.main };
  out.macros = st.macros ?? out.macros;
  out.mixers = st.mixers ?? [];
  const filled = st.slots.filter((s) => s.type);
  for (const m of out.slots) {
    const from = filled.find((s) => s.type === m.type);
    if (from) {
      m.params = { ...m.params, ...from.params };
      m.on = from.on;
    }
  }
  // The old chain order, as a patch.
  const order = [...new Set(filled.map((s) => s.type))];
  for (const t of MODULES) if (!order.includes(t)) order.push(t);
  order.forEach((t, i) => (out.slots.find((s) => s.id === t).input = i === 0 ? 'in' : `slot:${order[i - 1]}`));
  out.out = `slot:${order[order.length - 1]}`;
  const ids = new Map(st.slots.map((s) => [s.id, s.type]));
  const fix = (src) => (src?.startsWith('slot:') && ids.get(src.slice(5)) ? `slot:${ids.get(src.slice(5))}` : src);
  for (const m of out.mixers) for (const c of m.channels) c.source = fix(c.source);
  for (const mc of out.macros) mc.maps = mc.maps.filter((x) => x.target !== 'slot' || ids.get(x.slot)).map((x) => (x.target === 'slot' ? { ...x, slot: ids.get(x.slot) } : x));
  return out;
}

export function newSlot(id, type) {
  return { id, type, on: true, input: 'auto', params: type ? defaults(type) : {} };
}

const dbToGain = (db) => (db <= -60 ? 0 : 10 ** (db / 20));

class Buf {
  constructor() {
    this.L = new Float32Array(BLOCK);
    this.R = new Float32Array(BLOCK);
  }
}

// A node's output: this block's and the last block's.
class Node {
  constructor() {
    this.cur = new Buf();
    this.prev = new Buf();
    this.done = false;
    this.busy = false;
  }

  swap() {
    const t = this.prev;
    this.prev = this.cur;
    this.cur = t;
    this.done = false;
  }
}

class MixerDsp {
  constructor(rate) {
    this.rate = rate;
    this.node = new Node();
    this.len = Math.ceil(rate * MAX_DELAY_S) + BLOCK;
    this.dl = [new Float32Array(this.len), new Float32Array(this.len)];
    this.di = 0;
    this.lp = [0, 0];
    this.hpY = [0, 0];
    this.hpX = [0, 0];
  }
}

// Slot indices in the order the patch needs them: anything a slot listens to (through mixers
// too) runs before it, except round a feedback loop.
function runOrder(st) {
  const order = [];
  const seen = new Set();
  const mixSeen = new Set();
  const index = new Map(st.slots.map((s, i) => [s.id, i]));
  const visit = (src) => {
    if (!src) return;
    if (src.startsWith('slot:')) visitSlot(index.get(src.slice(5)));
    else if (src.startsWith('mix:') && !mixSeen.has(src)) {
      mixSeen.add(src);
      const m = st.mixers.find((x) => `mix:${x.id}` === src);
      if (m) for (const c of m.channels) visit(c.source);
    }
  };
  const visitSlot = (i) => {
    if (i == null || seen.has(i)) return;
    seen.add(i);
    const s = st.slots[i];
    visit(!s.input || s.input === 'auto' ? (i > 0 ? `slot:${st.slots[i - 1].id}` : 'in') : s.input);
    order.push(i);
  };
  const last = st.slots.length ? `slot:${st.slots[st.slots.length - 1].id}` : 'in';
  visit(!st.out || st.out === 'auto' ? last : st.out);
  for (const m of st.mixers) visit(`mix:${m.id}`);
  st.slots.forEach((_, i) => visitSlot(i));
  return order;
}

export class Rack {
  constructor(sampleRate) {
    this.rate = sampleRate;
    this.state = emptyState();
    this.effects = new Map(); // slot id -> { type, dsp, node }
    this.mixers = new Map(); // mixer id -> MixerDsp
    this.input = new Node();
    this.silence = new Buf();
    this.work = new Buf();
    this.limGain = 1;
    this.pos = 0;
    this.inL = new Float32Array(BLOCK);
    this.inR = new Float32Array(BLOCK);
    this.peaks = { slots: {}, out: 0 };
    this.setState(this.state);
  }

  // Replace the whole state (presets, UI edits). Running effects are kept where a slot still
  // holds the same type, so tails carry on.
  setState(state) {
    this.state = state;
    for (const slot of state.slots) {
      const cur = this.effects.get(slot.id);
      if (!slot.type) {
        this.effects.delete(slot.id);
      } else if (!cur || cur.type !== slot.type) {
        this.effects.set(slot.id, { type: slot.type, dsp: new EFFECTS[slot.type](this.rate), node: new Node() });
      }
    }
    for (const id of [...this.effects.keys()]) if (!state.slots.some((s) => s.id === id)) this.effects.delete(id);
    for (const m of state.mixers) if (!this.mixers.has(m.id)) this.mixers.set(m.id, new MixerDsp(this.rate));
    for (const id of [...this.mixers.keys()]) if (!state.mixers.some((m) => m.id === id)) this.mixers.delete(id);
    this.slotNodes = new Map(state.slots.map((s) => [s.id, this.effects.get(s.id)?.node || new Node()]));
    this.order = runOrder(state);
  }

  // Clear every tail.
  reset() {
    const state = this.state;
    this.effects.clear();
    this.mixers.clear();
    this.input = new Node();
    this.limGain = 1;
    this.setState(state);
  }

  // Parameter values after the Macros.
  resolved() {
    const st = this.state;
    const slots = st.slots.map((s) => ({ ...s, params: { ...s.params } }));
    const mixers = st.mixers.map((m) => ({ ...m, channels: m.channels.map((c) => ({ ...c })) }));
    const main = { ...st.main };
    for (const macro of st.macros) {
      for (const map of macro.maps) {
        const v = map.min + (map.max - map.min) * macro.value;
        if (map.target === 'slot') {
          const s = slots.find((x) => x.id === map.slot);
          if (!s || !s.type) continue;
          const spec = DEVICES[s.type].params.find((p) => p.id === map.param);
          if (spec) s.params[map.param] = fromNorm(spec, v);
        } else if (map.target === 'mixer') {
          const m = mixers.find((x) => x.id === map.mixer);
          if (!m) continue;
          if (map.channel != null) {
            const spec = CHANNEL_PARAMS.find((p) => p.id === map.param);
            if (spec && m.channels[map.channel]) m.channels[map.channel][map.param] = fromNorm(spec, v);
          } else {
            const spec = MIXER_PARAMS.find((p) => p.id === map.param);
            if (spec) m[map.param] = fromNorm(spec, v);
          }
        } else if (map.target === 'main') {
          if (map.param === 'dryWet') main.dryWet = v;
        }
      }
    }
    return { slots, mixers, main };
  }

  // Stereo in, stereo out, any length.
  process(inL, inR, outL, outR, n) {
    for (let off = 0; off < n; off += BLOCK) {
      const len = Math.min(BLOCK, n - off);
      this.inL.fill(0);
      this.inR.fill(0);
      this.inL.set(inL.subarray(off, off + len));
      this.inR.set((inR || inL).subarray(off, off + len));
      this.block();
      outL.set(this.outBuf.L.subarray(0, len), off);
      outR.set(this.outBuf.R.subarray(0, len), off);
    }
  }

  block() {
    const r = this.resolved();
    this.cur = r;
    const allNodes = [this.input, ...this.slotNodes.values(), ...[...this.mixers.values()].map((m) => m.node)];
    for (const node of allNodes) node.swap();
    this.input.cur.L.set(this.inL);
    this.input.cur.R.set(this.inR);
    this.input.done = true;

    // Slots in the order the patch runs (so forward connections arrive in the same block).
    for (const i of this.order) this.runSlot(i);

    // Rack Out.
    const last = r.slots.length ? `slot:${r.slots[r.slots.length - 1].id}` : 'in';
    const outSrc = this.state.out && this.state.out !== 'auto' ? this.state.out : last;
    const wet = this.fetch(outSrc);
    const out = this.work;
    const dw = Math.min(Math.max(r.main.dryWet, 0), 1);
    const vol = dbToGain(r.main.volume ?? 0);
    const ceiling = 0.966;
    const rel = Math.exp(-1 / (0.1 * this.rate));
    let peak = 0;
    for (let f = 0; f < BLOCK; f++) {
      let l = (this.inL[f] * (1 - dw) + wet.L[f] * dw) * vol;
      let rr = (this.inR[f] * (1 - dw) + wet.R[f] * dw) * vol;
      if (!Number.isFinite(l) || !Number.isFinite(rr)) {
        l = rr = 0;
        this.reset();
      }
      // Limiter: instant attack, 100 ms release.
      const a = Math.max(Math.abs(l), Math.abs(rr));
      const want = a > ceiling ? ceiling / a : 1;
      this.limGain = want < this.limGain ? want : want + (this.limGain - want) * rel;
      l *= this.limGain;
      rr *= this.limGain;
      out.L[f] = Math.max(-1, Math.min(1, l));
      out.R[f] = Math.max(-1, Math.min(1, rr));
      peak = Math.max(peak, Math.abs(out.L[f]), Math.abs(out.R[f]));
    }
    this.peaks.out = peak;
    this.outBuf = out;
    this.pos += BLOCK;
  }

  // A source's signal for this block: this block's if worked out, else work it out (mixers),
  // else last block's through a soft clipper (feedback).
  fetch(src, clip = true) {
    if (src === 'in') return this.input.cur;
    if (!src || src === 'none') return this.silence;
    let node = null;
    if (src.startsWith('slot:')) {
      node = this.slotNodes.get(src.slice(5));
    } else if (src.startsWith('mix:')) {
      const id = src.slice(4);
      const m = this.mixers.get(id);
      if (!m) return this.silence;
      if (!m.node.done && !m.node.busy) this.runMixer(id);
      node = m.node;
    }
    if (!node) return this.silence;
    if (node.done) return node.cur;
    return clip ? this.clipped(node.prev) : node.prev;
  }

  clipped(buf) {
    const out = this.clipBuf || (this.clipBuf = new Buf());
    for (let f = 0; f < BLOCK; f++) {
      out.L[f] = Math.tanh(buf.L[f]);
      out.R[f] = Math.tanh(buf.R[f]);
    }
    return out;
  }

  runSlot(i) {
    const slot = this.cur.slots[i];
    const node = this.slotNodes.get(slot.id);
    let src = slot.input;
    if (!src || src === 'auto') src = i === 0 ? 'in' : `slot:${this.cur.slots[i - 1].id}`;
    node.busy = true;
    const from = this.fetch(src);
    node.cur.L.set(from.L);
    node.cur.R.set(from.R);
    const fx = this.effects.get(slot.id);
    if (fx && slot.on) {
      const beat = this.rate * 60 / Math.max(this.state.tempo || 120, 1);
      fx.dsp.process(node.cur.L, node.cur.R, BLOCK, slot.params, beat);
    }
    let peak = 0;
    for (let f = 0; f < BLOCK; f++) peak = Math.max(peak, Math.abs(node.cur.L[f]), Math.abs(node.cur.R[f]));
    this.peaks.slots[slot.id] = peak;
    node.busy = false;
    node.done = true;
  }

  runMixer(id) {
    const m = this.cur.mixers.find((x) => x.id === id);
    const dsp = this.mixers.get(id);
    const node = dsp.node;
    node.busy = true;
    const out = node.cur;
    out.L.fill(0);
    out.R.fill(0);
    for (const ch of m.channels) {
      if (!ch.source || ch.source === 'none') continue;
      const g = dbToGain(ch.level);
      if (g === 0) continue;
      const pan = Math.min(Math.max(ch.pan, -1), 1);
      const gl = g * Math.min(1, 1 - pan);
      const gr = g * Math.min(1, 1 + pan);
      const from = this.fetch(ch.source);
      for (let f = 0; f < BLOCK; f++) {
        out.L[f] += from.L[f] * gl;
        out.R[f] += from.R[f] * gr;
      }
    }
    // Delay, then low and high cut (one-pole each).
    const d = Math.min(Math.max(m.delay, 0), 1000) * 0.001 * dsp.rate;
    const di = Math.round(d);
    const aLp = Math.exp(-2 * Math.PI * Math.min(m.high_cut, 0.45 * dsp.rate) / dsp.rate);
    const aHp = Math.exp(-2 * Math.PI * m.low_cut / dsp.rate);
    for (let f = 0; f < BLOCK; f++) {
      const io = [out.L, out.R];
      for (let c = 0; c < 2; c++) {
        dsp.dl[c][dsp.di] = io[c][f];
        let x = di > 0 ? dsp.dl[c][(dsp.di - di + dsp.len) % dsp.len] : io[c][f];
        dsp.lp[c] = x + (dsp.lp[c] - x) * aLp;
        x = dsp.lp[c];
        const y = aHp * (dsp.hpY[c] + x - dsp.hpX[c]);
        dsp.hpX[c] = x;
        dsp.hpY[c] = y;
        io[c][f] = m.low_cut > 20.5 ? y : x;
      }
      dsp.di = (dsp.di + 1) % dsp.len;
    }
    node.busy = false;
    node.done = true;
  }
}
