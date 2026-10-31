// The AudioWorklet side: runs one Rack. Messages in: { type: 'state', state } and
// { type: 'reset' }. Messages out, about 20 a second: { type: 'peaks', peaks }.

import { Rack } from '../dsp/rack.js';

class RackProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.rack = new Rack(sampleRate);
    const init = options?.processorOptions?.state;
    if (init) this.rack.setState(init);
    this.silence = new Float32Array(128);
    this.since = 0;
    this.port.onmessage = (e) => {
      const m = e.data;
      if (m.type === 'state') this.rack.setState(m.state);
      else if (m.type === 'reset') this.rack.reset();
    };
  }

  process(inputs, outputs) {
    const input = inputs[0];
    const out = outputs[0];
    const n = out[0].length;
    if (this.silence.length < n) this.silence = new Float32Array(n);
    const L = input[0] || this.silence.subarray(0, n);
    const R = input[1] || L;
    this.rack.process(L, R, out[0], out[1] || out[0], n);
    this.since += n;
    if (this.since >= sampleRate / 20) {
      this.since = 0;
      this.port.postMessage({ type: 'peaks', peaks: this.rack.peaks });
    }
    return true;
  }
}

registerProcessor('rack-processor', RackProcessor);
