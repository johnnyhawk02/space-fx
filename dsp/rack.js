// The rack: Tape, Filter, Delay, Spring and Phaser, routed by a grid of send levels. Every module's output can
// go to every module's input (a 3 x 3 grid, the diagonal being a module fed back into itself),
// Rack In can go to any module, and any module can go to Rack Out. Plus 8 Macros, Main Dry/Wet
// and a safety limiter. Plain JS with no DOM or Web Audio, so the same code runs in the
// AudioWorklet, in Node and later behind a VST3.
//
// Modules run in the order the sends say (anything a module listens to runs before it). A send
// that closes a loop can't be worked out yet, so it uses the block before: that's feedback,
// 64 frames late, and it goes through a soft clipper.

import { Tape } from './tape.js';
import { Delay } from './delay.js';
import { Filter } from './filter.js';
import { Phaser } from './phaser.js';
import { Spring } from './spring.js';
import { DEVICES, defaults, fromNorm, ROUTE_SPEC } from './params.js';

export const BLOCK = 64;
export const MACROS = 8;
export const MODULES = ['tape', 'filter', 'delay', 'spring', 'phaser'];
export const SOURCES = ['in', ...MODULES];
export const DESTS = [...MODULES, 'out'];
export const OFF = -60; // dB: the bottom of a send dial, silent

const EFFECTS = { tape: Tape, filter: Filter, delay: Delay, phaser: Phaser, spring: Spring };

// The routing Modes: a few clearly different shapes instead of a grid of sends.
// Feedback sends whatever reaches Rack Out back into the start, through a soft clipper.
export const MODES = [
  { label: 'Series', order: ['tape', 'filter', 'delay', 'phaser'] },   // tape, filter, echoes, sweep
  { label: 'Reverse', order: ['phaser', 'delay', 'filter', 'tape'] },  // the sweep gets echoed and filtered
  { label: 'Parallel', parallel: true },                                // the four side by side
  { label: 'Echo + Verb', order: ['tape', 'delay'] },                  // no Filter or Phaser
];
// In every Mode the Spring comes last, after the Feedback loop, just before the output.
export const TAIL = 'spring';
export const MAIN_SPECS = {
  mode: { id: 'mode', label: 'Mode', kind: 'values', values: MODES.map((m, i) => [m.label, i]), def: 0 },
  loop: { id: 'loop', label: 'Feedback', kind: 'lin', min: 0, max: 1, def: 0, pct: true },
  dryWet: { id: 'dryWet', label: 'Dry/Wet', kind: 'lin', min: 0, max: 1, def: 1, pct: true },
  volume: { id: 'volume', label: 'Volume', kind: 'lin', min: -60, max: 6, def: 0, unit: 'dB', digits: 1 },
};

// No sends at all.
export function emptyRoutes() {
  const r = {};
  for (const s of SOURCES) {
    r[s] = {};
    for (const d of DESTS) if (!(s === 'in' && d === 'out')) r[s][d] = OFF;
  }
  return r;
}

// A chain through `order` (module names): In to the first, each to the next, the last to Out.
export function chainRoutes(order) {
  const r = emptyRoutes();
  if (!order.length) return r;
  r.in[order[0]] = 0;
  for (let i = 1; i < order.length; i++) r[order[i - 1]][order[i]] = 0;
  r[order[order.length - 1]].out = 0;
  return r;
}

// The sends a Mode makes: the Mode's modules, then the Spring, then Out. Feedback (0..1) goes
// from the end of the modules back to their start (in Parallel, each module back into itself),
// up to -3 dB, so the Spring sits outside the loop.
export function modeRoutes(mode, loop = 0) {
  const m = MODES[Math.round(mode)] || MODES[0];
  const fb = loop > 0 ? 20 * Math.log10(loop * 0.7) : OFF;
  if (m.parallel) {
    const r = emptyRoutes();
    for (const t of MODULES) {
      if (t === TAIL) continue;
      r.in[t] = 0;
      r[t][TAIL] = -6;
      r[t][t] = fb;
    }
    r[TAIL].out = 0;
    return r;
  }
  const r = chainRoutes([...m.order, TAIL]);
  r[m.order[m.order.length - 1]][m.order[0]] = fb;
  return r;
}

