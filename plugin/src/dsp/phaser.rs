//! Phaser: the MXR Phase 90 after Giampiccolo et al. (DAFx24), via Clip's phaser.rs and
//! dsp/phaser.js. Four JFET-controlled first-order all-passes, a 65% rising triangle LFO, and the
//! pedal's input and output high-passes, plus Center, Depth, Feedback and Spread.

use super::clamp;
use std::f64::consts::PI;

const VP: f64 = -2.021;
const IS0: f64 = 5.367e-3;
const LAMBDA: f64 = 4e-3;
const R5: f64 = 24e3;
const C2: f64 = 47e-9;
const LFO_CENTRE: f64 = 3.25 - 5.1;
const LFO_DEPTH: f64 = 0.15;
const LFO_DUTY: f64 = 0.65;
const STAGES: usize = 4;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct PhaserParams {
    pub sync: bool,
    /// Hz
    pub speed: f64,
    /// One sweep every so many beats, when synced.
    pub rate_beats: f64,
    pub depth: f64,
    pub center: f64,
    pub feedback: f64,
    /// degrees
    pub spread: f64,
    pub mix: f64,
}

impl Default for PhaserParams {
    fn default() -> Self {
        Self { sync: false, speed: 0.5, rate_beats: 8.0, depth: 0.6, center: 1663.0, feedback: 0.0, spread: 0.0, mix: 0.5 }
    }
}

fn r_jfet(vgs: f64, v2: f64) -> f64 {
    let v2 = v2.abs();
    let over = vgs - VP;
    if over < 0.0 {
        return f64::INFINITY;
    }
    if over >= v2 {
        return VP * VP / (2.0 * IS0 * (over - v2 / 2.0)).max(1e-12);
    }
    v2 / (IS0 * (1.0 - vgs / VP).powi(2) * (1.0 + LAMBDA * v2)).max(1e-12)
}

/// Center (Hz) to the JFETs' gate voltage.
fn vgs_for(hz: f64) -> f64 {
    LFO_CENTRE + (hz - 1663.0) / 8900.0
}

#[derive(Default, Clone, Copy)]
struct Side {
    ap: [f64; STAGES],
    v2: [f64; STAGES],
    hp_in: [f64; 2],
    hp_out: [f64; 2],
    fb: f64,
}

pub struct Phaser {
    rate: f64,
    lfo: f64,
    sides: [Side; 2],
}

impl Phaser {
    pub fn new(rate: f64) -> Self {
        Self { rate, lfo: 0.0, sides: [Side::default(); 2] }
    }

    pub fn reset(&mut self) {
        *self = Self::new(self.rate);
    }

    /// The sweep's phase (0..1), for the picture.
    pub fn phase(&self) -> f64 {
        self.lfo
    }

    /// `beat` is a beat's length in frames, for Sync.
    pub fn process(&mut self, l: &mut [f32], r: &mut [f32], p: &PhaserParams, beat: f64) {
        let ts = 1.0 / self.rate;
        let hp = |fc: f64| (-2.0 * PI * fc * ts).exp();
        let a_in = hp(1.0 / (2.0 * PI * (10e3 + 470e3) * 0.01e-6));
        let a_out = hp(22.0);
        let hz = if p.sync { self.rate / beat / p.rate_beats.max(0.0625) } else { p.speed };
        let step = clamp(hz, 0.01, 12.0) * ts;
        let mix = clamp(p.mix, 0.0, 1.0);
        let centre = vgs_for(clamp(p.center, 200.0, 4500.0));
        let swing = LFO_DEPTH / 0.6 * clamp(p.depth, 0.0, 1.0);
        let offset = clamp(p.spread, 0.0, 180.0) / 360.0;
        let fb = clamp(p.feedback, 0.0, 0.9);
        let tri = |ph: f64| if ph < LFO_DUTY { ph / LFO_DUTY } else { 1.0 - (ph - LFO_DUTY) / (1.0 - LFO_DUTY) };
        let n = l.len().min(r.len());
        for f in 0..n {
            self.lfo = (self.lfo + step) % 1.0;
            for c in 0..2 {
                let io = if c == 0 { &mut *l } else { &mut *r };
                let vgs = centre + swing * (2.0 * tri((self.lfo + c as f64 * offset) % 1.0) - 1.0);
                let side = &mut self.sides[c];
                let x = io[f] as f64;
                let v1 = a_in * (side.hp_in[1] + x - side.hp_in[0]);
                side.hp_in = [x, v1];
                let mut y = v1 + fb * side.fb;
                for k in 0..STAGES {
                    let rj = r_jfet(vgs, side.v2[k]);
                    let rr = if rj.is_finite() { R5 * rj / (R5 + rj) } else { R5 };
                    let wb = 1.0 / (rr * C2);
                    let t = (wb * ts / 2.0).tan();
                    let c1 = -(1.0 - t) / (1.0 + t);
                    let out = c1 * y + side.ap[k];
                    side.ap[k] = y - c1 * out;
                    side.v2[k] = 0.5 * (y - out);
                    y = out;
                }
                side.fb = y.tanh();
                let sum = 0.5 * (v1 + y);
                let o = a_out * (side.hp_out[1] + sum - side.hp_out[0]);
                side.hp_out = [sum, o];
                io[f] = (x * (1.0 - mix) + o * mix) as f32;
            }
        }
    }
}
