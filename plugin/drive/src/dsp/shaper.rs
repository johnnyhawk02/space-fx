//! Drive: a waveshaper with first-order antiderivative antialiasing at twice the sample rate.
//! See drive/dsp/shaper.js for the why; this is the same code.

use super::clamp;
use std::f64::consts::{LN_2, PI};

pub const TAPS: usize = 47;
/// Frames of delay at the base rate.
pub const LATENCY: usize = (TAPS - 1) / 2;
const HALF: usize = TAPS.div_ceil(2);
const CUT: f64 = 0.21;

/// The half-band low-pass shared by the up- and down-sampler: a Blackman-windowed sinc, sum 1.
pub fn halfband() -> [f64; TAPS] {
    let mut h = [0.0; TAPS];
    let m = (TAPS - 1) as f64 / 2.0;
    let mut sum = 0.0;
    for (j, hj) in h.iter_mut().enumerate() {
        let t = j as f64 - m;
        let sinc = if t == 0.0 { 2.0 * CUT } else { (2.0 * PI * CUT * t).sin() / (PI * t) };
        let n = (TAPS - 1) as f64;
        let w = 0.42 - 0.5 * ((2.0 * PI * j as f64) / n).cos() + 0.08 * ((4.0 * PI * j as f64) / n).cos();
        *hj = sinc * w;
        sum += *hj;
    }
    for hj in h.iter_mut() {
        *hj /= sum;
    }
    h
}

fn logcosh(x: f64) -> f64 {
    let a = x.abs();
    a + (-2.0 * a).exp().ln_1p() - LN_2
}

/// Each Type's curve.
pub fn curve(t: usize, x: f64) -> f64 {
    match t {
        1 => x.asinh(),
        2 => clamp(x, -1.0, 1.0),
        3 => x.sin(),
        _ => x.tanh(),
    }
}

/// Each Type's antiderivative.
pub fn anti(t: usize, x: f64) -> f64 {
    match t {
        1 => x * x.asinh() - (x * x + 1.0).sqrt(),
        2 => {
            if x.abs() <= 1.0 {
                0.5 * x * x
            } else {
                x.abs() - 0.5
            }
        }
        3 => -x.cos(),
        _ => logcosh(x),
    }
}

pub fn drive_gain(amount: f64) -> f64 {
    10f64.powf((clamp(amount, 0.0, 1.0) * 40.0) / 20.0)
}

pub fn bias_offset(bias: f64) -> f64 {
    clamp(bias, 0.0, 1.0) * 0.9
}

pub fn makeup(t: usize, gain: f64) -> f64 {
    let t = if t == 3 { 0 } else { t };
    0.25 / curve(t, 0.25 * gain).abs().max(1e-6)
}

pub const TYPES: [&str; 4] = ["Soft", "Diode", "Fuzz", "Fold"];

#[derive(Clone, Copy, Debug)]
pub struct DriveParams {
    pub kind: usize,
    pub amount: f64,
    pub bias: f64,
    pub tone: f64,
    pub output: f64,
    pub mix: f64,
}

impl Default for DriveParams {
    fn default() -> Self {
        Self { kind: 0, amount: 0.5, bias: 0.0, tone: 0.5, output: 0.0, mix: 1.0 }
    }
}

#[derive(Clone, Copy)]
struct Smooth {
    gain: f64,
    b: f64,
    out: f64,
    tone: f64,
    mix: f64,
}

#[derive(Clone)]
struct Side {
    up: [f64; HALF],
    down: [f64; TAPS],
    xp: f64,
    gp: f64,
    dry: [f64; LATENCY],
    dc: [f64; 2],
    lp: f64,
}

impl Side {
    fn new() -> Self {
        Self { up: [0.0; HALF], down: [0.0; TAPS], xp: 0.0, gp: 0.0, dry: [0.0; LATENCY], dc: [0.0; 2], lp: 0.0 }
    }
}

pub struct Shaper {
    h: [f64; TAPS],
    sides: [Side; 2],
    di: usize,
    sm: Option<Smooth>,
    smooth: f64,
    dc_r: f64,
    tone_a: f64,
}

impl Shaper {
    pub fn new(rate: f64) -> Self {
        Self {
            h: halfband(),
            sides: [Side::new(), Side::new()],
            di: 0,
            sm: None,
            smooth: 1.0 - (-1.0 / (0.02 * rate)).exp(),
            dc_r: ((-2.0 * PI * 10.0) / rate).exp(),
            tone_a: 1.0 - ((-2.0 * PI * 800.0) / rate).exp(),
        }
    }

    pub fn process(&mut self, l: &mut [f32], r: &mut [f32], p: &DriveParams) {
        let t = p.kind.min(3);
        let gain = drive_gain(p.amount);
        let want = Smooth {
            gain,
            b: bias_offset(p.bias),
            out: makeup(t, gain) * 10f64.powf(clamp(p.output, -24.0, 12.0) / 20.0),
            tone: (clamp(p.tone, 0.0, 1.0) - 0.5) * 24.0,
            mix: clamp(p.mix, 0.0, 1.0),
        };
        let mut sm = self.sm.unwrap_or(want);
        let k = self.smooth;
        let h = &self.h;
        for i in 0..l.len().min(r.len()) {
            sm.gain += (want.gain - sm.gain) * k;
            sm.b += (want.b - sm.b) * k;
            sm.out += (want.out - sm.out) * k;
            sm.tone += (want.tone - sm.tone) * k;
            sm.mix += (want.mix - sm.mix) * k;
            let fb = curve(t, sm.b);
            let gh = 10f64.powf(sm.tone / 40.0);
            let gl = 1.0 / gh;
            for c in 0..2 {
                let s = &mut self.sides[c];
                let io = if c == 0 { &mut l[i] } else { &mut r[i] };
                let x = *io as f64;
                s.up.copy_within(0..HALF - 1, 1);
                s.up[0] = x;
                for ph in 0..2 {
                    let mut u = 0.0;
                    let mut j = ph;
                    while j < TAPS {
                        u += h[j] * s.up[(j - ph) >> 1];
                        j += 2;
                    }
                    u *= 2.0 * sm.gain;
                    let g = anti(t, u + sm.b) - u * fb;
                    let d = u - s.xp;
                    let y = if d.abs() > 1e-6 { (g - s.gp) / d } else { curve(t, 0.5 * (u + s.xp) + sm.b) - fb };
                    s.xp = u;
                    s.gp = g;
                    s.down.copy_within(0..TAPS - 1, 1);
                    s.down[0] = y;
                }
                let mut y = 0.0;
                for (hj, dj) in h.iter().zip(s.down.iter()) {
                    y += hj * dj;
                }
                let dc_out = y - s.dc[0] + self.dc_r * s.dc[1];
                s.dc[0] = y;
                s.dc[1] = dc_out;
                s.lp += (dc_out - s.lp) * self.tone_a;
                let wet = (gl * s.lp + gh * (dc_out - s.lp)) * sm.out;
                let dry = s.dry[self.di];
                s.dry[self.di] = x;
                *io = (dry * (1.0 - sm.mix) + wet * sm.mix) as f32;
            }
            self.di = (self.di + 1) % LATENCY;
        }
        self.sm = Some(sm);
        for s in self.sides.iter_mut() {
            if !s.gp.is_finite() || !s.lp.is_finite() || !s.dc[1].is_finite() {
                s.up = [0.0; HALF];
                s.down = [0.0; TAPS];
                s.xp = 0.0;
                s.gp = 0.0;
                s.lp = 0.0;
                s.dc = [0.0; 2];
            }
        }
    }
}
