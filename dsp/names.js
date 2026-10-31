// Preset names: alien word fragments joined with space terms ("Xylthra Nebula").

const FRAGMENTS = ['xyl', 'vor', 'quaa', 'thra', 'zeph', 'kel', 'orr', 'ix', 'uun', 'vex', 'zaa', 'nyx',
  'ql', 'oth', 'rax', 'yth', 'eel', 'kry', 'mog', 'sha', 'tul', 'vae', 'ziq', 'aum'];
const TERMS = ['Nebula', 'Pulsar', 'Quasar', 'Perihelion', 'Redshift', 'Oort', 'Event Horizon', 'Magnetar',
  'Lagrange', 'Aphelion', 'Corona', 'Parallax', 'Ecliptic', 'Zenith', 'Nadir', 'Singularity', 'Exosphere',
  'Syzygy', 'Albedo', 'Umbra', 'Penumbra', 'Ion Drift', 'Dark Matter', 'Accretion', 'Blueshift', 'Orbit',
  'Comet', 'Meteor', 'Kuiper', 'Solstice', 'Equinox', 'Cosmic Ray', 'Wormhole', 'Supernova', 'Dwarf Star'];

const cap = (s) => s[0].toUpperCase() + s.slice(1);

function alien(rand) {
  const n = rand() < 0.6 ? 2 : 3;
  let w = '';
  for (let i = 0; i < n; i++) w += FRAGMENTS[Math.floor(rand() * FRAGMENTS.length)];
  return cap(w);
}

// A new name not in `taken` (a Set), under 24 characters. `rand` gives 0..1.
export function presetName(taken = new Set(), rand = Math.random) {
  for (let tries = 0; tries < 200; tries++) {
    const term = TERMS[Math.floor(rand() * TERMS.length)];
    const a = alien(rand);
    const pick = rand();
    let name;
    if (pick < 0.45) name = `${a} ${term}`;
    else if (pick < 0.7) name = `${term} of ${a}`;
    else if (pick < 0.85) name = `${a}-${cap(alien(rand).slice(0, 3).toLowerCase())} ${term.split(' ')[0]}`;
    else name = `${a} ${term.split(' ')[0]} ${2 + Math.floor(rand() * 98)}`;
    if (name.length <= 24 && !taken.has(name)) return name;
  }
  return `${alien(rand)} ${Date.now() % 1000}`;
}
