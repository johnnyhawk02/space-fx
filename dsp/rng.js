// The linear congruential generator Clip uses (wrapping u32), giving -1..1.
export function lcg(seed) {
  return (Math.imul(seed, 1664525) + 1013904223) >>> 0;
}

export function lcgValue(seed) {
  return (seed >>> 8) / 16777216 * 2 - 1;
}
