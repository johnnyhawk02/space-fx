// A small black-and-white picture at the top of each module, drawn from its settings and its
// level: Tape's reels and echoes, Spring's coil, Phaser's sweeping notches. UI only.

const INK = '#e8e8e8';
const MID = '#8a8a8a';
const FAINT = '#4a4a4a';

// Seconds between Tape's repeats, from its settings and the tempo.
function tapeTime(p, tempo) {
  return (p.sync ?? 1) ? p.beats * 60 / tempo : (p.time_ms ?? 375) / 1000;
}

function reel(g, x, y, r, angle) {
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.stroke();
  g.beginPath();
  g.arc(x, y, r * 0.22, 0, Math.PI * 2);
  g.stroke();
  for (let k = 0; k < 3; k++) {
    const a = angle + (k * Math.PI * 2) / 3;
    g.moveTo(x + Math.cos(a) * r * 0.22, y + Math.sin(a) * r * 0.22);
    g.lineTo(x + Math.cos(a) * r * 0.85, y + Math.sin(a) * r * 0.85);
  }
  g.stroke();
}

function tape(g, w, h, p, lvl, t, tempo, st) {
  // Reels on the left, turning at tape speed with a little wow.
  const r = Math.min(h * 0.3, w * 0.13);
  const cy = h * 0.4;
  const x1 = r + 8;
  const x2 = x1 + r * 2 + 14;
  st.angle = (st.angle || 0) + (p.speed / 15) * 0.05 * (1 + p.wow * 0.3 * Math.sin(t * 2.1));
  g.strokeStyle = INK;
  g.lineWidth = 1.25;
  reel(g, x1, cy, r, st.angle);
  reel(g, x2, cy, r, st.angle * 1.1);
  // Tape path over the head.
  const hy = h - 10;
  const hx = (x1 + x2) / 2;
  g.beginPath();
  g.moveTo(x1 - r, cy);
  g.lineTo(x1 - r, hy - 4);
  g.lineTo(x2 + r, hy - 4);
  g.lineTo(x2 + r, cy);
  g.strokeStyle = MID;
  g.stroke();
  g.fillStyle = lvl > 0.02 ? INK : FAINT;
  g.fillRect(hx - 5, hy - 3, 10, 6);

  // Echoes on the right: one bar per repeat, spaced by Time, falling by Feedback.
  const left = x2 + r + 18;
  const right = w - 6;
  const base = h - 8;
  const span = 2.0; // seconds shown
  const dt = tapeTime(p, tempo);
  g.strokeStyle = FAINT;
  g.beginPath();
  g.moveTo(left, base + 0.5);
  g.lineTo(right, base + 0.5);
  g.stroke();
  let amp = 1;
  for (let k = 0; k * dt <= span && amp > 0.02; k++) {
    const x = left + ((k * dt) / span) * (right - left);
    const bh = (base - 8) * Math.min(amp, 1);
    g.fillStyle = k === 0 ? FAINT : INK;
    g.fillRect(Math.round(x) - 1, base - bh, 2, bh);
    amp *= Math.min(p.feedback, 1.05);
    if (dt <= 0) break;
  }
  // Playhead, going round once per repeat.
  if (dt > 0) {
    const x = left + (((t % dt) / span) * (right - left));
    g.strokeStyle = lvl > 0.02 ? MID : FAINT;
    g.beginPath();
    g.moveTo(x + 0.5, 6);
    g.lineTo(x + 0.5, base);
    g.stroke();
  }
}

