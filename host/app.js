// The browser host: load a file, play it through the rack, edit the rack, export the result.
// All DOM code lives here; the sound is made by dsp/ inside the AudioWorklet.

import { DEVICES, ROUTE_SPEC, fromNorm, toNorm, format } from '../dsp/params.js';
import { rackState, toRack, SOURCES, DESTS } from '../dsp/rack.js';
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
const MAIN_PARAMS = {
  dryWet: { id: 'dryWet', label: 'Dry/Wet', kind: 'lin', min: 0, max: 1, def: 1, pct: true },
  volume: { id: 'volume', label: 'Volume', kind: 'lin', min: -60, max: 6, def: 0, unit: 'dB', digits: 1 },
};
const MACRO_SPEC = { id: 'macro', label: 'Macro', kind: 'lin', min: 0, max: 1, def: 0, pct: true };

let state = startState();
let ctx = null;
let node = null;
let buffer = null;
let source = null;
let startedAt = 0;
let mapping = false;
let selectedMacro = 0;

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

const keyOf = (t) => JSON.stringify([t.target, t.slot ?? null, t.src ?? null, t.dst ?? null, t.param ?? null]);

function findMapping(t) {
  const k = keyOf(t);
  for (let i = 0; i < state.macros.length; i++) {
    const m = state.macros[i].maps.find((x) => keyOf(x) === k);
    if (m) return { macro: state.macros[i], map: m, index: i };
  }
  return null;
}

function addMapping(t) {
  const k = keyOf(t);
  for (const m of state.macros) m.maps = m.maps.filter((x) => keyOf(x) !== k);
  state.macros[selectedMacro].maps.push({ ...t, min: 0, max: 1 });
  send();
  renderAll();
}

// A control for one parameter. `target` describes it for Macro mapping (null for Macros).
function control(spec, get, set, target) {
  const found = target && findMapping(target);
  const shown = () => (found ? fromNorm(spec, found.map.min + (found.map.max - found.map.min) * found.macro.value) : get());
  const tip = () => {
    const extra = found ? ` (mapped to ${found.macro.name})` : '';
    const what = target?.target === 'route' ? `${NAMES[target.src]} to ${NAMES[target.dst]}` : spec.label;
    info(`${what}: ${format(spec, shown())}${extra}`);
  };
  const mapClick = (e) => {
    if (!mapping || !target) return false;
    e.preventDefault();
    e.stopPropagation();
    addMapping(target);
    return true;
  };

  if (spec.kind === 'toggle') {
    // A checkbox, labelled like a dial so it sits in line with them.
    const box = el('label', 'check');
    const c = el('input');
    c.type = 'checkbox';
    c.checked = !!shown();
    c.disabled = !!found;
    c.onchange = () => {
      set(c.checked ? 1 : 0);
      tip();
      if (spec.rerender) renderSlots();
    };
    box.onmousedown = mapClick;
    box.onmouseenter = tip;
    box.append(el('span', 'label', spec.label), c);
    return box;
  }

  const d = el('div', `dial${found ? ' mapped' : ''}${target ? '' : ' macrodial'}`);
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
    if (mapClick(e)) return;
    if (found) return;
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
    if (found || mapping) return;
    set(spec.def);
    draw();
    tip();
  };
  return d;
}

// ---- Rendering the rack --------------------------------------------------------------------

function renderMacros() {
  const box = $('macros');
  box.innerHTML = '';
  state.macros.forEach((m, i) => {
    const wrap = el('div', 'macro');
    const name = el('input', 'mname');
    name.value = m.name;
    name.onchange = () => {
      m.name = name.value || `Macro ${i + 1}`;
      send();
      renderMappings();
    };
    const dial = control({ ...MACRO_SPEC, label: '' }, () => m.value, (v) => {
      m.value = v;
      send();
      renderSlots();
      renderRouting();
      renderMain();
    }, null);
    if (mapping && i === selectedMacro) dial.classList.add('selected');
    dial.addEventListener('mousedown', () => {
      if (mapping) {
        selectedMacro = i;
        renderMacros();
        renderMappings();
      }
    }, true);
    wrap.append(dial, name);
    box.append(wrap);
  });
}

// Each module: its Device Activator, level meter and dials. The routing grid joins them.
function renderSlots() {
  const box = $('slots');
  box.innerHTML = '';
  for (const slot of state.slots) {
    if (!slot.type) continue;
    const s = el('div', 'slot');
    const head = el('div', 'slot-head');
    const act = el('button', `activator${slot.on ? ' on' : ''}`);
    act.title = 'Device Activator';
    act.onclick = () => {
      slot.on = !slot.on;
      act.classList.toggle('on', slot.on);
      send();
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
      }, { target: 'slot', slot: slot.id, param: spec.id }));
    }
    params.classList.toggle('grouped', groups.size > 0);
    s.append(params);
    box.append(s);
  }
}

