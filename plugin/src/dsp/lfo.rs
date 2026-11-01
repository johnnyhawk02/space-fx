//! Wow and flutter, and the delay-time LFO, after Clip's tape.rs (dsp/lfo.js).

use std::f64::consts::{PI, TAU};

pub const LFO_SHAPES: [&str; 8] = ["Sine", "Triangle", "Square", "Saw", "Random", "Smooth Random", "Drunk", "Saw Down"];

#[derive(Default, Clone)]
pub struct Wobble {
    wow_ph: f32,
    flut_ph: f32,
    drift: f64,
    drift_to: f64,
}

impl Wobble {
    /// One sample: the delay-time swing in seconds at full wow. The phases are 32-bit floats,
    /// as in Clip.
    pub fn next(&mut self, new_drift: bool, rand: &mut impl FnMut() -> f64, speed_k: f32, sr: f64) -> f64 {
        let srf = sr as f32;
        self.wow_ph = (self.wow_ph + 0.55f32 * speed_k / srf) % 1.0;
        self.flut_ph = (self.flut_ph + 7.3f32 * speed_k / srf) % 1.0;
        if new_drift {
            self.drift_to = rand();
        }
        self.drift += (self.drift_to - self.drift) * 2.0 / sr;
        0.0016 * (TAU * self.wow_ph as f64).sin() + 0.00012 * (TAU * self.flut_ph as f64).sin() + 0.0008 * self.drift
    }
}

#[derive(Default, Clone)]
pub struct Lfo {
    phase: f64,
    cycle: f64,
    held: f64,
    from: f64,
    walk: f64,
    out: f64,
}

impl Lfo {
    /// Advance one sample at `rate` Hz; the shape's value -1..1 after a slew of `slew` (0..1).
    pub fn next(&mut self, shape: usize, rate: f64, slew: f64, sr: f64, rand: &mut impl FnMut() -> f64) -> f64 {
        self.phase += rate / sr;
        let cycle = self.phase.floor();
        if cycle != self.cycle {
            self.cycle = cycle;
            self.from = self.held;
            self.held = rand();
            let step = rand() * 0.4;
            self.walk = if (self.walk + step).abs() > 1.0 { self.walk - step } else { self.walk + step };
        }
        let p = self.phase - cycle;
        let v = match shape {
            1 => 1.0 - 4.0 * (p - 0.5).abs(),
            2 => {
                if p < 0.5 {
                    1.0
                } else {
                    -1.0
                }
            }
            3 => 2.0 * p - 1.0,
            4 => self.held,
            5 => self.from + (self.held - self.from) * (0.5 - 0.5 * (PI * p).cos()),
            6 => self.walk,
            7 => 1.0 - 2.0 * p,
            _ => (TAU * p).sin(),
        };
        let s = slew.clamp(0.0, 1.0);
        let mut secs = (2.0 * s * s).max(0.002);
        if shape == 6 {
            secs = secs.max(0.5 / rate.max(1e-3) * 0.2);
        }
        self.out += (v - self.out) * (1.0 - (-1.0 / (secs * sr)).exp());
        self.out
    }
}
