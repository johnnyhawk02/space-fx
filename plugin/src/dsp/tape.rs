//! Tape: Chowdhury's physical model of an analog tape machine (DAFx-19), via Clip's tape.rs and
//! the prototype's dsp/tape.js. Jiles-Atherton hysteresis by RK4 at 2x, wow and flutter, the play
//! head's loss filter as an FIR, a 60 Hz high-pass and an LFO on the tape's travel. The play head
//! sits a few ms after the record head and the dry signal waits as long, so Dry/Wet doesn't comb.

use super::lfo::{Lfo, Wobble};
use super::{clamp, cubic, Rng};
use std::f64::consts::PI;

const A: f64 = 0.25;
const K: f64 = A * 27.0 / 22.0;
const MS: f64 = A * 3.5e5 / 22e3;
const C: f64 = 0.17;
const ALPHA: f64 = 1.6e-3;
const OVER: usize = 2;
const GAP: f64 = 5e-6;
const THICK: f64 = 10e-6;
pub const FIR_LEN: usize = 33;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct TapeParams {
    pub drive: f64,
    pub bias: f64,
    /// Tape speed in inches per second.
    pub speed: f64,
    /// Head spacing in microns.
    pub spacing: f64,
    pub mix: f64,
    pub wow: f64,
    pub lfo_shape: usize,
    pub lfo_rate: f64,
    pub lfo_slow: bool,
    /// ms
    pub lfo_depth: f64,
    pub lfo_slew: f64,
}

impl Default for TapeParams {
    fn default() -> Self {
        Self {
            drive: 0.5,
            bias: 0.9,
            speed: 15.0,
            spacing: 5.0,
            mix: 0.5,
            wow: 0.3,
            lfo_shape: 0,
            lfo_rate: 0.5,
            lfo_slow: false,
            lfo_depth: 0.0,
            lfo_slew: 0.0,
        }
    }
}

fn c_for(bias: f64) -> f64 {
    C + (0.9 - C) * clamp(bias, 0.0, 1.0)
}

fn dmdt(m: f64, h: f64, hd: f64, c: f64) -> f64 {
    let x = (h + ALPHA * m) / A;
    let (l, dl) = if x.abs() < 1e-4 {
        (x / 3.0, 1.0 / 3.0)
    } else {
        let coth = 1.0 / x.tanh();
        (coth - 1.0 / x, 1.0 / (x * x) - coth * coth + 1.0)
    };
    let man = MS * l;
    let ds = if hd >= 0.0 { 1.0 } else { -1.0 };
    let dm = if ds * (man - m) > 0.0 { 1.0 } else { 0.0 };
    let mut den = (1.0 - c) * ds * K - ALPHA * (man - m);
    if den.abs() < 1e-9 {
        den = if den < 0.0 || (den == 0.0 && den.is_sign_negative()) { -1e-9 } else { 1e-9 };
    }
    let irr = (1.0 - c) * dm * (man - m) / den * hd;
    let rev = c * MS / A * hd * dl;
    (irr + rev) / (1.0 - c * ALPHA * MS / A * dl)
}

/// One side's tape magnetisation.
#[derive(Default, Clone)]
struct Hysteresis {
    m: f64,
    h: f64,
    hd: f64,
}

impl Hysteresis {
    fn step(&mut self, h: f64, t: f64, c: f64) -> f64 {
        let hd = 2.0 * (h - self.h) / t - 0.98 * self.hd;
        let hm = 0.5 * (h + self.h);
        let hdm = 0.5 * (hd + self.hd);
        let k1 = t * dmdt(self.m, self.h, self.hd, c);
        let k2 = t * dmdt(self.m + k1 / 2.0, hm, hdm, c);
        let k3 = t * dmdt(self.m + k2 / 2.0, hm, hdm, c);
        let k4 = t * dmdt(self.m + k3, h, hd, c);
        let m = self.m + k1 / 6.0 + k2 / 3.0 + k3 / 3.0 + k4 / 6.0;
        if m.is_finite() {
            self.m = clamp(m, -MS, MS);
            self.h = h;
            self.hd = hd;
        } else {
            *self = Self::default();
        }
        self.m
    }
}

