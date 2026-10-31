// Rand: a random rack (slots, settings, sometimes a feedback mixer) with musical limits.

import { DEVICES, fromNorm } from './params.js';
import { emptyState, newSlot, newMixer } from './rack.js';
import { presetName } from './names.js';

const TYPES = ['tape', 'phaser', 'spring'];

// Ranges Rand keeps to (as 0..1 control positions), so it rarely makes something unusable.
const SAFE = { feedback: [0.1, 0.8], mix: [0.25, 0.7], decay: [0.3, 0.85], lfo_depth: [0, 0.3], drive: [0.1, 0.8] };

export function randomRack(rand = Math.random, taken = new Set(), tempo = 120) {
  const st = emptyState();
  st.tempo = tempo;
  const count = 2 + Math.floor(rand() * 3);
  for (let i = 0; i < 4; i++) {
    if (i >= count) continue;
    const type = TYPES[Math.floor(rand() * TYPES.length)];
    const slot = newSlot(st.slots[i].id, type);
    for (const spec of DEVICES[type].params) {
      const [lo, hi] = SAFE[spec.id] || [0, 1];
      slot.params[spec.id] = fromNorm(spec, lo + (hi - lo) * rand());
    }
    st.slots[i] = slot;
  }
  // Now and then, a Sub Mixer feeding the last slot back into the first.
  if (rand() < 0.35) {
    const m = newMixer('A');
    m.channels[0] = { source: 'in', level: 0, pan: 0 };
    m.channels[1] = { source: `slot:${st.slots[count - 1].id}`, level: -12 - rand() * 12, pan: 0 };
    m.high_cut = 3000 + rand() * 6000;
    m.low_cut = 80 + rand() * 200;
    m.delay = Math.round(rand() * 300);
    st.mixers.push(m);
    st.slots[0].input = 'mix:A';
  }
  st.name = presetName(taken, rand);
  return st;
}
