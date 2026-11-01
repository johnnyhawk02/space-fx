// Every device's controls: id (the Rust field name), Live-style label, range, default and how
// the control moves. The UI, the Macros and presets all read this one table.

import { LFO_SHAPES } from './lfo.js';
import { FILTER_MODES } from './filter.js';

export const TIMES = [['1/16', 0.25], ['1/8', 0.5], ['3/16', 0.75], ['1/4', 1], ['3/8', 1.5], ['1/2', 2], ['3/4', 3], ['1 Bar', 4]];
// Phaser Rate when synced: one sweep every so many beats.
export const RATES = [['8 Bars', 32], ['4 Bars', 16], ['2 Bars', 8], ['1 Bar', 4], ['1/2', 2], ['1/4', 1], ['1/8', 0.5], ['1/16', 0.25]];
export const SPEEDS = [['3.75 ips', 3.75], ['7.5 ips', 7.5], ['15 ips', 15], ['30 ips', 30]];

// kind: 'lin' | 'log' (continuous), 'values' (a list of [label, value]), 'choice' (index into
// labels), 'toggle'. unit is shown after the value; pct shows 0..1 as a percentage.
export const DEVICES = {
  tape: {
    name: 'Tape',
    params: [
      { group: 'Tape', id: 'drive', label: 'Drive', kind: 'lin', min: 0, max: 1, def: 0.5, pct: true },
      { group: 'Tape', id: 'bias', label: 'Bias', kind: 'lin', min: 0, max: 1, def: 0.9, pct: true },
      { group: 'Tape', id: 'speed', label: 'Speed', kind: 'values', values: SPEEDS, def: 15 },
      { group: 'Tape', id: 'spacing', label: 'Spacing', kind: 'lin', min: 0, max: 30, def: 5, unit: 'um', digits: 0 },
      { group: 'Tape', id: 'mix', label: 'Dry/Wet', kind: 'lin', min: 0, max: 1, def: 0.5, pct: true },
      { group: 'Wobble', id: 'wow', label: 'Wow', kind: 'lin', min: 0, max: 1, def: 0.3, pct: true },
      { group: 'Wobble', id: 'lfo_shape', short: 'Shape', label: 'LFO Shape', kind: 'choice', labels: LFO_SHAPES, def: 0 },
      { group: 'Wobble', id: 'lfo_rate', short: 'Rate', label: 'LFO Rate', kind: 'log', min: 0.01, max: 20, def: 0.5, unit: 'Hz', digits: 2 },
      { group: 'Wobble', id: 'lfo_slow', label: 'x0.01', kind: 'toggle', def: 0 },
      { group: 'Wobble', id: 'lfo_depth', short: 'Depth', label: 'LFO Depth', kind: 'lin', min: 0, max: 50, def: 0, unit: 'ms', digits: 1 },
      { group: 'Wobble', id: 'lfo_slew', short: 'Slew', label: 'LFO Slew', kind: 'lin', min: 0, max: 1, def: 0, pct: true },
    ],
  },
  filter: {
    name: 'Filter',
    params: [
      { id: 'mode', label: 'Mode', kind: 'values', values: FILTER_MODES, def: 0 },
      { id: 'cutoff', label: 'Cutoff', kind: 'log', min: 30, max: 12000, def: 1500, unit: 'Hz', digits: 0 },
      { id: 'resonance', label: 'Res', kind: 'lin', min: 0, max: 1, def: 0.5, pct: true },
      { id: 'drive', label: 'Drive', kind: 'lin', min: 0, max: 1, def: 0.3, pct: true },
      { id: 'env', label: 'Env', kind: 'lin', min: 0, max: 1, def: 0, pct: true },
      { id: 'mix', label: 'Dry/Wet', kind: 'lin', min: 0, max: 1, def: 0.5, pct: true },
    ],
  },
  delay: {
    name: 'Delay',
    params: [
      { id: 'sync', label: 'Sync', kind: 'toggle', def: 1, rerender: true },
      { id: 'beats', label: 'Time', kind: 'values', values: TIMES, def: 0.75, showIf: (p) => p.sync },
      { id: 'time_ms', label: 'Time', kind: 'log', min: 10, max: 2000, def: 375, unit: 'ms', digits: 0, showIf: (p) => !p.sync },
      { id: 'pingpong', label: 'Ping Pong', kind: 'toggle', def: 0 },
      { id: 'mix', label: 'Dry/Wet', kind: 'lin', min: 0, max: 1, def: 0.5, pct: true },
    ],
  },
  phaser: {
    name: 'Phaser',
    params: [
      { id: 'sync', label: 'Sync', kind: 'toggle', def: 0, rerender: true },
      { id: 'speed', label: 'Rate', kind: 'log', min: 0.05, max: 10, def: 0.5, unit: 'Hz', digits: 2, showIf: (p) => !p.sync },
      { id: 'rate_beats', label: 'Rate', kind: 'values', values: RATES, def: 8, showIf: (p) => p.sync },
      { id: 'depth', label: 'Depth', kind: 'lin', min: 0, max: 1, def: 0.6, pct: true },
      { id: 'center', label: 'Center', kind: 'log', min: 200, max: 4500, def: 1663, unit: 'Hz', digits: 0 },
      { id: 'feedback', label: 'Feedback', kind: 'lin', min: 0, max: 0.9, def: 0, pct: true },
      { id: 'spread', label: 'Spread', kind: 'lin', min: 0, max: 180, def: 0, unit: '°', digits: 0 },
      { id: 'mix', label: 'Dry/Wet', kind: 'lin', min: 0, max: 1, def: 0.5, pct: true },
    ],
  },
  spring: {
    name: 'Spring',
    params: [
      { id: 'length', label: 'Length', kind: 'lin', min: 20, max: 120, def: 56, unit: 'ms', digits: 0 },
      { id: 'decay', label: 'Decay', kind: 'lin', min: 0, max: 1, def: 0.7, pct: true },
      { id: 'tone', label: 'Tone', kind: 'log', min: 1500, max: 7000, def: 4300, unit: 'Hz', digits: 0 },
      { id: 'chirp', label: 'Chirp', kind: 'lin', min: 0, max: 1, def: 0.6, pct: true },
      { id: 'mix', label: 'Dry/Wet', kind: 'lin', min: 0, max: 1, def: 0.5, pct: true },
    ],
  },
};

