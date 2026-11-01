// The AudioWorklet side: runs one SpaceDrive. Messages in: { type: 'state', state } and
// { type: 'reset' }. Out, about 30 a second: { type: 'meter', level, step, cutoff }.

import { SpaceDrive } from '../dsp/engine.js';

class DriveProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.fx = new SpaceDrive(sampleRate);
    const init = options?.processorOptions?.state;
    if (init) this.fx.setState(init);
    this.since = 0;
    this.L = new Float32Array(128);
    this.R = new Float32Array(128);
    this.port.onmessage = (e) => {
      const m = e.data;
      if (m.type === 'state') this.fx.setState(m.state);
      else if (m.type === 'reset') this.fx.reset();
      else if (m.type === 'restart') this.fx.seq.reset();
    };
  }

  process(inputs, outputs) {
    const input = inputs[0];
    const out = outputs[0];
    const n = out[0].length;
    if (this.L.length < n) {
      this.L = new Float32Array(n);
      this.R = new Float32Array(n);
    }
    const L = this.L.subarray(0, n);
    const R = this.R.subarray(0, n);
    if (input[0]) L.set(input[0]);
    else L.fill(0);
    if (input[1]) R.set(input[1]);
    else R.set(L);
    this.fx.process(L, R, n);
    out[0].set(L);
    if (out[1]) out[1].set(R);
    this.since += n;
    if (this.since >= sampleRate / 30) {
      this.since = 0;
      const fx = this.fx;
      this.port.postMessage({ type: 'meter', level: fx.level, step: fx.seq.current(fx.state.seq), pos: fx.seq.pos, seqOut: fx.seq.out, cutoff: fx.filter.fc });
    }
    return true;
  }
}

registerProcessor('drive-processor', DriveProcessor);
