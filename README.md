# Space FX

A multi-effects rack (Tape, Phaser, Spring) ported from the Rust DSP in
[Clip](https://github.com/johnnyhawk02/clip), prototyped in the browser as an AudioWorklet and
headed for VST3.

- Tape, Spring and Phaser, routed by a 3 x 3 grid of send dials (plus Rack In and Rack Out)
- 8 Macros, each mappable to any number of parameters
- Presets with generated alien and space names
- Live's labels, greyscale UI

Layout:

    dsp/      plain JS modules, no DOM: tape, filter (Polivoks), delay, phaser, spring, rack (routing), params
    worklet/  the AudioWorklet processor that runs the rack
    host/     the browser UI
    tools/    Rust reference renderer and comparison scripts

## Run it

Live at https://johnnyhawk02.github.io/space-fx/ (published from main by
`.github/workflows/pages.yml`).

Locally:

    npm run serve        # or any static server: python3 -m http.server
    open http://localhost:3000

Open (or drop) a WAV, press Play or Space. Tape, Spring and Phaser sit side by side, routed
by a grid of dials: each dial sends one row's output (Rack In, Tape, Spring, Phaser) into one
column's input (Tape, Spring, Phaser, Rack Out). It starts as In to Tape to Spring to Phaser to
Out. Modules run in the order the sends say; a send back up the chain (or a module's Self dial)
is feedback, one 64-frame block late through a soft clipper. A source further down the chain arrives 64
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