/// The play head's losses for tape speed `ips` and spacing (microns), as a linear-phase FIR.
pub fn loss_fir(rate: f64, ips: f64, spacing_um: f64) -> [f64; FIR_LEN] {
    let v = ips * 0.0254;
    let d = spacing_um * 1e-6;
    const N: usize = 256;
    let gain = |f: f64| {
        let k = 2.0 * PI * f / v;
        if k == 0.0 {
            return 1.0;
        }
        let space = (-k * d).exp();
        let thick = (1.0 - (-k * THICK).exp()) / (k * THICK);
        let x = k * GAP / 2.0;
        space * thick * (x.sin() / x)
    };
    let mut mags = [0.0; N / 2 + 1];
    for (b, m) in mags.iter_mut().enumerate() {
        *m = gain(b as f64 * rate / N as f64);
    }
    let mut h = [0.0; FIR_LEN];
    let mid = (FIR_LEN / 2) as f64;
    for (i, hi) in h.iter_mut().enumerate() {
        let t = i as f64 - mid;
        let mut s = mags[0];
        for (b, &m) in mags.iter().enumerate().skip(1) {
            let w = if b == N / 2 { 1.0 } else { 2.0 };
            s += w * m * (2.0 * PI * b as f64 * t / N as f64).cos();
        }
        let hann = 0.5 - 0.5 * (2.0 * PI * (i as f64 + 1.0) / (FIR_LEN as f64 + 1.0)).cos();
        // The JS keeps the taps in 32-bit floats.
        *hi = ((s / N as f64 * hann) as f32) as f64;
    }
    let sum = h.iter().sum::<f64>().max(1e-6);
    for hi in h.iter_mut() {
        *hi = ((*hi / sum) as f32) as f64;
    }
    h
}

pub struct Tape {
    rate: f64,
    c: f64,
    tape: [Hysteresis; 2],
    prev_in: [f64; 2],
    len: usize,
    buf: [Vec<f32>; 2],
    dry: [Vec<f32>; 2],
    i: usize,
    fir: [f64; FIR_LEN],
    fir_for: (f64, f64),
    hist: [[f32; FIR_LEN]; 2],
    hi: usize,
    hp: [f64; 2],
    hp_x: [f64; 2],
    wobble: Wobble,
    rng: Rng,
    lfo: Lfo,
}

impl Tape {
    pub fn new(rate: f64) -> Self {
        let d = TapeParams::default();
        let len = (rate * 0.25).round() as usize;
        Self {
            rate,
            c: c_for(d.bias),
            tape: Default::default(),
            prev_in: [0.0; 2],
            len,
            buf: [vec![0.0; len], vec![0.0; len]],
            dry: [vec![0.0; len], vec![0.0; len]],
            i: 0,
            fir: loss_fir(rate, d.speed, d.spacing),
            fir_for: (d.speed, d.spacing),
            hist: [[0.0; FIR_LEN]; 2],
            hi: 0,
            hp: [0.0; 2],
            hp_x: [0.0; 2],
            wobble: Wobble::default(),
            rng: Rng(0x9e3779b9),
            lfo: Lfo::default(),
        }
    }

    /// Back to silence, without allocating.
    pub fn reset(&mut self) {
        self.tape = Default::default();
        self.prev_in = [0.0; 2];
        for c in 0..2 {
            self.buf[c].fill(0.0);
            self.dry[c].fill(0.0);
        }
        self.i = 0;
        self.hist = [[0.0; FIR_LEN]; 2];
        self.hi = 0;
        self.hp = [0.0; 2];
        self.hp_x = [0.0; 2];
        self.wobble = Wobble::default();
        self.rng = Rng(0x9e3779b9);
        self.lfo = Lfo::default();
    }

