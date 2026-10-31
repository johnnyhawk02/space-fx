// A small black-and-white picture at the top of each module, drawn from its settings and its
// level: Tape's reels and echoes, Spring's coil, Phaser's sweeping notches. UI only.

const INK = '#e8e8e8';
const MID = '#8a8a8a';
const FAINT = '#4a4a4a';

// Seconds between Tape's repeats, from its settings and the tempo.
function tapeTime(p, tempo) {
  return (p.sync ?? 1) ? p.beats * 60 / tempo : (p.time_ms ?? 375) / 1000;
}

// A reel seen from the front: the wound tape (a grey pack) shows through three windows in a
// solid flange, round a hub. `angle` turns it.
function reel(g, x, y, r, pack, angle) {
  g.fillStyle = '#3a3a3a';
  g.beginPath();
  g.arc(x, y, pack, 0, Math.PI * 2);
  g.fill();
  // Flange with three windows cut out (even-odd fill leaves them open).
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  const half = (50 * Math.PI) / 360;
  for (let k = 0; k < 3; k++) {
    const a = angle + (k * Math.PI * 2) / 3;
    g.moveTo(x + Math.cos(a - half) * r * 0.36, y + Math.sin(a - half) * r * 0.36);
    g.arc(x, y, r * 0.84, a - half * 1.25, a + half * 1.25);
    g.arc(x, y, r * 0.36, a + half, a - half, true);
    g.closePath();
  }
  g.fillStyle = '#161616';
  g.fill('evenodd');
  g.strokeStyle = INK;
  g.lineWidth = 1.2;
  g.stroke();
  // Hub.
  g.fillStyle = '#161616';
  g.beginPath();
  g.arc(x, y, r * 0.24, 0, Math.PI * 2);
  g.fill();
  g.stroke();
  g.beginPath();
  g.arc(x, y, r * 0.07, 0, Math.PI * 2);
  g.stroke();
}

function tape(g, w, h, p, lvl, t, tempo, st) {
  // A simple reel-to-reel: the deck, two big reels side by side on top, the tape coming down off
  // their outer edges round two guide rollers and under the head cover. Both reels turn the same
  // way (anticlockwise), gently, at tape Speed with a little Wow, and the tape slowly spools
  // from left to right and back.
  const r = Math.min(h * 0.31, w * 0.16);
  const cy = r + 3;
  const x1 = w / 2 - r - 2;
  const x2 = w / 2 + r + 2;
  const v = (p.speed / 15) * (1 + p.wow * 0.3 * Math.sin(t * 2.1));
  st.travel = (st.travel || 0) + v * 0.35;
  st.wound = (st.wound || 0) + v * 0.0004;
  const prog = 1 - Math.abs((st.wound % 2) - 1); // 0..1..0
  const pL = r * (0.4 + 0.5 * (1 - prog));
  const pR = r * (0.4 + 0.5 * prog);
  st.aL = (st.aL || 0) - (v * 0.35) / pL;
  st.aR = (st.aR || 0) - (v * 0.35) / pR;

  // The deck behind.
  const top = cy + r * 0.35;
  const dl = x1 - r * 0.55;
  const dr = x2 + r * 0.55;
  g.strokeStyle = MID;
  g.lineWidth = 1;
  g.strokeRect(Math.round(dl) + 0.5, Math.round(top) + 0.5, Math.round(dr - dl), Math.round(h - 4 - top));

  // Guide rollers either side of the head cover, and the tape: down off each pack's outer edge,
  // round its roller, and in under the cover.
  const ry = cy + r + 12;
  const rr = 6;
  const gx1 = w / 2 - r * 1.15;
  const gx2 = w / 2 + r * 1.15;
  const tapePath = () => {
    g.beginPath();
    g.moveTo(x1 - pL, cy);
    g.lineTo(gx1 - rr, ry);
    g.arc(gx1, ry, rr, Math.PI, Math.PI / 2, true);
    g.lineTo(gx2, ry + rr);
    g.arc(gx2, ry, rr, Math.PI / 2, 0, true);
    g.lineTo(x2 + pR, cy);
  };
  g.strokeStyle = INK;
  g.lineWidth = 1.4;
  tapePath();
  g.stroke();
  g.save();
  g.strokeStyle = '#161616';
  g.setLineDash([2, 9]);
  g.lineDashOffset = -st.travel;
  tapePath();
  g.stroke();
  g.restore();

  reel(g, x1, cy, r, pL, st.aL);
  reel(g, x2, cy, r, pR, st.aR);

  // Rollers, then the head cover: a shield between them, with the capstan below.
  g.strokeStyle = INK;
  g.lineWidth = 1.2;
  g.fillStyle = '#161616';
  for (const gx of [gx1, gx2]) {
    g.beginPath();
    g.arc(gx, ry, rr, 0, Math.PI * 2);
    g.fill();
    g.stroke();
    g.beginPath();
    g.arc(gx, ry, 1.5, 0, Math.PI * 2);
    g.stroke();
  }
  const cw = r * 0.8;
  const ct = ry - 8;
  const cb = Math.min(ry + 18, h - 12);
  g.beginPath();
  g.moveTo(w / 2 - cw, ct);
  g.lineTo(w / 2 + cw, ct);
  g.lineTo(w / 2 + cw, ct + 9);
  g.lineTo(w / 2 + 6, cb);
  g.lineTo(w / 2 - 6, cb);
  g.lineTo(w / 2 - cw, ct + 9);
  g.closePath();
  g.fill();
  g.stroke();
  // The play head's lamp: lit when there's signal.
  g.fillStyle = lvl > 0.02 ? INK : FAINT;
  g.fillRect(w / 2 - 8, ct + 4, 16, 3);
  g.strokeStyle = MID;
  g.beginPath();
  g.arc(w / 2, Math.min(cb + 5, h - 7), 3, 0, Math.PI * 2);
  g.stroke();
}

function delay(g, w, h, p, lvl, t, tempo) {
  // One bar per repeat, spaced by Time, falling by Feedback, over the next two seconds; a
  // playhead goes round once per repeat.
  const left = 10;
  const right = w - 10;
  const base = h - 14;
  const span = 2.0;
  const dt = tapeTime(p, tempo);
  g.strokeStyle = FAINT;
  g.lineWidth = 1;
  g.beginPath();
  g.moveTo(left, base + 0.5);
  g.lineTo(right, base + 0.5);
  g.stroke();
  for (let s = 0; s <= span; s += 0.5) {
    const x = Math.round(left + (s / span) * (right - left)) + 0.5;
    g.beginPath();
    g.moveTo(x, base);
    g.lineTo(x, base + 4);
    g.stroke();
  }
  let amp = 1;
  for (let k = 0; k * dt <= span && amp > 0.02; k++) {
    const x = left + ((k * dt) / span) * (right - left);
    const bh = (base - 12) * Math.min(amp, 1);
    g.fillStyle = k === 0 ? FAINT : INK;
    g.fillRect(Math.round(x) - 1, base - bh, 3, bh);
    amp *= Math.min(p.feedback, 1.05);
    if (dt <= 0) break;
  }
  if (dt > 0) {
    const x = left + (((t % dt) / span) * (right - left));
    g.strokeStyle = lvl > 0.02 ? MID : FAINT;
    g.beginPath();
    g.moveTo(x + 0.5, 8);
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

const DRAW = { tape, delay, spring, phaser };

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
