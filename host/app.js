// The browser host: load a file, play it through the rack, edit the rack, export the result.
// All DOM code lives here; the sound is made by dsp/ inside the AudioWorklet.

import { DEVICES, MIXER_PARAMS, CHANNEL_PARAMS, fromNorm, toNorm, format } from '../dsp/params.js';
import { emptyState, newSlot, newMixer, MIXER_IDS, MAX_MIXERS } from '../dsp/rack.js';
import { presetName } from '../dsp/names.js';
import { randomRack } from '../dsp/random.js';
import { encodeWav } from './wav.js';

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
  const st = emptyState();
  st.slots[0] = newSlot('s1', 'tape');
  st.slots[1] = newSlot('s2', 'spring');
  st.slots[2] = newSlot('s3', 'phaser');
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

const keyOf = (t) => JSON.stringify([t.target, t.slot ?? null, t.mixer ?? null, t.channel ?? null, t.param]);

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
    info(`${spec.label}: ${format(spec, shown())}${extra}`);
  };
  const mapClick = (e) => {
    if (!mapping || !target) return false;
    e.preventDefault();
    e.stopPropagation();
    addMapping(target);
    return true;
  };

  if (spec.kind === 'values' || spec.kind === 'choice') {
    const box = el('div', 'param-wide');
    box.append(el('span', 'label', spec.label));
    const sel = el('select');
    const items = spec.kind === 'values' ? spec.values.map(([l, v]) => [l, v]) : spec.labels.map((l, i) => [l, i]);
    for (const [l, v] of items) {
      const o = el('option', null, l);
      o.value = String(v);
      sel.append(o);
    }
    sel.value = String(shown());
    sel.disabled = !!found;
    sel.onchange = () => {
      set(Number(sel.value));
      tip();
    };
    box.onmousedown = mapClick;
    box.onmouseenter = tip;
    box.append(sel);
    return box;
  }

  if (spec.kind === 'toggle') {
    const box = el('div', 'param-wide');
    box.append(el('span', 'label', spec.label));
    const b = el('button', `toggle${shown() ? ' on' : ''}`, shown() ? 'On' : 'Off');
    b.disabled = !!found;
    b.onclick = () => {
      set(get() ? 0 : 1);
      b.classList.toggle('on', !!get());
      b.textContent = get() ? 'On' : 'Off';
    };
    box.onmousedown = mapClick;
    box.onmouseenter = tip;
    box.append(b);
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
      renderMixers();
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

let dragSlot = null;
let dragFx = null;
let armedFx = null;

function placeEffect(i, fx) {
  const slot = state.slots[i];
  const keep = slot.input;
  state.slots[i] = newSlot(slot.id, fx);
  state.slots[i].input = keep;
  dropMappings(slot.id);
  armedFx = null;
  for (const c of document.querySelectorAll('.chip')) c.classList.remove('on');
  send();
  renderAll();
  info(`${DEVICES[fx].name} in slot ${i + 1}`);
}

function renderSlots() {
  const box = $('slots');
  box.innerHTML = '';
  state.slots.forEach((slot, i) => {
    const s = el('div', `slot${slot.type ? '' : ' empty'}`);
    s.ondragenter = (e) => e.preventDefault();
    s.ondragover = (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = dragFx ? 'copy' : 'move';
      s.classList.add('over');
    };
    s.ondragleave = (e) => {
      if (!s.contains(e.relatedTarget)) s.classList.remove('over');
    };
    s.ondrop = (e) => {
      e.preventDefault();
      e.stopPropagation();
      s.classList.remove('over');
      // Safari can drop custom data types, so the dragged effect is also kept here.
      const fx = dragFx || e.dataTransfer.getData('text/plain');
      if (DEVICES[fx]) placeEffect(i, fx);
      else if (dragSlot != null && dragSlot !== i) {
        const [moved] = state.slots.splice(dragSlot, 1);
        state.slots.splice(i, 0, moved);
        send();
        renderAll();
      }
      dragSlot = null;
      dragFx = null;
    };
    // No drag and drop (touch screens, or a browser that won't): click an effect, then a slot.
    s.addEventListener('click', () => {
      if (armedFx) placeEffect(i, armedFx);
    });
    if (!slot.type) {
      s.append(el('span', null, `Slot ${i + 1}`), el('span', null, 'Drop an effect here'));
      box.append(s);
      return;
    }
    const head = el('div', 'slot-head');
    head.draggable = true;
    head.ondragstart = (e) => {
      dragSlot = i;
      dragFx = null;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', `slot ${i + 1}`);
    };
    const act = el('button', `activator${slot.on ? ' on' : ''}`);
    act.title = 'Device Activator';
    act.onclick = () => {
      slot.on = !slot.on;
      act.classList.toggle('on', slot.on);
      send();
    };
    const x = el('button', 'x', '×');
    x.title = 'Remove';
    x.onclick = () => {
      state.slots[i] = newSlot(slot.id, null);
      dropMappings(slot.id);
      send();
      renderAll();
    };
    head.append(jack('in', `slotin:${slot.id}`), act, el('span', 'sname', `${i + 1}  ${DEVICES[slot.type].name}`), x, jack('out', `slot:${slot.id}`));
    s.append(head);
    const meter = el('div', 'meter');
    meter.append(el('i'));
    meter.dataset.slot = slot.id;
    s.append(meter);

    const params = el('div', 'params');
    for (const spec of DEVICES[slot.type].params) {
      params.append(control(spec, () => slot.params[spec.id], (v) => {
        slot.params[spec.id] = v;
        send();
      }, { target: 'slot', slot: slot.id, param: spec.id }));
    }
    s.append(params);
    box.append(s);
  });
  requestAnimationFrame(drawCables);
}

function dropMappings(slotId) {
  for (const m of state.macros) m.maps = m.maps.filter((x) => !(x.target === 'slot' && x.slot === slotId));
}

function renderMixers() {
  const box = $('mixers');
  box.innerHTML = '';
  for (const m of state.mixers) {
    const panel = el('div', 'mixer');
    const head = el('div', 'slot-head');
    const x = el('button', 'x', '×');
    x.onclick = () => {
      state.mixers = state.mixers.filter((y) => y !== m);
      const gone = `mix:${m.id}`;
      for (const s of state.slots) if (s.input === gone) s.input = 'auto';
      for (const y of state.mixers) for (const c of y.channels) if (c.source === gone) c.source = 'none';
      if (state.out === gone) state.out = 'auto';
      for (const mm of state.macros) mm.maps = mm.maps.filter((t) => !(t.target === 'mixer' && t.mixer === m.id));
      send();
      renderAll();
    };
    head.append(el('span', 'sname', `Sub Mixer ${m.id}`), x, jack('out', `mix:${m.id}`));
    panel.append(head);
    const chs = el('div', 'chs');
    m.channels.forEach((ch, ci) => {
      const c = el('div', 'ch');
      const top = el('div', 'ch-in');
      top.append(jack('in', `mixin:${m.id}:${ci}`), el('span', 'dim', `In ${ci + 1}`));
      c.append(top);
      for (const spec of CHANNEL_PARAMS) {
        c.append(control(spec, () => ch[spec.id], (v) => {
          ch[spec.id] = v;
          send();
        }, { target: 'mixer', mixer: m.id, channel: ci, param: spec.id }));
      }
      chs.append(c);
    });
    panel.append(chs);
    const own = el('div', 'own');
    for (const spec of MIXER_PARAMS) {
      own.append(control(spec, () => m[spec.id], (v) => {
        m[spec.id] = v;
        send();
      }, { target: 'mixer', mixer: m.id, param: spec.id }));
    }
    panel.append(own);
    box.append(panel);
  }
  $('addMixer').disabled = state.mixers.length >= MAX_MIXERS;
  requestAnimationFrame(drawCables);
}

// ---- Patch cables -------------------------------------------------------------------------
// Out jacks: 'in' (Rack In), 'slot:<id>', 'mix:<id>'. In jacks: 'slotin:<id>',
// 'mixin:<id>:<channel>', 'rackout'. An In takes one cable; an Out can feed any number.

const CABLE_GREYS = ['#e0e0e0', '#b0b0b0', '#cfcfcf', '#9a9a9a', '#f4f4f4', '#bdbdbd'];
let dragCable = null;

function jack(kind, id) {
  const j = el('span', `jack ${kind}`);
  j.dataset.jack = id;
  j.title = kind === 'out' ? 'Out: drag to an In' : 'In: drag a cable here; drag out to unplug';
  j.onmousedown = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (kind === 'out') startDrag(id, null);
    else {
      const from = inputOf(id);
      if (from && !from.auto) {
        setInput(id, 'none');
        startDrag(from.source, null);
      }
    }
  };
  return j;
}

