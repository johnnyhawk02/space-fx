// A small black-and-white picture at the top of each module, drawn from its settings and its
// level: Tape's reels and echoes, Spring's coil, Phaser's sweeping notches. UI only.

const INK = '#e8e8e8';
const MID = '#8a8a8a';
const FAINT = '#4a4a4a';

// Seconds between Tape's repeats, from its settings and the tempo.
function tapeTime(p, tempo) {
  return (p.sync ?? 1) ? p.beats * 60 / tempo : (p.time_ms ?? 375) / 1000;
}

// A reel: the wound tape (a filled pack of radius `pack`) under the flange and three spokes.
function reel(g, x, y, r, pack, angle) {
  g.fillStyle = '#3a3a3a';
  g.beginPath();
  g.arc(x, y, pack, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = '#555';
  g.lineWidth = 0.6;
  for (let k = r * 0.3; k < pack - 1; k += 3) {
    g.beginPath();
    g.arc(x, y, k, 0, Math.PI * 2);
    g.stroke();
  }
  g.strokeStyle = INK;
  g.lineWidth = 1.25;
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
  // Two reels with tape wound on them, the tape running down round two guides, across the
  // heads and back up. It moves at tape Speed (with a little Wow), and slowly spools from the
  // left reel to the right one and back.
  const r = Math.min(h * 0.3, w * 0.13);
  const cy = h * 0.36;
  const x1 = r + 8;
  const x2 = x1 + r * 2 + 14;
  const v = (p.speed / 15) * (1 + p.wow * 0.3 * Math.sin(t * 2.1));
  st.angle = (st.angle || 0) + v * 0.05;
  st.travel = (st.travel || 0) + v * 0.8;
  st.wound = (st.wound || 0) + v * 0.0006;
  const prog = 1 - Math.abs((st.wound % 2) - 1); // 0..1..0
  const pL = r * (0.3 + 0.62 * (1 - prog));
  const pR = r * (0.3 + 0.62 * prog);
  reel(g, x1, cy, r, pL, st.angle * (r / pL) * 0.5);
  reel(g, x2, cy, r, pR, st.angle * (r / pR) * 0.5);

  // Tape path: off the left pack, round a guide, across the heads, round a guide, onto the right pack.
  const hy = h - 18;
  const g1 = x1 - r * 0.55;
  const g2 = x2 + r * 0.55;
  const gr = 3;
  g.strokeStyle = INK;
  g.lineWidth = 1.4;
  g.beginPath();
  g.moveTo(x1 - pL, cy);
  g.lineTo(g1 - gr, hy);
  g.arc(g1, hy, gr, Math.PI, Math.PI / 2, true);
  g.lineTo(g2, hy + gr);
  g.arc(g2, hy, gr, Math.PI / 2, 0, true);
  g.lineTo(x2 + pR, cy);
  g.stroke();
  // Marks on the tape, so you can see it run.
  g.save();
  g.strokeStyle = '#161616';
  g.lineWidth = 1.4;
  g.setLineDash([2, 9]);
  g.lineDashOffset = -st.travel;
  g.beginPath();
  g.moveTo(g1, hy + gr);
  g.lineTo(g2, hy + gr);
  g.stroke();
  g.restore();
  // Guides, then the heads under the tape: erase, record, play.
  g.strokeStyle = MID;
  g.lineWidth = 1;
  for (const gx of [g1, g2]) {
    g.beginPath();
    g.arc(gx, hy, gr - 1, 0, Math.PI * 2);
    g.stroke();
  }
  const hx = (x1 + x2) / 2;
  g.fillStyle = MID;
  g.fillRect(hx - 22, hy + gr + 1, 8, 7);
  g.fillRect(hx - 4, hy + gr + 1, 8, 7);
  g.fillStyle = lvl > 0.02 ? INK : MID;
  g.fillRect(hx + 14, hy + gr + 1, 8, 7);

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
  // Frequency response, 20 Hz to 20 kHz, with notches sweeping at Rate around Center, as wide
  // as Depth. Feedback sharpens them; with Spread, the right side is drawn too, dashed.
  const hz = p.sync ? tempo / 60 / Math.max(p.rate_beats, 0.0625) : p.speed;
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
  const sharp = 3 + 9 * (p.feedback ?? 0);
  const curve = (phase, dashed) => {
    const tri = (ph) => (ph < 0.65 ? ph / 0.65 : 1 - (ph - 0.65) / 0.35);
    const sweep = 2 * tri(phase) - 1;
    const fc = (p.center ?? 1663) * 2.2 ** ((p.depth ?? 0.6) / 0.6 * sweep);
    g.setLineDash(dashed ? [3, 3] : []);
    g.beginPath();
    for (let i = 0; i <= w - 8; i++) {
      const f = 20 * 1000 ** (i / (w - 8));
      let m = 1;
      for (const k of [0.45, 1, 2.2]) {
        const d = Math.log2(f / (fc * k)) * sharp;
        m *= 1 - p.mix * Math.exp(-d * d);
      }
      const y = top + (1 - m) * (bot - top);
      if (i) g.lineTo(4 + i, y);
      else g.moveTo(4 + i, y);
    }
    g.stroke();
    g.setLineDash([]);
  };
  const ph = (t * hz) % 1;
  g.lineWidth = 1.4;
  if ((p.spread ?? 0) > 0) {
    g.strokeStyle = MID;
    curve((ph + p.spread / 360) % 1, true);
  }
  g.strokeStyle = lvl > 0.02 ? INK : MID;
  curve(ph, false);
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
