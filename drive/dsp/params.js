// Space Drive's controls: id (the Rust field name), Live-style label, range, default and how the
// control moves, in the same shape as Space FX's dsp/params.js. The UI and the engine read this.

export const TYPES = ['Soft', 'Diode', 'Fuzz', 'Fold'];
export const FILTER_MODES = ['LP', 'BP', 'HP'];
// Sequencer Rate when synced: beats per step.
export const RATES = [['1/32', 0.125], ['1/16T', 1 / 6], ['1/16', 0.25], ['1/8T', 1 / 3], ['1/8', 0.5], ['1/4', 1], ['1/2', 2], ['1 Bar', 4]];
export const STEP_COUNTS = Array.from({ length: 16 }, (_, i) => [String(i + 1), i + 1]);
export const STEPS = 16;
// A first pattern that moves: up and down, never twice the same.
export const STEP_DEFAULTS = [1, 0.3, 0.65, 0.1, 0.85, 0.2, 0.5, 0, 0.9, 0.4, 0.7, 0.15, 0.55, 0.25, 0.8, 0.05];

// kind: 'lin' | 'log' (continuous), 'values' (a list of [label, value]), 'choice' (index into
// labels), 'toggle'. pct shows 0..1 as a percentage; bipolar pct shows -1..1.
export const DEVICES = {
  drive: {
    name: 'Drive',
    params: [
      { id: 'type', label: 'Type', kind: 'choice', labels: TYPES, def: 0 },
      { id: 'amount', label: 'Drive', kind: 'lin', min: 0, max: 1, def: 0.5, pct: true },
      { id: 'bias', label: 'Bias', kind: 'lin', min: 0, max: 1, def: 0, pct: true },
      { id: 'tone', label: 'Tone', kind: 'lin', min: 0, max: 1, def: 0.5, pct: true },
      { id: 'output', label: 'Output', kind: 'lin', min: -24, max: 12, def: 0, unit: 'dB', digits: 1 },
      { id: 'mix', label: 'Dry/Wet', kind: 'lin', min: 0, max: 1, def: 1, pct: true },
    ],
  },
  filter: {
    name: 'Filter',
    params: [
      { id: 'mode', label: 'Mode', kind: 'choice', labels: FILTER_MODES, def: 0 },
      { id: 'cutoff', label: 'Cutoff', kind: 'log', min: 40, max: 16000, def: 600, unit: 'Hz', digits: 0 },
      { id: 'res', label: 'Res', kind: 'lin', min: 0, max: 1, def: 0.5, pct: true },
      { id: 'env', label: 'Env', kind: 'lin', min: -1, max: 1, def: 0, pct: true },
      { id: 'seq', label: 'Seq', kind: 'lin', min: -1, max: 1, def: 0.5, pct: true },
      { id: 'pre', label: 'Pre', kind: 'toggle', def: 0 },
    ],
  },
  seq: {
    name: 'Sequencer',
    params: [
      { id: 'sync', label: 'Sync', kind: 'toggle', def: 1, rerender: true },
      { id: 'rate', label: 'Rate', kind: 'values', values: RATES, def: 0.25, showIf: (p) => p.sync },
      { id: 'hz', label: 'Rate', kind: 'log', min: 0.5, max: 30, def: 8, unit: 'Hz', digits: 2, showIf: (p) => !p.sync },
      { id: 'steps', label: 'Steps', kind: 'values', values: STEP_COUNTS, def: 16 },
      { id: 'slew', label: 'Slew', kind: 'lin', min: 0, max: 1, def: 0.3, pct: true },
      { id: 'swing', label: 'Swing', kind: 'lin', min: 0, max: 1, def: 0, pct: true },
    ],
  },
};

export function defaults(type) {
  const out = {};
  for (const p of DEVICES[type].params) out[p.id] = p.def;
  if (type === 'seq') out.values = STEP_DEFAULTS.slice();
  return out;
}

export function driveState() {
  return {
    tempo: 120,
    on: { drive: true, filter: true, seq: true },
    drive: defaults('drive'),
    filter: defaults('filter'),
    seq: defaults('seq'),
  };
}

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
  if (spec.pct) return `${Math.round(v * 100)} %`;
  if (spec.unit === 'Hz' && v >= 1000) return `${(v / 1000).toFixed(2)} kHz`;
  const s = v.toFixed(spec.digits ?? 2);
  return spec.unit ? `${s} ${spec.unit}` : s;
}
