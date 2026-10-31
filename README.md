# Space FX

A multi-effects rack (Tape, Phaser, Spring) ported from the Rust DSP in
[Clip](https://github.com/johnnyhawk02/clip), prototyped in the browser as an AudioWorklet and
headed for VST3.

- A patchbay: Tape, Spring and Phaser modules, each with an In and an Out, joined by cables
- Sub Mixers blend several signals and feed them back into the chain
- 8 Macros, each mappable to any number of parameters
- Presets with generated alien and space names
- Live's labels, greyscale UI

Layout:

    dsp/      plain JS modules, no DOM: tape, phaser, spring, rack (routing), params
    worklet/  the AudioWorklet processor that runs the rack
    host/     the browser UI
    tools/    Rust reference renderer and comparison scripts

## Run it

Live at https://johnnyhawk02.github.io/space-fx/ (published from main by
`.github/workflows/pages.yml`).

Locally:

    npm run serve        # or any static server: python3 -m http.server
    open http://localhost:3000

Open (or drop) a WAV, press Play or Space. It's a patchbay: Tape, Spring and Phaser modules,
each with its dials, joined by cables. Drag from an Out jack (Rack In, a module's Out, a Sub
Mixer's Out) to an In jack (a module's In, a mixer channel's In, Rack Out); drag a cable off an
In to unplug it. Modules run in the order the cables say. Add Sub Mixer blends up to 4 sources
with Level, Pan, Low Cut, High Cut and Delay. A source further down the chain arrives 64
samples late through a soft clipper: that's feedback. Map, then a Macro, then any control maps
it; Min and Max are set in the list below the rack. Presets save in the browser; Rand makes a
random rack with a new name. Export Audio renders offline through the same code.

## Tests

    npm test                       # DSP and rack checks in Node
    tools/compare.sh in.wav        # JS against Clip's Rust, a sanity check (needs cargo)

The port doesn't have to match Clip exactly, but at the moment it nearly does: Phaser is
sample-identical, Spring is about 110 dB down, Tape about 50 dB down (wow's random drift
wanders slightly differently).

## Differences from Clip

- Dry/Wet starts at 50% on every device.
- Spring rebuilds its tank when Tone changes, as Clip does, but only once Tone has been still
  for 100 ms, so a Macro sweeping it doesn't keep emptying the tank.