// What feeds an In jack: { source, auto } (auto = the default wiring, drawn dashed).
function inputOf(id) {
  const lastFilledBefore = (i) => {
    for (let k = i - 1; k >= 0; k--) if (state.slots[k].type) return `slot:${state.slots[k].id}`;
    return 'in';
  };
  if (id.startsWith('slotin:')) {
    const i = state.slots.findIndex((s) => s.id === id.slice(7));
    const v = state.slots[i]?.input;
    if (!v || v === 'auto') return { source: lastFilledBefore(i), auto: true };
    return v === 'none' ? null : { source: v, auto: false };
  }
  if (id.startsWith('mixin:')) {
    const [, mid, ch] = id.split(':');
    const v = state.mixers.find((m) => m.id === mid)?.channels[ch]?.source;
    return !v || v === 'none' ? null : { source: v, auto: false };
  }
  if (id === 'rackout') {
    const v = state.out;
    if (!v || v === 'auto') return { source: lastFilledBefore(state.slots.length), auto: true };
    return v === 'none' ? null : { source: v, auto: false };
  }
  return null;
}

function setInput(id, source) {
  if (id.startsWith('slotin:')) state.slots.find((s) => s.id === id.slice(7)).input = source;
  else if (id.startsWith('mixin:')) {
    const [, mid, ch] = id.split(':');
    state.mixers.find((m) => m.id === mid).channels[ch].source = source;
  } else if (id === 'rackout') state.out = source;
  send();
}

