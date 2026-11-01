//! The rack (dsp/rack.js): Tape, Filter, Delay, Spring and Phaser, wired by the routing Mode.
//! Underneath, the Mode makes a grid of sends (every module's output into every module's input,
//! plus Rack In and Rack Out). Modules run in the order the sends need; a send that closes a
//! loop uses the block before, 64 frames late, through a soft clipper: that's the Feedback.
//! The Spring always comes last, after the loop. Then Main Dry/Wet, Volume and a limiter.
//!
//! The host's buffers are cut into 64-frame blocks through a FIFO, so the rack reports 64
//! frames of latency and behaves the same at any host buffer size.

use super::delay::{Delay, DelayParams};
use super::filter::{Filter, FilterParams};
use super::phaser::{Phaser, PhaserParams};
use super::spring::{Spring, SpringParams};
use super::tape::{Tape, TapeParams};

pub const BLOCK: usize = 64;
pub const N_MOD: usize = 5;

pub const TAPE: usize = 0;
pub const FILTER: usize = 1;
pub const DELAY: usize = 2;
pub const SPRING: usize = 3;
pub const PHASER: usize = 4;
/// The Spring sits after the Feedback loop in every Mode.
pub const TAIL: usize = SPRING;
pub const MODULE_NAMES: [&str; N_MOD] = ["Tape", "Filter", "Delay", "Spring", "Phaser"];

pub struct Mode {
    pub label: &'static str,
    /// The modules in the loop, in order (the Spring follows). Empty for Parallel.
    pub order: &'static [usize],
    pub parallel: bool,
}

pub const MODES: [Mode; 4] = [
    Mode { label: "Series", order: &[TAPE, FILTER, DELAY, PHASER], parallel: false },
    Mode { label: "Reverse", order: &[PHASER, DELAY, FILTER, TAPE], parallel: false },
    Mode { label: "Parallel", order: &[], parallel: true },
    Mode { label: "Echo + Verb", order: &[TAPE, DELAY], parallel: false },
];

/// Send gains (linear). `sends[src][dst]` is module `src`'s output into module `dst`'s input.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Routes {
    pub from_in: [f64; N_MOD],
    pub sends: [[f64; N_MOD]; N_MOD],
    pub to_out: [f64; N_MOD],
}

impl Routes {
    /// A chain through `order`: In to the first, each to the next, the last to Out.
    pub fn chain(order: &[usize]) -> Self {
        let mut r = Self::default();
        if let (Some(&first), Some(&last)) = (order.first(), order.last()) {
            r.from_in[first] = 1.0;
            for w in order.windows(2) {
                r.sends[w[0]][w[1]] = 1.0;
            }
            r.to_out[last] = 1.0;
        }
        r
    }

    /// The sends a Mode makes. Feedback (0..1) goes from the end of the Mode's modules back to
    /// their start (in Parallel, each module back into itself), at most -3 dB.
    pub fn for_mode(mode: usize, feedback: f64) -> Self {
        let m = MODES.get(mode).unwrap_or(&MODES[0]);
        let g = feedback.clamp(0.0, 1.0) * 0.7;
        // Sends at or below -60 dB are off, as in the prototype.
        let fb = if g > 0.001 { g } else { 0.0 };
        if m.parallel {
            let mut r = Self::default();
            for t in 0..N_MOD {
                if t == TAIL {
                    continue;
                }
                r.from_in[t] = 1.0;
                r.sends[t][TAIL] = 10f64.powf(-6.0 / 20.0);
                r.sends[t][t] = fb;
            }
            r.to_out[TAIL] = 1.0;
            return r;
        }
        let mut order = [0usize; N_MOD];
        let n = m.order.len();
        order[..n].copy_from_slice(m.order);
        order[n] = TAIL;
        let mut r = Self::chain(&order[..=n]);
        r.sends[m.order[n - 1]][m.order[0]] = fb;
        r
    }