export function rackState() {
  return {
    tempo: 120,
    slots: MODULES.map((t) => ({ id: t, type: t, on: true, params: defaults(t) })),
    routes: chainRoutes(MODULES),
    macros: Array.from({ length: MACROS }, (_, i) => ({ name: `Macro ${i + 1}`, value: 0, maps: [] })),
    main: { mode: 0, loop: 0, dryWet: 1, volume: 0 },
  };
}

// Make any saved state a grid rack, keeping settings, and turning older patches (slot inputs,
// cables, Sub Mixers) into sends where they can be.
// Racks from before Delay was split out of Tape: give them a Delay module carrying Tape's old
// echo settings (Time, Sync, and its Dry/Wet), in the same Mode. Its old Feedback is dropped.
const DELAY_KEYS = ['sync', 'beats', 'time_ms'];
function addDelay(st) {
  if (!st.slots || st.slots.some((s) => s.type === 'delay')) return st;
  const tape = st.slots.find((s) => s.type === 'tape');
  if (!tape) return st;
  const params = defaults('delay');
  for (const k of DELAY_KEYS) if (k in tape.params) params[k] = tape.params[k];
  if ('mix' in tape.params) params.mix = tape.params.mix;
  const tapeParams = { ...tape.params };
  for (const k of [...DELAY_KEYS, 'feedback']) delete tapeParams[k];
  const slots = st.slots.map((s) => (s === tape ? { ...s, params: tapeParams } : s));
  slots.splice(slots.indexOf(slots.find((s) => s.type === 'tape')) + 1, 0, { id: 'delay', type: 'delay', on: tape.on !== false, params });
  const main = st.main ? { ...st.main, mode: st.main.mode ?? 0 } : st.main;
  return { ...st, slots, main, routes: st.routes ? modeRoutes(main?.mode ?? 0, main?.loop ?? 0) : st.routes };
}

// Racks from before the Filter: add one after Tape, switched off so they sound as they did.
function addFilter(st) {
  if (!st.slots || st.slots.some((s) => s.type === 'filter') || !st.slots.some((s) => s.type === 'tape')) return st;
  const slots = [...st.slots];
  slots.splice(slots.findIndex((s) => s.type === 'tape') + 1, 0, { id: 'filter', type: 'filter', on: false, params: defaults('filter') });
  return { ...st, slots, routes: st.routes ? modeRoutes(st.main?.mode ?? 0, st.main?.loop ?? 0) : st.routes };
}

export function toRack(st) {
  st = addFilter(addDelay(st));
  // Every module there once, just in another order: put them in the usual order.
  const ids = st.slots?.map((s) => s.id) || [];
  if (ids.length === MODULES.length && MODULES.every((m) => ids.includes(m)) && st.slots.every((s) => s.id === s.type)) {
    st = { ...st, slots: MODULES.map((m) => st.slots.find((s) => s.id === m)) };
  }
  if (st.routes && st.slots?.length === MODULES.length && st.slots.every((s, i) => s.id === MODULES[i])) {
    // Racks from before Modes start in Series.
    if (st.main && !('mode' in st.main)) st.main = { ...st.main, mode: 0, loop: 0 };
    return st;
  }
  const out = rackState();
  out.name = st.name;
  out.tempo = st.tempo ?? 120;
  out.main = { ...out.main, ...st.main, mode: 0, loop: 0 };
  const filled = (st.slots || []).filter((s) => s.type);
  const typeOf = new Map(filled.map((s) => [s.id, s.type]));
  for (const m of out.slots) {
    const from = filled.find((s) => s.type === m.type);
    if (from) {
      m.params = { ...m.params, ...from.params };
      m.on = from.on;
    }
  }
  const routes = emptyRoutes();
  const srcOf = (src, i) => {
    if (!src || src === 'auto') return i > 0 ? typeOf.get(st.slots[i - 1]?.id) || 'in' : 'in';
    if (src === 'in') return 'in';
    if (src.startsWith('slot:')) return typeOf.get(src.slice(5)) || null;
    return null;
  };
  const mixers = new Map((st.mixers || []).map((m) => [`mix:${m.id}`, m]));
  const feed = (src, dst, db, i) => {
    if (src?.startsWith('mix:')) {
      for (const c of mixers.get(src)?.channels || []) feed(c.source, dst, Math.min(db + (c.level ?? 0), 6), -1);
      return;
    }
    const from = srcOf(src, i);
    if (from && routes[from] && dst in routes[from]) routes[from][dst] = Math.max(routes[from][dst], db);
  };
  let any = false;
  (st.slots || []).forEach((s, i) => {
    if (!s.type) return;
    feed(s.input, s.type, 0, i);
    any = true;
  });
  const lastType = [...filled].reverse()[0]?.type;
  feed(!st.out || st.out === 'auto' ? (lastType ? `slot:${filled[filled.length - 1].id}` : 'in') : st.out, 'out', 0, -1);
  out.routes = any ? routes : chainRoutes(MODULES);
  out.macros = (st.macros || out.macros).map((mc) => ({
    ...mc,
    maps: mc.maps.filter((x) => (x.target === 'slot' ? typeOf.get(x.slot) : x.target !== 'mixer')).map((x) => (x.target === 'slot' ? { ...x, slot: typeOf.get(x.slot) } : x)),
  }));
  return out;
}