function dropMappings(slotId) {
  for (const m of state.macros) m.maps = m.maps.filter((x) => !(x.target === 'slot' && x.slot === slotId));
}

// The routing grid: a row per source (Rack In, then each module's output), a column per
// destination (each module's input, then Rack Out). Each dial is a send level.
const NAMES = { in: 'Rack In', out: 'Rack Out', tape: 'Tape', spring: 'Spring', phaser: 'Phaser' };

function renderRouting() {
  const box = $('routing');
  box.innerHTML = '';
  const grid = el('div', 'grid');
  grid.style.gridTemplateColumns = `72px repeat(${DESTS.length}, 64px)`;
  grid.append(el('div', 'corner dim', 'From \\ To'));
  for (const d of DESTS) grid.append(el('div', `colhead${d === 'out' ? ' outcol' : ''}`, NAMES[d]));
  for (const src of SOURCES) {
    grid.append(el('div', `rowhead${src === 'in' ? ' inrow' : ''}`, NAMES[src]));
    for (const dst of DESTS) {
      const cellCls = `cell${src === 'in' ? ' inrow' : ''}${dst === 'out' ? ' outcol' : ''}${src === dst ? ' self' : ''}`;
      if (!(dst in state.routes[src])) {
        grid.append(el('div', cellCls));
        continue;
      }
      const cell = el('div', cellCls);
      const spec = { ...ROUTE_SPEC, label: src === dst ? 'Self' : '' };
      const d = control(spec, () => state.routes[src][dst], (v) => {
        state.routes[src][dst] = v;
        send();
      }, { target: 'route', src, dst });
      d.title = `${NAMES[src]} to ${NAMES[dst]}`;
      cell.append(d);
      grid.append(cell);
    }
  }
  box.append(grid);
}

function renderMain() {
  const box = $('main');
  box.innerHTML = '';
  box.append(control(MAIN_PARAMS.dryWet, () => state.main.dryWet, (v) => {
    state.main.dryWet = v;
    send();
  }, { target: 'main', param: 'dryWet' }));
  box.append(control(MAIN_PARAMS.volume, () => state.main.volume, (v) => {
    state.main.volume = v;
    send();
  }, null));
}

function targetName(t) {
  if (t.target === 'slot') {
    const i = state.slots.findIndex((s) => s.id === t.slot);
    const s = state.slots[i];
    const spec = s?.type && DEVICES[s.type].params.find((p) => p.id === t.param);
    return `${s?.type ? DEVICES[s.type].name : "Module"}: ${spec ? spec.label : t.param}`;
  }
  if (t.target === 'route') return `Send: ${NAMES[t.src]} to ${NAMES[t.dst]}`;
  return `Main: ${MAIN_PARAMS[t.param]?.label ?? t.param}`;
}

function renderMappings() {
  const box = $('mappings');
  box.hidden = !mapping;
  if (!mapping) return;
  box.innerHTML = '';
  const m = state.macros[selectedMacro];
  box.append(el('div', 'title', `${m.name}: click any control to map it`));
  if (!m.maps.length) {
    box.append(el('div', 'dim', 'Nothing mapped yet.'));
    return;
  }
  const t = el('table');
  const hr = el('tr');
  ['Path', 'Min', 'Max', ''].forEach((h) => hr.append(el('th', null, h)));
  t.append(hr);
  m.maps.forEach((map, k) => {
    const tr = el('tr');
    tr.append(el('td', null, targetName(map)));
    for (const end of ['min', 'max']) {
      const td = el('td');
      const inp = el('input');
      inp.type = 'number';
      inp.min = 0;
      inp.max = 100;
      inp.value = Math.round(map[end] * 100);
      inp.onchange = () => {
        map[end] = Math.min(Math.max(Number(inp.value) / 100, 0), 1);
        send();
        renderSlots();
        renderRouting();
      };
      td.append(inp, document.createTextNode(' %'));
      tr.append(td);
    }
    const td = el('td');
    const del = el('button', null, 'Delete');
    del.onclick = () => {
      m.maps.splice(k, 1);
      send();
      renderAll();
    };
    td.append(del);
    tr.append(td);
    t.append(tr);
  });
  box.append(t);
}

function renderAll() {
  renderMacros();
  renderSlots();
  renderRouting();
  renderMain();
  renderMappings();
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
  if (selectedMacro >= state.macros.length) selectedMacro = 0;
  send();
  renderAll();
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
$('map').onclick = () => {
  mapping = !mapping;
  $('map').classList.toggle('on', mapping);
  document.body.classList.toggle('mapping', mapping);
  renderAll();
};
$('randMacros').onclick = () => {
  for (const m of state.macros) m.value = Math.random();
  send();
  renderAll();
};
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