    /// Module indices in the order the sends need them: anything a module listens to runs
    /// before it, except where that closes a loop.
    pub fn run_order(&self) -> [usize; N_MOD] {
        fn visit(r: &Routes, i: usize, seen: &mut [bool; N_MOD], out: &mut [usize; N_MOD], n: &mut usize) {
            if seen[i] {
                return;
            }
            seen[i] = true;
            for j in 0..N_MOD {
                if j != i && r.sends[j][i] > 0.0 {
                    visit(r, j, seen, out, n);
                }
            }
            out[*n] = i;
            *n += 1;
        }
        let mut seen = [false; N_MOD];
        let mut out = [0; N_MOD];
        let mut n = 0;
        for i in 0..N_MOD {
            if self.to_out[i] > 0.0 {
                visit(self, i, &mut seen, &mut out, &mut n);
            }
        }
        for i in 0..N_MOD {
            visit(self, i, &mut seen, &mut out, &mut n);
        }
        out
    }
}

/// Everything the rack needs from the controls, read once per host buffer.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Settings {
    pub tempo: f64,
    pub on: [bool; N_MOD],
    pub tape: TapeParams,
    pub filter: FilterParams,
    pub delay: DelayParams,
    pub spring: SpringParams,
    pub phaser: PhaserParams,
    pub mode: usize,
    /// Routing Feedback, 0..1.
    pub feedback: f64,
    pub dry_wet: f64,
    pub volume_db: f64,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            tempo: 120.0,
            on: [true; N_MOD],
            tape: TapeParams::default(),
            filter: FilterParams::default(),
            delay: DelayParams::default(),
            spring: SpringParams::default(),
            phaser: PhaserParams::default(),
            mode: 0,
            feedback: 0.0,
            dry_wet: 1.0,
            volume_db: 0.0,
        }
    }
}

type Stereo = [[f32; BLOCK]; 2];

pub struct Rack {
    rate: f64,
    tape: Tape,
    filter: Filter,
    delay: Delay,
    spring: Spring,
    phaser: Phaser,
    cur: [Stereo; N_MOD],
    prev: [Stereo; N_MOD],
    input: Stereo,
    output: Stereo,
    fifo_in: Stereo,
    fifo_out: Stereo,
    pos: usize,
    lim_gain: f64,
    /// Each module's peak level over the last block, and Rack Out's.
    pub peaks: [f32; N_MOD],
    pub peak_out: f32,
}

impl Rack {
    pub fn new(rate: f64) -> Self {
        Self {
            rate,
            tape: Tape::new(rate),
            filter: Filter::new(rate),
            delay: Delay::new(rate),
            spring: Spring::new(rate),
            phaser: Phaser::new(rate),
            cur: [[[0.0; BLOCK]; 2]; N_MOD],
            prev: [[[0.0; BLOCK]; 2]; N_MOD],
            input: [[0.0; BLOCK]; 2],
            output: [[0.0; BLOCK]; 2],
            fifo_in: [[0.0; BLOCK]; 2],
            fifo_out: [[0.0; BLOCK]; 2],
            pos: 0,
            lim_gain: 1.0,
            peaks: [0.0; N_MOD],
            peak_out: 0.0,
        }
    }

    pub fn latency() -> u32 {
        BLOCK as u32
    }

    /// Clear every tail, without allocating.
    pub fn reset(&mut self) {
        self.tape.reset();
        self.filter.reset();
        self.delay.reset();
        self.spring.reset();
        self.phaser.reset();
        self.cur = [[[0.0; BLOCK]; 2]; N_MOD];
        self.prev = [[[0.0; BLOCK]; 2]; N_MOD];
        self.fifo_in = [[0.0; BLOCK]; 2];
        self.fifo_out = [[0.0; BLOCK]; 2];
        self.pos = 0;
        self.lim_gain = 1.0;
    }

    /// Process L and R in place, any length. The output is `BLOCK` frames late.
    pub fn process(&mut self, l: &mut [f32], r: &mut [f32], s: &Settings) {
        for f in 0..l.len().min(r.len()) {
            let (x, y) = (l[f], r[f]);
            l[f] = self.fifo_out[0][self.pos];
            r[f] = self.fifo_out[1][self.pos];
            self.fifo_in[0][self.pos] = x;
            self.fifo_in[1][self.pos] = y;
            self.pos += 1;
            if self.pos == BLOCK {
                self.pos = 0;
                self.input = self.fifo_in;
                self.block(s);
                self.fifo_out = self.output;
            }
        }
    }

