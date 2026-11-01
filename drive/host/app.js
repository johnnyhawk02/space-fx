// The browser host for Space Drive: load a file, play it through the engine, edit the controls.
// Same look and controls as Space FX (host/app.js there); the sound is made by dsp/ inside the
// AudioWorklet.

import { DEVICES, driveState, fromNorm, toNorm, format, STEPS } from '../dsp/params.js';
import { startGraphics, seqHit } from './graphics.js';

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};

const STATE_KEY = 'spacedrive.state';
let state = loadState();
let ctx = null;
let node = null;
let buffer = null;
let source = null;
let startedAt = 0;
let meter = null;

function loadState() {
  const st = driveState();
  try {
    const saved = JSON.parse(localStorage.getItem(STATE_KEY));
    if (saved) for (const k of ['drive', 'filter', 'seq', 'on']) Object.assign(st[k], saved[k]);
    if (saved?.tempo) st.tempo = saved.tempo;
  } catch {}
  return st;
}

// ---- Audio ---------------------------------------------------------------------------------

async function audio() {
  if (ctx) return ctx;
  ctx = new AudioContext();
  await ctx.audioWorklet.addModule('worklet/processor.js');
  node = new AudioWorkletNode(ctx, 'drive-processor', {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [2],
    channelCount: 2,
    channelCountMode: 'explicit',
    channelInterpretation: 'speakers',
    processorOptions: { state: structuredClone(state) },
  });
  node.connect(ctx.destination);
  node.port.onmessage = (e) => {
    if (e.data.type === 'meter') meter = { ...e.data, at: performance.now() };
  };
  return ctx;
}

function send() {
  if (node) node.port.postMessage({ type: 'state', state: structuredClone(state) });
  localStorage.setItem(STATE_KEY, JSON.stringify(state));
}

async function loadFile(file) {
  await audio();
  buffer = await ctx.decodeAudioData(await file.arrayBuffer());
  $('filename').textContent = `${file.name}  ${buffer.duration.toFixed(2)} s  ${buffer.numberOfChannels === 1 ? 'mono' : 'stereo'}`;
  $('filename').classList.remove('dim');
  $('play').disabled = $('stop').disabled = false;
  drawWave();
}

async function play() {
  if (!buffer) return;
  await audio();
  await ctx.resume();
  stop();
  // The pattern starts from step 1 with the file, as it would from the bar in a DAW.
  node.port.postMessage({ type: 'restart' });
  source = ctx.createBufferSource();
  source.buffer = buffer;
  source.loop = $('loop').classList.contains('on');
  source.connect(node);
  source.start();
  startedAt = ctx.currentTime;
  $('play').classList.add('active');
  requestAnimationFrame(tick);
}

function stop() {
  if (source) {
    try { source.stop(); } catch {}
    source.disconnect();
    source = null;
  }
  $('play').classList.remove('active');
  drawWave();
}

