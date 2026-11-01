// The black-and-white pictures on top of each card, as in Space FX: Drive's wave being clipped,
// Filter's response where the Cutoff is right now, and the Sequencer's steps with the slewed
// line through them and the playhead. UI only.

import { CURVES, driveGain, biasOffset, makeup } from '../dsp/shaper.js';
import { damping, modCutoff } from '../dsp/autofilter.js';
import { locate, glide } from '../dsp/sequencer.js';
import { STEPS } from '../dsp/params.js';

const INK = '#e8e8e8';
const MID = '#8a8a8a';
const FAINT = '#4a4a4a';
const PACK = '#3a3a3a';

// Drive: two cycles of a sine (dashed) and what the Type makes of it, drifting slowly.
function drive(g, w, h, p, lvl, t) {
  const { f } = CURVES[p.type];
  const gain = driveGain(p.amount);
  const b = biasOffset(p.bias);
  const fb = f(b);
  const out = makeup(p.type, gain) * 10 ** (p.output / 20);
  const cy = h / 2;
  const amp = h * 0.36;
  const x0 = 6;
  const span = w - 12;
  const ph = t * 0.6;
  g.strokeStyle = FAINT;
  g.lineWidth = 1;
  g.beginPath();
  g.moveTo(x0, Math.round(cy) + 0.5);
  g.lineTo(x0 + span, Math.round(cy) + 0.5);
  g.stroke();
  const wave = (shape) => {
    g.beginPath();
    for (let i = 0; i <= span; i++) {
      const v = shape(0.5 * Math.sin((i / span) * 4 * Math.PI + ph));
      const y = cy - Math.max(Math.min(v * 2, 1.1), -1.1) * amp;
      if (i) g.lineTo(x0 + i, y);
      else g.moveTo(x0 + i, y);
    }
    g.stroke();
  };
  g.setLineDash([2, 3]);
  g.strokeStyle = MID;
  wave((x) => x);
  g.setLineDash([]);
  g.strokeStyle = lvl > 0.02 ? INK : '#c8c8c8';
  g.lineWidth = 1.4;
  const mix = p.mix;
  wave((x) => x * (1 - mix) + (f(x * gain + b) - fb) * out * mix);
}

// The filter's magnitude at f Hz with its Cutoff at fc.
function response(mode, k, f, fc) {
  const v = f / fc;
  const den = Math.hypot(1 - v * v, k * v);
  const lp = Math.sqrt(k / 2);
  return mode === 0 ? lp / den : mode === 1 ? (k * v) / den : (lp * v * v) / den;
}

function filter(g, w, h, p, fc, lvl) {
  const k = damping(p.res);
  const top = 8;
  const bot = h - 8;
  const yOf = (db) => top + ((18 - Math.min(Math.max(db, -36), 18)) / 54) * (bot - top);
  const xOf = (f) => 6 + (Math.log(f / 20) / Math.log(1000)) * (w - 12);
  g.strokeStyle = FAINT;
  g.lineWidth = 1;
  for (const f of [100, 1000, 10000]) {
    g.beginPath();
    g.moveTo(Math.round(xOf(f)) + 0.5, top);
    g.lineTo(Math.round(xOf(f)) + 0.5, bot);
    g.stroke();
  }
  g.setLineDash([2, 3]);
  g.beginPath();
  g.moveTo(6, Math.round(yOf(0)) + 0.5);
  g.lineTo(w - 6, Math.round(yOf(0)) + 0.5);
  g.stroke();
  // Where the Cutoff dial is, before the Sequencer and Env move it.
  g.strokeStyle = MID;
  g.beginPath();
  g.moveTo(Math.round(xOf(p.cutoff)) + 0.5, top);
  g.lineTo(Math.round(xOf(p.cutoff)) + 0.5, bot);
  g.stroke();
  g.setLineDash([]);
  g.strokeStyle = lvl > 0.02 ? INK : '#c8c8c8';
  g.lineWidth = 1.4;
  g.beginPath();
  const n = w - 12;
  for (let i = 0; i <= n; i++) {
    const f = 20 * 1000 ** (i / n);
    const y = yOf(20 * Math.log10(Math.max(response(p.mode, k, f, fc), 1e-6)));
    if (i) g.lineTo(6 + i, y);
    else g.moveTo(6 + i, y);
  }
  g.stroke();
}