    /// Process straight through in 64-frame blocks, with no FIFO and so no latency, as the
    /// prototype does. The length must be a multiple of `BLOCK`. For tests.
    pub fn process_blocks(&mut self, l: &mut [f32], r: &mut [f32], s: &Settings) {
        assert!(l.len() % BLOCK == 0 && l.len() == r.len());
        for (cl, cr) in l.chunks_exact_mut(BLOCK).zip(r.chunks_exact_mut(BLOCK)) {
            self.input[0].copy_from_slice(cl);
            self.input[1].copy_from_slice(cr);
            self.block(s);
            cl.copy_from_slice(&self.output[0]);
            cr.copy_from_slice(&self.output[1]);
        }
    }

    fn run_module(&mut self, i: usize, buf: &mut Stereo, s: &Settings, beat: f64) {
        let [l, r] = buf;
        match i {
            TAPE => self.tape.process(l, r, &s.tape),
            FILTER => self.filter.process(l, r, &s.filter),
            DELAY => self.delay.process(l, r, &s.delay, beat),
            SPRING => self.spring.process(l, r, &s.spring),
            _ => self.phaser.process(l, r, &s.phaser, beat),
        }
    }

    /// One block from `self.input` into `self.output`.
    pub fn block(&mut self, s: &Settings) {
        let routes = Routes::for_mode(s.mode, s.feedback);
        std::mem::swap(&mut self.cur, &mut self.prev);
        let mut done = [false; N_MOD];
        let beat = self.rate * 60.0 / s.tempo.max(1.0);

        for i in routes.run_order() {
            let mut buf: Stereo = [[0.0; BLOCK]; 2];
            let g_in = routes.from_in[i] as f32;
            for c in 0..2 {
                for f in 0..BLOCK {
                    buf[c][f] = self.input[c][f] * g_in;
                }
            }
            for src in 0..N_MOD {
                let g = routes.sends[src][i] as f32;
                if !(g > 0.0) {
                    continue;
                }
                if done[src] {
                    for c in 0..2 {
                        for f in 0..BLOCK {
                            buf[c][f] += self.cur[src][c][f] * g;
                        }
                    }
                } else {
                    // Feedback: last block's output, soft clipped.
                    for c in 0..2 {
                        for f in 0..BLOCK {
                            buf[c][f] += self.prev[src][c][f].tanh() * g;
                        }
                    }
                }
            }
            if s.on[i] {
                self.run_module(i, &mut buf, s, beat);
            }
            self.peaks[i] = buf.iter().flatten().fold(0.0f32, |m, v| m.max(v.abs()));
            self.cur[i] = buf;
            done[i] = true;
        }

        // Rack Out against the dry input by Main Dry/Wet, then Volume and the limiter.
        let dw = s.dry_wet.clamp(0.0, 1.0);
        let vol = if s.volume_db <= -60.0 { 0.0 } else { 10f64.powf(s.volume_db / 20.0) };
        let ceiling = 0.966;
        let rel = (-1.0 / (0.1 * self.rate)).exp();
        let mut peak = 0.0f32;
        let mut bad = false;
        for f in 0..BLOCK {
            let mut wet = [0.0f64; 2];
            for m in 0..N_MOD {
                let g = routes.to_out[m];
                if g > 0.0 {
                    wet[0] += self.cur[m][0][f] as f64 * g;
                    wet[1] += self.cur[m][1][f] as f64 * g;
                }
            }
            let mut l = (self.input[0][f] as f64 * (1.0 - dw) + wet[0] * dw) * vol;
            let mut r = (self.input[1][f] as f64 * (1.0 - dw) + wet[1] * dw) * vol;
            if !l.is_finite() || !r.is_finite() {
                l = 0.0;
                r = 0.0;
                bad = true;
            }
            // Limiter: instant attack, 100 ms release.
            let a = l.abs().max(r.abs());
            let want = if a > ceiling { ceiling / a } else { 1.0 };
            self.lim_gain = if want < self.lim_gain { want } else { want + (self.lim_gain - want) * rel };
            let ol = (l * self.lim_gain).clamp(-1.0, 1.0) as f32;
            let or = (r * self.lim_gain).clamp(-1.0, 1.0) as f32;
            self.output[0][f] = ol;
            self.output[1][f] = or;
            peak = peak.max(ol.abs()).max(or.abs());
        }
        if bad {
            self.reset();
        }
        self.peak_out = peak;
    }
}
