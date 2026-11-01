# Space Drive

A distortion into a sequenced filter, in Space FX's style: three cards in a row, a live
black-and-white picture on each, the same dials on the same grid. Live at
https://johnnyhawk02.github.io/space-fx/drive/, and built as a VST3 and CLAP plugin
(`plugin/drive`) that installs alongside Space FX with the same Terminal line.

- **Drive**: Type (Soft, Diode, Fuzz, Fold), Drive (0 to +40 dB), Bias (asymmetry, even
  harmonics), Tone (tilt, +-12 dB around 800 Hz), Output, Dry/Wet (parallel distortion). Drive
  is level-matched, so turning it up changes the colour more than the loudness.
- **Filter**: Mode (LP, BP, HP), Cutoff, Res, Env (the input's level moves the Cutoff, +-4
  octaves), Seq (the Sequencer moves it, +-4 octaves), Pre (filter before the distortion, like a
  wah into a fuzz; otherwise after it, like a synth).
- **Sequencer**: 16 steps you draw in its picture (drag across it; double-click a step for 0),
  Sync (a note value per step, locked to the host's bar while it plays) or a free Rate in Hz,
  Steps (1 to 16), Slew (each step glides in from the last over that share of its length) and
  Swing (every other step late, up to a triplet feel).

## The research, and what it chose

The literature on digital distortion splits into three families.

1. **Memoryless waveshaping with antialiasing.** A static curve is cheap and is what most of a
   pedal's character comes down to, but clipping makes harmonics far above Nyquist that fold
   back as inharmonic aliasing. *Antiderivative antialiasing* (ADAA) fixes most of it without
   heavy oversampling: output the average of the curve over the line between successive input
   samples, (F(x[n]) - F(x[n-1])) / (x[n] - x[n-1]), F being the curve's antiderivative.
   Parker, Zavalishin and Le Bivic, [Reducing the aliasing of nonlinear waveshaping using
   continuous-time convolution](https://dafx.de/paper-archive/details/vem_XXF5qBbfiWOH2RVVAA),
   DAFx-16; generalised to higher orders by Bilbao, Esqueda, Parker and Välimäki,
   *Antiderivative antialiasing for memoryless nonlinearities*, IEEE Signal Processing Letters
   24(7), 2017; extended to circuits with memory by Holters, [Antiderivative antialiasing for
   stateful systems](https://dafx.de/paper-archive/details/lp5GcJOo79OBkfcMfN3N_g), DAFx-19.
   Esqueda's thesis, [Aliasing reduction in nonlinear audio signal
   processing](https://aaltodoc.aalto.fi/items/a46ae786-3014-4c49-a409-957b4c330bcd) (Aalto
   2018), compares it with BLAMP corner-rounding and oversampling.
2. **Physical circuit models.** Solve the actual circuit: Yeh, Abel and Smith, [Simulation of
   the diode limiter in guitar distortion circuits by numerical solution of ordinary differential
   equations](https://dafx.de/paper-archive/details/pjj7lul37xFyy74-VjhoYw), DAFx-07, and Yeh's
   thesis [Digital implementation of musical distortion
   circuits](https://ccrma.stanford.edu/~dtyeh/papers/DavidYehThesisdoublesided.pdf) (Stanford
   2009); wave digital filters with diode nonlinearities, Werner, Nangia, Smith and Abel, [An
   improved and generalized diode clipper model for wave digital
   filters](https://ccrma.stanford.edu/papers/improved-and-generalized-diode-clipper-model-wave-digital-filters)
   (AES 2015) and [Resolving wave digital filters with multiple/multiport
   nonlinearities](https://dafx.de/paper-archive/details/4fsq4pZNdCbUzyzAL8xsQg) (DAFx-15);
   wavefolders, Esqueda, Pöntynen, Parker and Bilbao, [Virtual analog models of the Lockhart and
   Serge wavefolders](https://www.mdpi.com/2076-3417/7/12/1328) (Applied Sciences, 2017); tube
   amps, Pakarinen and Yeh, [A review of digital techniques for modeling vacuum-tube guitar
   amplifiers](https://muse.jhu.edu/article/266412) (Computer Music Journal 33(2), 2009).
3. **Black-box models.** Volterra series (Schattschneider and Zölzer, DAFx-99; Hélie, IEEE
   TASLP 2010) and, now, neural networks trained on one specific pedal (Wright, Damskägg and
   Välimäki, DAFx-19). They copy a particular box exactly but aren't a set of knobs to play with.

**Chosen:** family 1, shaped by family 2. Each Type is a curve with a closed-form antiderivative,
picked to stand for a real circuit: Soft is tanh (a balanced transistor or op-amp stage); Diode is
asinh, the static solution of Yeh's diode limiter, which grows logarithmically instead of
flattening; Fuzz is a hard clip; Fold is a sine wavefolder after Esqueda's Serge and Lockhart
models. Bias offsets the curve, f(x + b) - f(b), whose antiderivative stays closed-form
(F(x + b) - x f(b)), so the asymmetric, tube-like even harmonics are antialiased too. ADAA runs at
2x oversampling (a 47-tap half-band FIR each way), the combination Parker et al. recommend:
against a naive clipper at +40 dB on a 2 kHz sine, aliasing drops by 28 to 32 dB on Soft, Diode and
Fuzz and 24 dB on Fold (`test/drive.test.js`, `plugin/drive/tests/dsp.rs`). Cost: 23 samples of
latency, reported to the DAW.

The filter is Zavalishin's zero-delay-feedback state-variable filter ([The Art of VA Filter
Design](https://www.native-instruments.com/fileadmin/ni_media/downloads/pdf/VAFilterDesign_2.1.0.pdf)):
it keeps its tuning and resonance up to Nyquist and stays stable however fast the cutoff jumps,
which a step sequencer makes it do. The Sequencer's Slew is an RC-like glide (1 - e^-4t, scaled to
land on the step), timed as a share of the step, so it stays in time at any tempo.

## Code

    drive/dsp/       shaper.js (Drive), autofilter.js, sequencer.js, engine.js, params.js
    drive/host/      the page (app.js, graphics.js), on top of Space FX's host/style.css
    drive/worklet/   the AudioWorklet processor
    plugin/drive/    the plugin: src/dsp is a line-by-line port of drive/dsp
    tools/render-drive.mjs   renders the JS for plugin/drive/tests/match_js.rs (matches to >250 dB)
