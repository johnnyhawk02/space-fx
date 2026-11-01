// Space Drive: Drive (the antialiased waveshaper), Filter (the swept SVF) and the Sequencer that
// moves it. Filter after Drive by default, as a synth's filter follows its oscillator; Pre puts
// it first, like a wah into a fuzz, so the sweep changes what distorts. Plain JS with no DOM, so
// it runs the same in the AudioWorklet, in Node and (ported line by line) in the Rust plugin.
//
// The oversampler delays everything by LATENCY frames, always, even with Drive switched off
// (it fades to its delayed dry side), so the plugin's reported latency never changes.

import { Shaper, LATENCY } from './shaper.js';
import { AutoFilter } from './autofilter.js';
import { Sequencer } from './sequencer.js';
import { driveState } from './params.js';

export { LATENCY };

export class SpaceDrive {
  constructor(rate) {
    this.rate = rate;
    this.shaper = new Shaper(rate);
    this.filter = new AutoFilter(rate);
    this.seq = new Sequencer(rate);
    this.seqBuf = new Float64Array(128);
    this.state = driveState();
    this.level = 0;
  }

  setState(st) {
    this.state = st;
  }

  reset() {
    this.shaper = new Shaper(this.rate);
    this.filter = new AutoFilter(this.rate);
    this.seq.reset();
  }

  // Process n frames of L and R in place. `songBeats`: the host's position at the first frame.
  process(L, R, n, songBeats = null) {
    const st = this.state;
    if (this.seqBuf.length < n) this.seqBuf = new Float64Array(n);
    const beat = (this.rate * 60) / Math.max(st.tempo || 120, 1);
    this.seq.render(this.seqBuf, n, st.seq, beat, songBeats);
    const seq = st.on.seq ? this.seqBuf : null;
    const filter = () => {
      if (st.on.filter) this.filter.process(L, R, n, st.filter, seq);
    };
    if (st.filter.pre) filter();
    this.shaper.process(L, R, n, st.on.drive ? st.drive : { ...st.drive, mix: 0 });
    if (!st.filter.pre) filter();
    let peak = 0;
    for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
    this.level = peak;
  }
}