// The Sequencer picture's layout: 16 bars, the ones past Steps faint. Swing moves the odd
// steps' left edges.
const PAD = 6;
function bars(w, h, swing) {
  const bw = (w - PAD * 2) / STEPS;
  const split = 1 + swing / 3;
  const start = (i) => Math.floor(i / 2) * 2 + (i % 2 ? split : 0);
  return { bw, top: PAD + 2, bot: h - PAD, xOf: (pos) => PAD + pos * bw, start };
}

// Which step and level a point in the picture is, for drawing the steps with the mouse.
export function seqHit(x, y, w, h, count) {
  const { bw, top, bot } = bars(w, h, 0);
  const step = Math.floor((x - PAD) / bw);
  if (step < 0 || step >= STEPS) return null;
  const value = Math.min(Math.max((bot - y) / (bot - top), 0), 1);
  return { step, value: Math.round(value * 100) / 100, active: step < count };
}

function seq(g, w, h, p, m, on) {
  const count = p.steps;
  const swing = p.swing;
  const { top, bot, xOf, start } = bars(w, h, swing);
  const yOf = (v) => bot - v * (bot - top);
  const playing = on && m;
  const cur = playing ? ((Math.floor(m.step) % count) + count) % count : -1;
  for (let i = 0; i < STEPS; i++) {
    const x1 = xOf(start(i)) + 1;
    const x2 = xOf(i + 1 < STEPS ? start(i + 1) : STEPS) - 1;
    const v = p.values[i];
    const active = i < count;
    g.fillStyle = !active ? '#222' : i === cur ? '#5a5a5a' : PACK;
    g.fillRect(x1, yOf(v), x2 - x1, bot - yOf(v));
    g.strokeStyle = active ? (i === cur ? INK : MID) : FAINT;
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(x1, Math.round(yOf(v)) + 0.5);
    g.lineTo(x2, Math.round(yOf(v)) + 0.5);
    g.stroke();
  }
  // The line the Filter follows: each step glides in from the one before over Slew of its length.
  g.strokeStyle = INK;
  g.lineWidth = 1.4;
  g.beginPath();
  const x0 = xOf(0);
  const span = xOf(count) - x0;
  for (let i = 0; i <= span; i++) {
    const [step, u] = locate((i / span) * count - 1e-9 * (i === span), swing);
    const idx = Math.min(step, count - 1);
    const from = p.values[(idx + count - 1) % count];
    const to = p.values[idx];
    const v = p.slew > 0 && u < p.slew ? from + (to - from) * glide(u / p.slew) : to;
    if (i) g.lineTo(x0 + i, yOf(v));
    else g.moveTo(x0 + i, yOf(v));
  }
  g.stroke();
  if (playing) {
    const pos = ((m.pos % count) + count) % count;
    const x = xOf(pos);
    g.fillStyle = INK;
    g.beginPath();
    g.arc(x, yOf(m.seqOut), 3, 0, Math.PI * 2);
    g.fill();
  }
}

export function startGraphics(get) {
  const frame = (ms) => {
    const { state, meter } = get();
    const t = ms / 1000;
    const fresh = meter && performance.now() - (meter.at || 0) < 400 ? meter : null;
    for (const c of document.querySelectorAll('canvas.viz')) {
      const type = c.dataset.slot;
      const dpr = window.devicePixelRatio || 1;
      const w = c.clientWidth;
      const h = c.clientHeight;
      if (c.width !== Math.round(w * dpr)) c.width = Math.round(w * dpr);
      if (c.height !== Math.round(h * dpr)) c.height = Math.round(h * dpr);
      const g = c.getContext('2d');
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, w, h);
      const on = state.on[type];
      g.globalAlpha = on ? 1 : 0.35;
      const lvl = fresh ? Math.min(fresh.level * 2, 1) : 0;
      if (type === 'drive') drive(g, w, h, state.drive, lvl, t);
      else if (type === 'filter') {
        const fc = fresh && on ? fresh.cutoff : modCutoff(state.filter, state.on.seq ? state.seq.values[0] : 0, 0, 44100);
        filter(g, w, h, state.filter, fc, lvl);
      } else seq(g, w, h, state.seq, fresh, on);
      g.globalAlpha = 1;
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