// A send in the routing grid: how much of one module's output goes into another's input.
export const ROUTE_SPEC = { id: 'send', label: 'Send', kind: 'lin', min: -60, max: 6, def: -60, unit: 'dB', digits: 1 };

export function defaults(type) {
  const out = {};
  for (const p of DEVICES[type].params) out[p.id] = p.def;
  return out;
}

// A control's position (0..1) to its value, and back.
export function fromNorm(spec, x) {
  x = Math.min(Math.max(x, 0), 1);
  switch (spec.kind) {
    case 'log': return spec.min * (spec.max / spec.min) ** x;
    case 'values': return spec.values[Math.min(Math.round(x * (spec.values.length - 1)), spec.values.length - 1)][1];
    case 'choice': return Math.min(Math.round(x * (spec.labels.length - 1)), spec.labels.length - 1);
    case 'toggle': return x >= 0.5 ? 1 : 0;
    default: return spec.min + (spec.max - spec.min) * x;
  }
}

export function toNorm(spec, v) {
  switch (spec.kind) {
    case 'log': return Math.log(v / spec.min) / Math.log(spec.max / spec.min);
    case 'values': {
      const i = spec.values.findIndex(([, w]) => w === v);
      return Math.max(i, 0) / (spec.values.length - 1);
    }
    case 'choice': return v / (spec.labels.length - 1);
    case 'toggle': return v ? 1 : 0;
    default: return (v - spec.min) / (spec.max - spec.min);
  }
}

export function format(spec, v) {
  switch (spec.kind) {
    case 'values': return (spec.values.find(([, w]) => w === v) || spec.values[0])[0];
    case 'choice': return spec.labels[v] ?? '';
    case 'toggle': return v ? 'On' : 'Off';
  }
  if (spec.id === 'pan') return Math.abs(v) < 0.005 ? 'C' : `${Math.round(Math.abs(v) * 50)}${v < 0 ? 'L' : 'R'}`;
  if (spec.pct) return `${Math.round(v * 100)} %`;
  if (spec.unit === 'dB' && v <= spec.min) return '-inf dB';
  if (spec.unit === 'Hz' && v >= 1000) return `${(v / 1000).toFixed(2)} kHz`;
  const s = v.toFixed(spec.digits ?? 2);
  return spec.unit ? `${s} ${spec.unit}` : s;
}