function startDrag(source, _) {
  dragCable = { source, x: 0, y: 0 };
  document.body.classList.add('patching');
  const move = (e) => {
    const r = $('rack').getBoundingClientRect();
    dragCable.x = e.clientX - r.left;
    dragCable.y = e.clientY - r.top;
    drawCables();
  };
  const up = (e) => {
    removeEventListener('mousemove', move);
    removeEventListener('mouseup', up);
    document.body.classList.remove('patching');
    const target = document.elementFromPoint(e.clientX, e.clientY)?.closest('.jack.in');
    if (target) {
      setInput(target.dataset.jack, dragCable.source);
      info(`Patched ${jackName(dragCable.source)} to ${jackName(target.dataset.jack)}`);
    }
    dragCable = null;
    drawCables();
  };
  addEventListener('mousemove', move);
  addEventListener('mouseup', up);
}

function jackName(id) {
  if (id === 'in') return 'Rack In';
  if (id === 'rackout') return 'Rack Out';
  const slotNo = (sid) => state.slots.findIndex((s) => s.id === sid) + 1;
  if (id.startsWith('slot:')) return `Slot ${slotNo(id.slice(5))} Out`;
  if (id.startsWith('slotin:')) return `Slot ${slotNo(id.slice(7))} In`;
  if (id.startsWith('mix:')) return `Sub Mixer ${id.slice(4)} Out`;
  const [, mid, ch] = id.split(':');
  return `Sub Mixer ${mid} In ${Number(ch) + 1}`;
}

function jackPos(id) {
  const j = document.querySelector(`.jack[data-jack="${id}"]`);
  if (!j) return null;
  const r = $('rack').getBoundingClientRect();
  const b = j.getBoundingClientRect();
  return [b.left + b.width / 2 - r.left, b.top + b.height / 2 - r.top];
}

function cablePath([x1, y1], [x2, y2]) {
  const sag = 30 + Math.hypot(x2 - x1, y2 - y1) * 0.3;
  return `M${x1},${y1} C${x1},${y1 + sag} ${x2},${y2 + sag} ${x2},${y2}`;
}

