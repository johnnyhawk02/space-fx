// Every device's controls: id (the Rust field name), Live-style label, range, default and how
// the control moves. The UI, the Macros and presets all read this one table.

import { LFO_SHAPES } from './lfo.js';

export const TIMES = [['1/16', 0.25], ['1/8', 0.5], ['3/16', 0.75], ['1/4', 1], ['3/8', 1.5], ['1/2', 2], ['3/4', 3], ['1 Bar', 4]];
export const SPEEDS = [['3.75 ips', 3.75], ['7.5 ips', 7.5], ['15 ips', 15], ['30 ips', 30]];

// kind: 'lin' | 'log' (continuous), 'values' (a list of [label, value]), 'choice' (index into
// labels), 'toggle'. unit is shown after the value; pct shows 0..1 as a percentage.
export const DEVICES = {
  tape: {
    name: 'Tape',
    params: [
      { id: 'beats', label: 'Time', kind: 'values', values: TIMES, def: 0.75 },
      { id: 'feedback', label: 'Feedback', kind: 'lin', min: 0, max: 1.05, def: 0.5, pct: true },
      { id: 'wow', label: 'Wow', kind: 'lin', min: 0, max: 1, def: 0.3, pct: true },
      { id: 'speed', label: 'Speed', kind: 'values', values: SPEEDS, def: 15 },
      { id: 'drive', label: 'Drive', kind: 'lin', min: 0, max: 1, def: 0.5, pct: true },
      { id: 'bias', label: 'Bias', kind: 'lin', min: 0, max: 1, def: 0.9, pct: true },
      { id: 'spacing', label: 'Spacing', kind: 'lin', min: 0, max: 30, def: 5, unit: 'um', digits: 0 },
      { id: 'lfo_shape', label: 'LFO Shape', kind: 'choice', labels: LFO_SHAPES, def: 0 },
      { id: 'lfo_rate', label: 'LFO Rate', kind: 'log', min: 0.01, max: 20, def: 0.5, unit: 'Hz', digits: 2 },
      { id: 'lfo_slow', label: 'LFO x0.01', kind: 'toggle', def: 0 },
      { id: 'lfo_depth', label: 'LFO Depth', kind: 'lin', min: 0, max: 50, def: 0, unit: 'ms', digits: 1 },
      { id: 'lfo_slew', label: 'LFO Slew', kind: 'lin', min: 0, max: 1, def: 0, pct: true },
      { id: 'mix', label: 'Dry/Wet', kind: 'lin', min: 0, max: 1, def: 0.5, pct: true },
    ],
  },
  phaser: {
    name: 'Phaser',
    params: [
      { id: 'speed', label: 'Rate', kind: 'log', min: 0.05, max: 10, def: 0.5, unit: 'Hz', digits: 2 },
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

// A Sub Mixer's own controls (its channels are handled separately).
export const MIXER_PARAMS = [
  { id: 'low_cut', label: 'Low Cut', kind: 'log', min: 20, max: 2000, def: 20, unit: 'Hz', digits: 0 },
  { id: 'high_cut', label: 'High Cut', kind: 'log', min: 500, max: 20000, def: 20000, unit: 'Hz', digits: 0 },
  { id: 'delay', label: 'Delay', kind: 'lin', min: 0, max: 1000, def: 0, unit: 'ms', digits: 0 },
];
export const CHANNEL_PARAMS = [
  { id: 'level', label: 'Level', kind: 'lin', min: -60, max: 6, def: 0, unit: 'dB', digits: 1 },
  { id: 'pan', label: 'Pan', kind: 'lin', min: -1, max: 1, def: 0, digits: 2 },
];

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
