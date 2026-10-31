// Rand: random settings and routing, within musical limits.

import { DEVICES, fromNorm } from './params.js';
import { rackState, chainRoutes, MODULES } from './rack.js';
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
  // A chain in a random order, sometimes one module short.
  const order = [...MODULES].sort(() => rand() - 0.5);
  if (rand() < 0.25) order.pop();
  st.routes = chainRoutes(order);
  // Now and then a quiet feedback send, and a parallel send straight to Out.
  if (rand() < 0.4) st.routes[order[order.length - 1]][order[0]] = -24 + rand() * 12;
  if (rand() < 0.3) st.routes[order[0]].out = -12 + rand() * 9;
  st.name = presetName(taken, rand);
  return st;
}
