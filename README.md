# Space FX

A multi-effects rack (Tape, Filter, Delay, Phaser, Spring) ported from the Rust DSP in
[Clip](https://github.com/johnnyhawk02/clip), prototyped in the browser as an AudioWorklet, and
built as a VST3 and CLAP plugin in `plugin/`.

## The plugin

To install the latest Mac build (universal: Apple Silicon and Intel), paste this into Terminal:

    curl -fsSL https://raw.githubusercontent.com/johnnyhawk02/space-fx/main/plugin/install.sh | bash

It downloads the build that `.github/workflows/plugin.yml` makes on every push to main, puts
`Space FX.vst3` and `Space FX.clap` in `~/Library/Audio/Plug-Ins`, and that's it: files fetched
by curl aren't flagged as downloaded, so macOS doesn't block the plugin, which is signed ad hoc
rather than notarised by Apple. Run it again to update. Then rescan plugins in the DAW.

Or download [Space-FX-macOS.zip](https://github.com/johnnyhawk02/space-fx/releases/download/plugin-latest/Space-FX-macOS.zip)
by hand and run `install-mac.command` in it. macOS will say it "could not verify" the script:
click Done, open System Settings > Privacy & Security, scroll down, click Open Anyway next to
install-mac.command, and confirm.

It's the browser rack as one plugin: the same five modules and Routing panel (Mode and
Feedback, Spring always last), the same controls with the same ranges and defaults, every one
automatable, and the same black-and-white pictures. Delay and Phaser Sync follow the host's
tempo. The rack works in 64-frame blocks, so it reports 64 samples of latency.

Built in Rust with [nih-plug](https://github.com/robbert-vdh/nih-plug) and an egui editor. The
DSP in `plugin/src/dsp/` is a line-by-line port of `dsp/*.js`, and `plugin/tests/match_js.rs`
renders the same signal through both: every module and every Mode match to better than 120 dB.

    cd plugin
    cargo test                                        # DSP checks (the JS comparison needs node)
    cargo xtask bundle space_fx --release             # target/bundled/Space FX.vst3 and .clap
    cargo xtask bundle-universal space_fx --release   # on a Mac: Apple Silicon + Intel in one
    cargo run --release --features standalone         # a standalone window, no DAW needed

Because nih-plug's VST3 support uses the GPLv3 VST3 bindings, the plugin is GPL-3.0.

- Tape, Spring and Phaser, routed by a 3 x 3 grid of send dials (plus Rack In and Rack Out)
- 8 Macros, each mappable to any number of parameters
- Presets with generated alien and space names
- Live's labels, greyscale UI

Layout:

    dsp/      plain JS modules, no DOM: tape, filter (Polivoks), delay, phaser, spring, rack (routing), params
    worklet/  the AudioWorklet processor that runs the rack
    host/     the browser UI
    tools/    Rust reference renderer and comparison scripts; render-js.mjs feeds the plugin's tests
    plugin/   the VST3 / CLAP plugin (Rust, nih-plug)

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

- Spring is true stereo: each spring hears 80% of its own side and 20% of the other (Clip feeds
  both the mono sum).
- Delay has a Ping Pong switch: the echo goes hard left or right, the side flipping every Time,
  so repeats from the Routing Feedback bounce L, R, L, R.
- Dry/Wet starts at 50% on every device.
- Spring rebuilds its tank when Tone changes, as Clip does, but only once Tone has been still
  for 100 ms, so a Macro sweeping it doesn't keep emptying the tank.
