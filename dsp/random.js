// Rand: random settings and routing, within musical limits.

import { DEVICES, fromNorm } from './params.js';
import { rackState, MODES } from './rack.js';
import { presetName } from './names.js';

// Ranges Rand keeps to (as 0..1 control positions), so it rarely makes something unusable.
const SAFE = { feedback: [0.1, 0.8], mix: [0.25, 0.7], decay: [0.3, 0.85], lfo_depth: [0, 0.3], drive: [0.1, 0.8] };

export function randomRack(rand = Math.random, taken = new Set(), tempo = 120) {
  const st = rackState();
  st.tempo = tempo;
  for (const slot of st.slots) {
    for (const spec of DEVICES[slot.type].params) {
      const [lo, hi] = SAFE[spec.id] || [0, 1];
      slot.params[spec.id] = fromNorm(spec, lo + (hi - lo) * rand());
    }
  }
  // A random Mode, and now and then some Feedback.
  st.main.mode = Math.floor(rand() * MODES.length);
  st.main.loop = rand() < 0.4 ? 0.2 + rand() * 0.4 : 0;
  st.name = presetName(taken, rand);
  return st;
}