function drawCables() {
  const svg = $('cables');
  const r = $('rack');
  svg.setAttribute('width', r.scrollWidth);
  svg.setAttribute('height', r.scrollHeight);
  svg.innerHTML = '';
  const NS = 'http://www.w3.org/2000/svg';
  const ins = [...document.querySelectorAll('.jack.in')].map((j) => j.dataset.jack);
  ins.forEach((id, k) => {
    const from = inputOf(id);
    if (!from) return;
    const a = jackPos(from.source);
    const b = jackPos(id);
    if (!a || !b) return;
    const d = cablePath(a, b);
    const under = document.createElementNS(NS, 'path');
    under.setAttribute('d', d);
    under.setAttribute('class', 'cable-edge');
    const top = document.createElementNS(NS, 'path');
    top.setAttribute('d', d);
    top.setAttribute('class', `cable${from.auto ? ' auto' : ''}`);
    top.style.stroke = CABLE_GREYS[k % CABLE_GREYS.length];
    svg.append(under, top);
  });
  if (dragCable) {
    const a = jackPos(dragCable.source);
    if (a) {
      const p = document.createElementNS(NS, 'path');
      p.setAttribute('d', cablePath(a, [dragCable.x, dragCable.y]));
      p.setAttribute('class', 'cable dragging');
      svg.append(p);
    }
  }
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
    return `Slot ${i + 1} ${s?.type ? DEVICES[s.type].name : ''}: ${spec ? spec.label : t.param}`;
  }
  if (t.target === 'mixer') {
    const spec = (t.channel != null ? CHANNEL_PARAMS : MIXER_PARAMS).find((p) => p.id === t.param);
    return `Sub Mixer ${t.mixer}${t.channel != null ? ` Ch ${t.channel + 1}` : ''}: ${spec?.label ?? t.param}`;
  }
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
        renderMixers();
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
  renderMixers();
  renderMain();
  renderMappings();
  requestAnimationFrame(drawCables);
  $('name').value = state.name || '';
  $('tempo').value = state.tempo;
  renderPresets();
}

function showPeaks(peaks) {
  for (const m of document.querySelectorAll('.meter')) {
    const p = peaks.slots[m.dataset.slot] || 0;
    const db = 20 * Math.log10(Math.max(p, 1e-6));
    m.firstChild.style.width = `${Math.min(Math.max((db + 60) / 60, 0), 1) * 100}%`;
  }
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
  state = st;
  if (selectedMacro >= state.macros.length) selectedMacro = 0;
  send();
  renderAll();
}

// ---- Wiring --------------------------------------------------------------------------------

$('rackIn').replaceWith(jack('out', 'in'));
$('rackOut').replaceWith(jack('in', 'rackout'));
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
for (const chip of document.querySelectorAll('.chip')) {
  chip.ondragstart = (e) => {
    dragFx = chip.dataset.fx;
    dragSlot = null;
    e.dataTransfer.effectAllowed = 'copy';
    e.dataTransfer.setData('text/plain', chip.dataset.fx);
  };
  chip.ondragend = () => {
    dragFx = null;
  };
  chip.onclick = () => {
    armedFx = armedFx === chip.dataset.fx ? null : chip.dataset.fx;
    for (const c of document.querySelectorAll('.chip')) c.classList.toggle('on', c.dataset.fx === armedFx);
    info(armedFx ? `Click a slot to put ${DEVICES[armedFx].name} there` : '');
  };
  // Double-click: into the first empty slot.
  chip.ondblclick = () => {
    const i = state.slots.findIndex((s) => !s.type);
    if (i >= 0) placeEffect(i, chip.dataset.fx);
    else info('No empty slot: drag onto a slot to replace it');
  };
}
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
$('hideCables').onclick = () => {
  $('hideCables').classList.toggle('on', document.body.classList.toggle('hide-cables'));
};
$('randMacros').onclick = () => {
  for (const m of state.macros) m.value = Math.random();
  send();
  renderAll();
};
$('addMixer').onclick = () => {
  const id = MIXER_IDS.find((x) => !state.mixers.some((m) => m.id === x));
  if (!id) return;
  state.mixers.push(newMixer(id));
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
addEventListener('resize', () => {
  drawWave();
  drawCables();
});

renderAll();
