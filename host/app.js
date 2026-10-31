// The browser host: load a file, play it through the rack, edit the rack, export the result.
// All DOM code lives here; the sound is made by dsp/ inside the AudioWorklet.

import { DEVICES, fromNorm, toNorm, format } from '../dsp/params.js';
import { rackState, toRack, MODES, MAIN_SPECS } from '../dsp/rack.js';
import { presetName } from '../dsp/names.js';
import { randomRack } from '../dsp/random.js';
import { encodeWav } from './wav.js';
import { startGraphics } from './graphics.js';

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};

const PRESET_KEY = 'spacefx.presets';
const MAIN_PARAMS = MAIN_SPECS;

let state = startState();
let ctx = null;
let node = null;
let buffer = null;
let source = null;
let startedAt = 0;

function startState() {
  const st = rackState();
  st.name = presetName(new Set(Object.keys(loadPresets())));
  return st;
}

// ---- Audio ---------------------------------------------------------------------------------

async function audio() {
  if (ctx) return ctx;
  ctx = new AudioContext();
  await ctx.audioWorklet.addModule('worklet/rack-processor.js');
  node = makeNode(ctx);
  node.connect(ctx.destination);
  node.port.onmessage = (e) => {
    if (e.data.type === 'peaks') showPeaks(e.data.peaks);
  };
  return ctx;
}

function makeNode(c) {
  return new AudioWorkletNode(c, 'rack-processor', {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [2],
    channelCount: 2,
    channelCountMode: 'explicit',
    channelInterpretation: 'speakers',
    processorOptions: { state: structuredClone(state) },
  });
}

function send() {
  if (node) node.port.postMessage({ type: 'state', state: structuredClone(state) });
}

async function loadFile(file) {
  await audio();
  const data = await file.arrayBuffer();
  buffer = await ctx.decodeAudioData(data);
  $('filename').textContent = `${file.name}  ${buffer.duration.toFixed(2)} s  ${buffer.numberOfChannels === 1 ? 'mono' : 'stereo'}`;
  $('filename').classList.remove('dim');
  $('play').disabled = $('stop').disabled = $('export').disabled = false;
  drawWave();
}

async function play() {
  if (!buffer) return;
  await audio();
  await ctx.resume();
  stop();
  source = ctx.createBufferSource();
  source.buffer = buffer;
  source.loop = $('loop').classList.contains('on');
  source.connect(node);
  source.start();
  startedAt = ctx.currentTime;
  source.onended = () => {
    if (source && !source.loop) source = null;
  };
  $('play').classList.add('active');
  requestAnimationFrame(tick);
}

function stop() {
  if (source) {
    source.onended = null;
    try { source.stop(); } catch {}
    source.disconnect();
    source = null;
  }
  $('play').classList.remove('active');
  drawWave();
}

function tick() {
  if (!source) {
    $('play').classList.remove('active');
    drawWave();
    return;
  }
  let t = ctx.currentTime - startedAt;
  if (source.loop) t %= buffer.duration;
  drawWave(Math.min(t / buffer.duration, 1));
  requestAnimationFrame(tick);
}

