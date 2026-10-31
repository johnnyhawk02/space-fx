# Space FX

A multi-effects rack (Tape, Phaser, Spring) ported from the Rust DSP in
[Clip](https://github.com/johnnyhawk02/clip), prototyped in the browser as an AudioWorklet and
headed for VST3.

- One rack-style device, 4 slots, each with an In and an Out
- Sub Mixers blend several signals and feed them back into the chain
- 8 Macros, each mappable to any number of parameters
- Presets with generated alien and space names
- Live's labels, greyscale UI

Layout:

    dsp/      plain JS modules, no DOM: tape, phaser, spring, rack (routing), params
    worklet/  the AudioWorklet processor that runs the rack
    host/     the browser UI
    tools/    Rust reference renderer and comparison scripts