const dbToGain = (db) => (db <= OFF ? 0 : 10 ** (db / 20));

class Buf {
  constructor() {
    this.L = new Float32Array(BLOCK);
    this.R = new Float32Array(BLOCK);
  }
}

// Module indices in the order the sends need them.
function runOrder(slots, gains) {
  const order = [];
  const seen = new Set();
  const visit = (i) => {
    if (seen.has(i)) return;
    seen.add(i);
    slots.forEach((s, j) => {
      if (j !== i && gains[s.id][slots[i].id] > 0) visit(j);
    });
    order.push(i);
  };
  slots.forEach((s, i) => {
    if (gains[s.id].out > 0) visit(i);
  });
  slots.forEach((_, i) => visit(i));
  return order;
}

export class Rack {
  constructor(sampleRate) {
    this.rate = sampleRate;
    this.effects = new Map();
    this.cur = new Map();
    this.prev = new Map();
    this.done = new Set();
    this.inBuf = new Buf();
    this.outBuf = new Buf();
    this.limGain = 1;
    this.inL = new Float32Array(BLOCK);
    this.inR = new Float32Array(BLOCK);
    this.peaks = { slots: {}, out: 0 };
    this.setState(rackState());
  }

  setState(state) {
    this.state = toRack(state);
    for (const s of this.state.slots) {
      if (!this.effects.has(s.id)) {
        this.effects.set(s.id, new EFFECTS[s.type](this.rate));
        this.cur.set(s.id, new Buf());
        this.prev.set(s.id, new Buf());
      }
    }
  }

  // Clear every tail.
  reset() {
    this.effects.clear();
    this.cur.clear();
    this.prev.clear();
    this.limGain = 1;
    this.setState(this.state);
  }

  // Settings and send gains after the Macros.
  resolved() {
    const st = this.state;
    const slots = st.slots.map((s) => ({ ...s, params: { ...s.params } }));
    const main = { ...st.main };
    // Macros on Mode or Feedback first, since they decide the sends.
    for (const macro of st.macros) {
      for (const map of macro.maps) {
        if (map.target === 'main' && MAIN_SPECS[map.param] && map.param !== 'dryWet') {
          main[map.param] = fromNorm(MAIN_SPECS[map.param], map.min + (map.max - map.min) * macro.value);
        }
      }
    }
    // A Mode makes the sends; `mode: null` keeps hand-made sends (tests, and the engine underneath).
    const base = main.mode == null ? st.routes : modeRoutes(main.mode, main.loop);
    const routes = {};
    for (const s of SOURCES) routes[s] = { ...base[s] };
    for (const macro of st.macros) {
      for (const map of macro.maps) {
        const v = map.min + (map.max - map.min) * macro.value;
        if (map.target === 'slot') {
          const s = slots.find((x) => x.id === map.slot);
          const spec = s && DEVICES[s.type].params.find((p) => p.id === map.param);
          if (spec) s.params[map.param] = fromNorm(spec, v);
        } else if (map.target === 'route') {
          if (routes[map.src] && map.dst in routes[map.src]) routes[map.src][map.dst] = fromNorm(ROUTE_SPEC, v);
        } else if (map.target === 'main' && map.param === 'dryWet') {
          main.dryWet = v;
        }
      }
    }
    const gains = {};
    for (const s of SOURCES) {
      gains[s] = {};
      for (const d of Object.keys(routes[s])) gains[s][d] = dbToGain(routes[s][d]);
    }
    return { slots, gains, main };
  }

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
    const { slots, gains, main } = this.resolved();
    for (const s of slots) {
      const t = this.prev.get(s.id);
      this.prev.set(s.id, this.cur.get(s.id));
      this.cur.set(s.id, t);
    }
    this.done.clear();
    const beat = this.rate * 60 / Math.max(this.state.tempo || 120, 1);

