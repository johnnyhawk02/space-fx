// Rand: a random rack (slots, settings, sometimes a feedback mixer) with musical limits.

import { DEVICES, fromNorm } from './params.js';
import { patchbayState, newMixer } from './rack.js';
import { presetName } from './names.js';

// Ranges Rand keeps to (as 0..1 control positions), so it rarely makes something unusable.
const SAFE = { feedback: [0.1, 0.8], mix: [0.25, 0.7], decay: [0.3, 0.85], lfo_depth: [0, 0.3], drive: [0.1, 0.8] };

export function randomRack(rand = Math.random, taken = new Set(), tempo = 120) {
  const st = patchbayState();
  st.tempo = tempo;
  for (const slot of st.slots) {
    for (const spec of DEVICES[slot.type].params) {
      const [lo, hi] = SAFE[spec.id] || [0, 1];
      slot.params[spec.id] = fromNorm(spec, lo + (hi - lo) * rand());
    }
  }
  // A random order, and now and then one module left out.
  const order = st.slots.map((s) => s.id).sort(() => rand() - 0.5);
  if (rand() < 0.25) order.pop();
  for (const s of st.slots) s.input = 'none';
  order.forEach((id, i) => (st.slots.find((s) => s.id === id).input = i === 0 ? 'in' : `slot:${order[i - 1]}`));
  st.out = `slot:${order[order.length - 1]}`;
  // Now and then, a Sub Mixer feeding the end of the chain back into the start.
  if (rand() < 0.35) {
    const m = newMixer('A');
    m.channels[0] = { source: 'in', level: 0, pan: 0 };
    m.channels[1] = { source: st.out, level: -12 - rand() * 12, pan: 0 };
    m.high_cut = 3000 + rand() * 6000;
    m.low_cut = 80 + rand() * 200;
    m.delay = Math.round(rand() * 300);
    st.mixers.push(m);
    st.slots.find((s) => s.id === order[0]).input = 'mix:A';
  }
  st.name = presetName(taken, rand);
  return st;
}