function drawWave(at = null) {
  const c = $('wave');
  const w = (c.width = c.clientWidth * devicePixelRatio);
  const h = (c.height = c.clientHeight * devicePixelRatio);
  const g = c.getContext('2d');
  g.clearRect(0, 0, w, h);
  if (!buffer) return;
  const d = buffer.getChannelData(0);
  const step = Math.max(1, Math.floor(d.length / w));
  g.fillStyle = '#9a9a9a';
  for (let x = 0; x < w; x++) {
    let lo = 0;
    let hi = 0;
    const o = Math.floor((x * d.length) / w);
    for (let i = 0; i < step; i++) {
      const v = d[o + i] || 0;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    g.fillRect(x, h / 2 - (hi * h) / 2, 1, Math.max(1, ((hi - lo) * h) / 2));
  }
  if (at != null) {
    g.fillStyle = '#f2f2f2';
    g.fillRect(Math.floor(at * w), 0, Math.max(1, devicePixelRatio), h);
  }
}

// ---- Export Audio --------------------------------------------------------------------------

async function exportAudio() {
  const dlg = $('exportDialog');
  $('exRate').options[0].textContent = `Current (${ctx.sampleRate} Hz)`;
  dlg.showModal();
  const ok = await new Promise((res) => dlg.addEventListener('close', () => res(dlg.returnValue === 'ok'), { once: true }));
  if (!ok) return;
  const rate = Number($('exRate').value) || ctx.sampleRate;
  const bits = Number($('exBits').value);
  const tailSel = $('exTail').value;
  const tail = tailSel === 'auto' ? 20 : Number(tailSel);
  info('Exporting...');
  const len = Math.ceil((buffer.duration + tail) * rate);
  const off = new OfflineAudioContext(2, len, rate);
  await off.audioWorklet.addModule('worklet/rack-processor.js');
  const n = makeNode(off);
  const src = off.createBufferSource();
  src.buffer = buffer;
  src.connect(n);
  n.connect(off.destination);
  src.start();
  const out = await off.startRendering();
  let L = out.getChannelData(0);
  let R = out.getChannelData(1);
  if (tailSel === 'auto') {
    // Cut the tail where it falls below -90 dB, leaving a tenth of a second.
    const floor = 10 ** (-90 / 20);
    let end = L.length;
    const fileEnd = Math.ceil(buffer.duration * rate);
    while (end > fileEnd && Math.abs(L[end - 1]) < floor && Math.abs(R[end - 1]) < floor) end--;
    end = Math.min(L.length, end + Math.round(0.1 * rate));
    L = L.subarray(0, end);
    R = R.subarray(0, end);
  }
  if ($('exNorm').checked) {
    let peak = 0;
    for (let i = 0; i < L.length; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
    const g = peak > 0 ? 10 ** (-0.3 / 20) / peak : 1;
    L = L.map((v) => v * g);
    R = R.map((v) => v * g);
  }
  const wav = encodeWav([L, R], rate, bits);
  const a = el('a');
  a.href = URL.createObjectURL(new Blob([wav], { type: 'audio/wav' }));
  a.download = `${state.name || 'Space FX'}.wav`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  info(`Exported ${a.download} (${(L.length / rate).toFixed(2)} s, ${rate} Hz, ${bits}-bit)`);
}

// ---- Controls ------------------------------------------------------------------------------

function info(text) {
  $('info').textContent = text;
}

// A control for one parameter: a dial, or a checkbox for an on/off setting.
function control(spec, get, set) {
  const shown = get;
  const tip = () => info(`${spec.label}: ${format(spec, get())}`);

  if (spec.kind === 'toggle') {
    // A checkbox, labelled like a dial so it sits in line with them.
    const box = el('label', 'check');
    const c = el('input');
    c.type = 'checkbox';
    c.checked = !!shown();
    c.onchange = () => {
      set(c.checked ? 1 : 0);
      tip();
      if (spec.rerender) renderSlots();
    };
    box.onmouseenter = tip;
    box.append(el('span', 'label', spec.short ?? spec.label), c);
    return box;
  }

  const d = el('div', 'dial');
  d.append(el('span', 'label', spec.short ?? spec.label));
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 30 30');
  const arc = (from, to) => {
    const a0 = (-135 + 270 * from) * (Math.PI / 180);
    const a1 = (-135 + 270 * to) * (Math.PI / 180);
    const p = (a) => [15 + 11 * Math.sin(a), 15 - 11 * Math.cos(a)];
    const [x0, y0] = p(a0);
    const [x1, y1] = p(a1);
    return `M${x0},${y0} A11,11 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${x1},${y1}`;
  };
  const track = document.createElementNS(NS, 'path');
  track.setAttribute('class', 'track');
  track.setAttribute('d', arc(0, 1));
  track.setAttribute('fill', 'none');
  track.setAttribute('stroke-width', '2.5');
  const val = document.createElementNS(NS, 'path');
  val.setAttribute('class', 'arc');
  val.setAttribute('fill', 'none');
  val.setAttribute('stroke-width', '2.5');
  const ptr = document.createElementNS(NS, 'line');
  ptr.setAttribute('stroke', '#d0d0d0');
  ptr.setAttribute('stroke-width', '1.5');
  svg.append(track, val, ptr);
  d.append(svg);
  const text = el('span', 'value');
  d.append(text);
  const draw = () => {
    const v = shown();
    const x = Math.min(Math.max(toNorm(spec, v), 0), 1);
    val.setAttribute('d', x > 0.002 ? arc(0, x) : '');
    const a = (-135 + 270 * x) * (Math.PI / 180);
    ptr.setAttribute('x1', 15 + 4 * Math.sin(a));
    ptr.setAttribute('y1', 15 - 4 * Math.cos(a));
    ptr.setAttribute('x2', 15 + 11 * Math.sin(a));
    ptr.setAttribute('y2', 15 - 11 * Math.cos(a));
    text.textContent = format(spec, v);
  };
  draw();
  d.redraw = draw;
  d.onmouseenter = tip;
  d.onmousedown = (e) => {
    e.preventDefault();
    let y = e.clientY;
    let x = toNorm(spec, get());
    const move = (m) => {
      x = Math.min(Math.max(x + (y - m.clientY) / (m.shiftKey ? 1500 : 150), 0), 1);
      y = m.clientY;
      set(fromNorm(spec, x));
      draw();
      tip();
    };
    const up = () => {
      removeEventListener('mousemove', move);
      removeEventListener('mouseup', up);
    };
    addEventListener('mousemove', move);
    addEventListener('mouseup', up);
  };
  d.ondblclick = () => {
    set(spec.def);
    draw();
    tip();
  };
  return d;
}

// ---- Rendering the rack --------------------------------------------------------------------


// Each module: its Device Activator, level meter and dials. The routing grid joins them.
function renderSlots() {
  const box = $('slots');
  box.innerHTML = '';
  for (const slot of state.slots) {
    if (!slot.type) continue;
    const s = el('div', 'slot');
    s.dataset.type = slot.type;
    const head = el('div', 'slot-head');
    const act = el('button', `activator${slot.on ? ' on' : ''}`);
    act.title = 'Device Activator';
    act.onclick = () => {
      slot.on = !slot.on;
      act.classList.toggle('on', slot.on);
      send();
      drawFlow();
    };
    head.append(act, el('span', 'sname', DEVICES[slot.type].name));
    s.append(head);
    const viz = el('canvas', 'viz');
    viz.dataset.slot = slot.id;
    s.append(viz);
    const params = el('div', 'params');
    const groups = new Map();
    for (const spec of DEVICES[slot.type].params) {
      if (spec.showIf && !spec.showIf(slot.params)) continue;
      // Settings in named groups sit together under a small heading.
      let into = params;
      if (spec.group) {
        if (!groups.has(spec.group)) {
          const grp = el('div', 'group');
          grp.append(el('div', 'ghead', spec.group));
          const row = el('div', 'grow');
          grp.append(row);
          params.append(grp);
          groups.set(spec.group, row);
        }
        into = groups.get(spec.group);
      }
      into.append(control(spec, () => slot.params[spec.id], (v) => {
        slot.params[spec.id] = v;
        send();
      }));
    }
    params.classList.toggle('grouped', groups.size > 0);
    s.append(params);
    box.append(s);
  }
}


// The routing grid: a row per source (Rack In, then each module's output), a column per
// destination (each module's input, then Rack Out). Each dial is a send level.
const NAMES = { in: 'Rack In', out: 'Rack Out', tape: 'Tape', filter: 'Filter', delay: 'Delay', spring: 'Spring', phaser: 'Phaser' };

function renderRouting() {
  const box = $('routing');
  box.innerHTML = '';
  const dials = el('div', 'grow');
  for (const id of ['mode', 'loop']) {
    dials.append(control(MAIN_PARAMS[id], () => state.main[id] ?? 0, (v) => {
      state.main[id] = v;
      send();
      drawFlow();
    }));
  }
  box.append(dials);
  drawFlow();
}

// A diagram of the current Mode: boxes for the modules, arrows for the signal, and a loop
// for Feedback. A module that's switched off is drawn dashed.
function drawFlow() {
  const box = document.querySelector('.routing-panel .flow');
  if (!box) return;
  const m = MODES[Math.round(state.main.mode ?? 0)] || MODES[0];
  const loop = state.main.loop ?? 0;
  const W = 240;
  const H = 180;
  const on = (t) => state.slots.find((s) => s.id === t)?.on !== false;
  const parts = [];
  const arrow = (x1, y1, x2, y2) => parts.push(`<path class="wire" d="M${x1} ${y1} L${x2} ${y2}" marker-end="url(#arr)"/>`);
  const node = (x, y, w, label, t, bh = 22) => {
    parts.push(`<rect class="mod${t && !on(t) ? ' off' : ''}" x="${x}" y="${y - bh / 2}" width="${w}" height="${bh}" rx="2"/>`);
    parts.push(`<text x="${x + w / 2}" y="${y + 4}">${label}</text>`);
  };
  const end = (x, y, label) => parts.push(`<text class="end" x="${x}" y="${y + 4}">${label}</text>`);
  const fbOpacity = loop > 0 ? 0.35 + 0.65 * loop : 0;
  const cx = W / 2;
  if (m.parallel) {
    const w = 42;
    const xs = [3, 50, 99, 148, 195];
    const y = 92;
    end(cx, 14, 'In');
    end(cx, H - 12, 'Out');
    MODULES_ORDER.forEach((t, i) => {
      const mx = xs[i] + w / 2;
      parts.push(`<path class="wire" d="M${cx} 24 C ${cx} 50, ${mx} 46, ${mx} ${y - 15}" marker-end="url(#arr)"/>`);
      parts.push(`<path class="wire" d="M${mx} ${y + 11} C ${mx} ${y + 40}, ${cx} ${y + 36}, ${cx} ${H - 26}" marker-end="url(#arr)"/>`);
      node(xs[i], y, w, NAMES[t], t);
      // Feedback: a small loop over the box, from its right back into its left.
      if (fbOpacity) parts.push(`<path class="fb" style="opacity:${fbOpacity}" d="M${xs[i] + w - 8} ${y - 11} C ${xs[i] + w - 8} ${y - 26}, ${xs[i] + 8} ${y - 26}, ${xs[i] + 8} ${y - 13}" marker-end="url(#arrfb)"/>`);
    });
  } else {
    const n = m.order.length;
    const w = 96;
    const x = cx - w / 2;
    // Five boxes are drawn a little shorter so the arrows between them still show.
    const bh = n > 4 ? 16 : 22;
    const top = n > 4 ? 36 : 38;
    const step = Math.min((H - top - 42) / (n - 1), 62);
    const ys = m.order.map((_, i) => top + i * step);
    end(cx, 14, 'In');
    end(cx, H - 10, 'Out');
    arrow(cx, 20, cx, ys[0] - bh / 2 - 4);
    m.order.forEach((t, i) => {
      node(x, ys[i], w, NAMES[t], t, bh);
      if (i) arrow(cx, ys[i - 1] + bh / 2, cx, ys[i] - bh / 2 - 4);
    });
    arrow(cx, ys[n - 1] + bh / 2, cx, H - 24);
    if (fbOpacity) {
      const r = x + w;
      parts.push(`<path class="fb" style="opacity:${fbOpacity}" d="M${r} ${ys[n - 1]} C ${r + 44} ${ys[n - 1]}, ${r + 44} ${ys[0]}, ${r + 6} ${ys[0]}" marker-end="url(#arrfb)"/>`);
      parts.push(`<text class="fbl" style="opacity:${fbOpacity}" transform="translate(${r + 42} ${(ys[0] + ys[n - 1]) / 2}) rotate(90)">Feedback</text>`);
    }
  }
  box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}">
    <defs>
      <marker id="arr" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0 L8 4 L0 8 z" fill="#9a9a9a"/></marker>
      <marker id="arrfb" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0 L8 4 L0 8 z" fill="#e8e8e8"/></marker>
    </defs>${parts.join('')}</svg>`;
}
const MODULES_ORDER = ['tape', 'filter', 'delay', 'spring', 'phaser'];

function renderMain() {
  const box = $('main');
  box.innerHTML = '';
  box.append(control(MAIN_PARAMS.dryWet, () => state.main.dryWet, (v) => {
    state.main.dryWet = v;
    send();
  }));
  box.append(control(MAIN_PARAMS.volume, () => state.main.volume, (v) => {
    state.main.volume = v;
    send();
  }));
}



function renderAll() {
  renderSlots();
  renderRouting();
  renderMain();
  $('name').value = state.name || '';
  $('tempo').value = state.tempo;
  renderPresets();
}

let lastPeaks = null;
startGraphics(() => ({ state, peaks: lastPeaks }));

function showPeaks(peaks) {
  lastPeaks = peaks;
}

// ---- Presets -------------------------------------------------------------------------------

function loadPresets() {
  try {
    return JSON.parse(localStorage.getItem(PRESET_KEY)) || {};
  } catch {
    return {};
  }
}

function renderPresets() {
  const sel = $('presets');
  const all = loadPresets();
  sel.innerHTML = '';
  const first = el('option', null, 'Presets');
  first.value = '';
  sel.append(first);
  for (const n of Object.keys(all).sort()) {
    const o = el('option', null, n);
    o.value = n;
    sel.append(o);
  }
  sel.value = all[state.name] ? state.name : '';
}

function setState(st) {
  state = toRack(st);
  // No Macros any more: drop any a saved preset still carries, so nothing moves unseen.
  for (const m of state.macros || []) {
    m.maps = [];
    m.value = 0;
  }
  send();
  renderAll();
}

// ---- Wiring --------------------------------------------------------------------------------

$('open').onclick = () => $('file').click();
// Open the break that sits in the site's audio folder, so there's something to play at once.
const DEFAULT_AUDIO = 'audio/Adrift Break.wav';
(async () => {
  try {
    const res = await fetch(encodeURI(DEFAULT_AUDIO));
    if (!res.ok || buffer) return;
    const blob = await res.blob();
    if (!buffer) await loadFile(new File([blob], DEFAULT_AUDIO.split('/').pop()));
  } catch (e) {
    console.warn('No default audio', e);
  }
})();

$('file').onchange = () => $('file').files[0] && loadFile($('file').files[0]);
document.body.ondragover = (e) => e.preventDefault();
document.body.ondrop = (e) => {
  const f = e.dataTransfer.files?.[0];
  if (f) {
    e.preventDefault();
    loadFile(f);
  }
};
$('play').onclick = play;
// Stop leaves the tails ringing, as Live does; a second Stop clears them.
$('stop').onclick = () => {
  if (source) stop();
  else if (node) node.port.postMessage({ type: 'reset' });
};
$('loop').onclick = () => {
  $('loop').classList.toggle('on');
  if (source) source.loop = $('loop').classList.contains('on');
};
$('tempo').onchange = () => {
  state.tempo = Math.min(Math.max(Number($('tempo').value) || 120, 20), 300);
  send();
};
$('export').onclick = exportAudio;
$('name').onchange = () => {
  state.name = $('name').value.trim() || presetName(new Set(Object.keys(loadPresets())));
  $('name').value = state.name;
};
$('save').onclick = () => {
  const all = loadPresets();
  if (!state.name) state.name = presetName(new Set(Object.keys(all)));
  all[state.name] = structuredClone(state);
  localStorage.setItem(PRESET_KEY, JSON.stringify(all));
  renderAll();
  info(`Saved ${state.name}`);
};
$('delete').onclick = () => {
  const all = loadPresets();
  if (!all[state.name]) return;
  delete all[state.name];
  localStorage.setItem(PRESET_KEY, JSON.stringify(all));
  renderPresets();
  info(`Deleted ${state.name}`);
};
$('presets').onchange = () => {
  const p = loadPresets()[$('presets').value];
  if (p) setState(structuredClone(p));
};
$('rand').onclick = () => {
  const st = randomRack(Math.random, new Set(Object.keys(loadPresets())), state.tempo);
  setState(st);
  info(`Rand: ${st.name}`);
};
addEventListener('keydown', (e) => {
  if (e.code === 'Space' && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLSelectElement)) {
    e.preventDefault();
    if (source) stop();
    else play();
  }
});
addEventListener('resize', () => drawWave());

renderAll();