    for (const i of runOrder(slots, gains)) {
      const slot = slots[i];
      const buf = this.cur.get(slot.id);
      const gIn = gains.in[slot.id];
      for (let f = 0; f < BLOCK; f++) {
        buf.L[f] = this.inL[f] * gIn;
        buf.R[f] = this.inR[f] * gIn;
      }
      for (const src of slots) {
        const g = gains[src.id][slot.id];
        if (!(g > 0)) continue;
        if (this.done.has(src.id)) {
          const b = this.cur.get(src.id);
          for (let f = 0; f < BLOCK; f++) {
            buf.L[f] += b.L[f] * g;
            buf.R[f] += b.R[f] * g;
          }
        } else {
          // Feedback: last block's output, soft clipped.
          const b = this.prev.get(src.id);
          for (let f = 0; f < BLOCK; f++) {
            buf.L[f] += Math.tanh(b.L[f]) * g;
            buf.R[f] += Math.tanh(b.R[f]) * g;
          }
        }
      }
      if (slot.on) this.effects.get(slot.id).process(buf.L, buf.R, BLOCK, slot.params, beat);
      let peak = 0;
      for (let f = 0; f < BLOCK; f++) peak = Math.max(peak, Math.abs(buf.L[f]), Math.abs(buf.R[f]));
      this.peaks.slots[slot.id] = peak;
      this.done.add(slot.id);
    }

    // Rack Out: the modules' sends to Out, against the dry input by Main Dry/Wet.
    const out = this.outBuf;
    out.L.fill(0);
    out.R.fill(0);
    for (const s of slots) {
      const g = gains[s.id].out;
      if (!(g > 0)) continue;
      const b = this.cur.get(s.id);
      for (let f = 0; f < BLOCK; f++) {
        out.L[f] += b.L[f] * g;
        out.R[f] += b.R[f] * g;
      }
    }
    const dw = Math.min(Math.max(main.dryWet, 0), 1);
    const vol = dbToGain(main.volume ?? 0);
    const ceiling = 0.966;
    const rel = Math.exp(-1 / (0.1 * this.rate));
    let peak = 0;
    let bad = false;
    for (let f = 0; f < BLOCK; f++) {
      let l = (this.inL[f] * (1 - dw) + out.L[f] * dw) * vol;
      let r = (this.inR[f] * (1 - dw) + out.R[f] * dw) * vol;
      if (!Number.isFinite(l) || !Number.isFinite(r)) {
        l = r = 0;
        bad = true;
      }
      // Limiter: instant attack, 100 ms release.
      const a = Math.max(Math.abs(l), Math.abs(r));
      const want = a > ceiling ? ceiling / a : 1;
      this.limGain = want < this.limGain ? want : want + (this.limGain - want) * rel;
      out.L[f] = Math.max(-1, Math.min(1, l * this.limGain));
      out.R[f] = Math.max(-1, Math.min(1, r * this.limGain));
      peak = Math.max(peak, Math.abs(out.L[f]), Math.abs(out.R[f]));
    }
    if (bad) this.reset();
    this.peaks.out = peak;
  }
}