function spring(g, w, h, p, lvl, t, tempo, st) {
  // A coil between two mounts. Longer Length, longer coil; it shakes with the signal and
  // settles as fast as Decay lets it.
  st.shake = Math.max(lvl, (st.shake || 0) * (0.86 + p.decay * 0.13));
  const pad = 10;
  const len = (w - pad * 2) * (0.55 + 0.45 * (p.length - 20) / 100);
  const x0 = (w - len) / 2;
  const cy = h / 2;
  const turns = Math.round(7 + (p.tone - 1500) / 800);
  const r = Math.min(h * 0.2, 30);
  // Mounts, with a short straight lead from each into the coil, so the spring hangs from them.
  const lead = 8;
  g.fillStyle = MID;
  g.fillRect(x0 - lead - 3, cy - r - 6, 3, r * 2 + 12);
  g.fillRect(x0 + len + lead, cy - r - 6, 3, r * 2 + 12);
  g.strokeStyle = INK;
  g.lineWidth = 1.1;
  g.beginPath();
  g.moveTo(x0 - lead, cy);
  g.lineTo(x0, cy);
  const steps = turns * 40;
  for (let i = 0; i <= steps; i++) {
    const u = i / steps;
    const a = u * turns * Math.PI * 2;
    const wob = st.shake * h * 0.18 * Math.sin(u * Math.PI) * Math.sin(t * 40 + u * (6 + p.chirp * 12));
    // Starts and ends on the axis, exactly where the leads meet it.
    const x = x0 + u * len + (Math.cos(a) - 1) * Math.min(r * 0.35, (len / turns) * 0.4) * Math.sin(u * Math.PI);
    const y = cy + Math.sin(a) * r + wob;
    g.lineTo(x, y);
  }
  g.lineTo(x0 + len + lead, cy);
  g.stroke();
}

function phaser(g, w, h, p, lvl, t, tempo) {
  // Frequency response, 20 Hz to 20 kHz, with notches sweeping at Rate.
  const hz = p.sync ? tempo / 60 / Math.max(p.rate_beats, 0.0625) : p.speed;
  const ph = 0.5 - 0.5 * Math.cos(t * hz * Math.PI * 2);
  const fc = 80 * 25 ** ph;
  const top = 8;
  const bot = h - 8;
  g.strokeStyle = FAINT;
  g.lineWidth = 1;
  for (const f of [100, 1000, 10000]) {
    const x = 4 + (Math.log10(f / 20) / 3) * (w - 8);
    g.beginPath();
    g.moveTo(Math.round(x) + 0.5, top);
    g.lineTo(Math.round(x) + 0.5, bot);
    g.stroke();
  }
  g.strokeStyle = lvl > 0.02 ? INK : MID;
  g.lineWidth = 1.4;
  g.beginPath();
  for (let i = 0; i <= w - 8; i++) {
    const f = 20 * 1000 ** (i / (w - 8));
    let m = 1;
    for (const k of [1, 3, 9]) {
      const d = Math.log2(f / (fc * k)) * 3;
      m *= 1 - p.mix * Math.exp(-d * d);
    }
    const y = top + (1 - m) * (bot - top);
    if (i) g.lineTo(4 + i, y);
    else g.moveTo(4 + i, y);
  }
  g.stroke();
}

const DRAW = { tape, spring, phaser };

// Draw every module's picture each frame. `get()` gives the rack state and latest peaks.
export function startGraphics(get) {
  const states = new Map();
  const frame = (ms) => {
    const { state, peaks } = get();
    const t = ms / 1000;
    for (const c of document.querySelectorAll('canvas.viz')) {
      const slot = state.slots.find((s) => s.id === c.dataset.slot);
      if (!slot) continue;
      const dpr = window.devicePixelRatio || 1;
      const w = c.clientWidth;
      const h = c.clientHeight;
      if (c.width !== Math.round(w * dpr)) c.width = Math.round(w * dpr);
      if (c.height !== Math.round(h * dpr)) c.height = Math.round(h * dpr);
      const g = c.getContext('2d');
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, w, h);
      g.globalAlpha = slot.on ? 1 : 0.35;
      if (!states.has(slot.id)) states.set(slot.id, {});
      const lvl = Math.min((peaks?.slots?.[slot.id] || 0) * 2, 1);
      DRAW[slot.type](g, w, h, slot.params, slot.on ? lvl : 0, t, state.tempo || 120, states.get(slot.id));
      g.globalAlpha = 1;
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