function tick() {
  if (!source) return drawWave();
  let t = ctx.currentTime - startedAt;
  if (source.loop) t %= buffer.duration;
  else if (t > buffer.duration) return stop();
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

// ---- Controls (as in Space FX) -------------------------------------------------------------

const info = (text) => ($('info').textContent = text);

function control(spec, get, set) {
  const tip = () => info(`${spec.label}: ${format(spec, get())}`);
  if (spec.kind === 'toggle') {
    const box = el('label', 'check');
    const c = el('input');
    c.type = 'checkbox';
    c.checked = !!get();
    c.onchange = () => {
      set(c.checked ? 1 : 0);
      tip();
      if (spec.rerender) render();
    };
    box.onmouseenter = tip;
    box.append(el('span', 'label', spec.label), c);
    return box;
  }
  const d = el('div', 'dial');
  d.append(el('span', 'label', spec.label));
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
  const path = (cls) => {
    const e = document.createElementNS(NS, 'path');
    e.setAttribute('class', cls);
    e.setAttribute('fill', 'none');
    e.setAttribute('stroke-width', '2.5');
    return e;
  };
  const track = path('track');
  track.setAttribute('d', arc(0, 1));
  const val = path('arc');
  const ptr = document.createElementNS(NS, 'line');
  ptr.setAttribute('stroke', '#d0d0d0');
  ptr.setAttribute('stroke-width', '1.5');
  svg.append(track, val, ptr);
  const text = el('span', 'value');
  d.append(svg, text);
  // Bipolar dials (Env, Seq) draw their arc from the middle.
  const zero = spec.min < 0 ? toNorm(spec, 0) : 0;
  const draw = () => {
    const v = get();
    const x = Math.min(Math.max(toNorm(spec, v), 0), 1);
    const [a, b] = x < zero ? [x, zero] : [zero, x];
    val.setAttribute('d', b - a > 0.002 ? arc(a, b) : '');
    const ang = (-135 + 270 * x) * (Math.PI / 180);
    ptr.setAttribute('x1', 15 + 4 * Math.sin(ang));
    ptr.setAttribute('y1', 15 - 4 * Math.cos(ang));
    ptr.setAttribute('x2', 15 + 11 * Math.sin(ang));
    ptr.setAttribute('y2', 15 - 11 * Math.cos(ang));
    text.textContent = format(spec, v);
  };
  draw();
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

// ---- The cards -----------------------------------------------------------------------------

function render() {
  const box = $('slots');
  box.innerHTML = '';
  for (const type of ['drive', 'filter', 'seq']) {
    const s = el('div', 'slot');
    s.dataset.type = type;
    const head = el('div', 'slot-head');
    const act = el('button', `activator${state.on[type] ? ' on' : ''}`);
    act.title = 'Device Activator';
    act.onclick = () => {
      state.on[type] = !state.on[type];
      act.classList.toggle('on', state.on[type]);
      send();
    };
    head.append(act, el('span', 'sname', DEVICES[type].name));
    const viz = el('canvas', 'viz');
    viz.dataset.slot = type;
    if (type === 'seq') editSteps(viz);
    const params = el('div', 'params');
    const p = state[type];
    for (const spec of DEVICES[type].params) {
      if (spec.showIf && !spec.showIf(p)) continue;
      params.append(control(spec, () => p[spec.id], (v) => {
        p[spec.id] = v;
        send();
      }));
    }
    s.append(head, viz, params);
    box.append(s);
  }
}

// Draw the steps: drag across the Sequencer's picture to set each step's level; double-click
// a step to set it to 0.
function editSteps(c) {
  const at = (e) => {
    const r = c.getBoundingClientRect();
    return seqHit(e.clientX - r.left, e.clientY - r.top, r.width, r.height, state.seq.steps);
  };
  const put = (e) => {
    const hit = at(e);
    if (!hit) return;
    state.seq.values[hit.step] = hit.value;
    info(`Step ${hit.step + 1}: ${Math.round(hit.value * 100)} %`);
    send();
  };
  c.onmousedown = (e) => {
    e.preventDefault();
    put(e);
    const up = () => {
      removeEventListener('mousemove', put);
      removeEventListener('mouseup', up);
    };
    addEventListener('mousemove', put);
    addEventListener('mouseup', up);
  };
  c.ondblclick = (e) => {
    const hit = at(e);
    if (hit) {
      state.seq.values[hit.step] = 0;
      send();
    }
  };
}

// ---- Wiring --------------------------------------------------------------------------------

$('open').onclick = () => $('file').click();
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
$('stop').onclick = () => {
  if (source) stop();
  else if (node) node.port.postMessage({ type: 'reset' });
};
$('loop').onclick = () => {
  $('loop').classList.toggle('on');
  if (source) source.loop = $('loop').classList.contains('on');
};
$('tempo').value = state.tempo;
$('tempo').onchange = () => {
  state.tempo = Math.min(Math.max(Number($('tempo').value) || 120, 20), 300);
  send();
};
addEventListener('keydown', (e) => {
  if (e.code === 'Space' && !(e.target instanceof HTMLInputElement)) {
    e.preventDefault();
    if (source) stop();
    else play();
  }
});
addEventListener('resize', () => drawWave());

// Johnny's break, from Space FX's audio folder, so there's something to play at once.
(async () => {
  try {
    const name = 'Adrift Break.wav';
    const res = await fetch(encodeURI(`../audio/${name}`));
    if (res.ok && !buffer) await loadFile(new File([await res.blob()], name));
  } catch (e) {
    console.warn('No default audio', e);
  }
})();

if (state.seq.values.length !== STEPS) state.seq.values = driveState().seq.values;
render();
startGraphics(() => ({ state, meter }));