    /// Record `x` (side `c`) onto the tape: oversampled hysteresis, back to signal level.
    fn record(&mut self, c: usize, x: f64, drive: f64) -> f64 {
        let g = A * (0.6 + 3.4 * drive * drive);
        let t = 1.0 / (self.rate * OVER as f64);
        let mut acc = 0.0;
        let prev = self.prev_in[c];
        for j in 1..=OVER {
            let xi = prev + (x - prev) * j as f64 / OVER as f64;
            acc += self.tape[c].step(xi * g, t, self.c);
        }
        self.prev_in[c] = x;
        let norm = self.c + 0.095 * (1.0 - self.c);
        acc / OVER as f64 / (MS / (3.0 * A) * norm) / g
    }

    pub fn process(&mut self, l: &mut [f32], r: &mut [f32], p: &TapeParams) {
        if p.speed != self.fir_for.0 || p.spacing != self.fir_for.1 {
            self.fir = loss_fir(self.rate, p.speed, p.spacing);
            self.fir_for = (p.speed, p.spacing);
        }
        self.c = c_for(p.bias);
        let len = self.len;
        let rate = self.rate;
        let mix = clamp(p.mix, 0.0, 1.0);
        let wow = clamp(p.wow, 0.0, 1.0);
        let a_hp = (-2.0 * PI * 60.0 / rate).exp();
        let speed_k = ((p.speed / 7.5).clamp(0.3, 4.0) as f32).sqrt();
        let lfo_rate = clamp(p.lfo_rate, 0.01, 20.0) * if p.lfo_slow { 0.01 } else { 1.0 };
        let depth = clamp(p.lfo_depth, 0.0, 50.0) * 0.001 * rate;
        // Head gap: room for the widest wow and LFO swing, plus 2 ms. The dry side waits as long.
        let base = (0.002 * rate + 0.0026 * wow * rate + depth).ceil();
        let dry_delay = base as usize + FIR_LEN / 2;
        let n = l.len().min(r.len());
        let mut echo = [0.0f64; 2];
        for f in 0..n {
            let new_drift = self.i % 2048 == 0;
            let mut rnd = || self.rng.next();
            let wobble = wow * rate * self.wobble.next(new_drift, &mut rnd, speed_k, rate);
            let lfo = self.lfo.next(p.lfo_shape, lfo_rate, p.lfo_slew, rate, &mut rnd);
            let d = clamp(base + wobble + lfo * depth, 2.0, len as f64 - 4.0);
            let pos = (self.i + len) as f64 - d;
            let k = pos.floor() as usize;
            let fr = pos - k as f64;
            for (c, e) in echo.iter_mut().enumerate() {
                let b = &self.buf[c];
                let y0 = b[(k + len - 1) % len] as f64;
                let y1 = b[k % len] as f64;
                let y2 = b[(k + 1) % len] as f64;
                let y3 = b[(k + 2) % len] as f64;
                let raw = cubic(y0, y1, y2, y3, fr);
                let hist = &mut self.hist[c];
                hist[self.hi] = raw as f32;
                let mut y = 0.0;
                for t in 0..FIR_LEN {
                    y += self.fir[t] * hist[(self.hi + FIR_LEN - t) % FIR_LEN] as f64;
                }
                let hp = a_hp * (self.hp[c] + y - self.hp_x[c]);
                self.hp_x[c] = y;
                self.hp[c] = hp;
                *e = hp;
            }
            self.hi = (self.hi + 1) % FIR_LEN;
            for c in 0..2 {
                let io = if c == 0 { &mut *l } else { &mut *r };
                let x = io[f] as f64;
                self.dry[c][self.i] = x as f32;
                let rec = self.record(c, x, p.drive);
                self.buf[c][self.i] = rec as f32;
                let dry = self.dry[c][(self.i + len - dry_delay) % len] as f64;
                io[f] = (dry * (1.0 - mix) + echo[c] * mix) as f32;
            }
            self.i = (self.i + 1) % len;
        }
    }
}
