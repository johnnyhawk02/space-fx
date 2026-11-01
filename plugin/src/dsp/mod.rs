//! The DSP, ported from the browser prototype in `dsp/*.js`. Plain Rust with no plugin types, so
//! it can be tested on its own. Every module processes L and R in place, in blocks.

pub mod delay;
pub mod filter;
pub mod lfo;
pub mod phaser;
pub mod rack;
pub mod spring;
pub mod tape;

/// Clip's linear congruential generator (wrapping u32).
#[inline]
pub fn lcg(seed: u32) -> u32 {
    seed.wrapping_mul(1664525).wrapping_add(1013904223)
}

/// The generator's state as a value in -1..1.
#[inline]
pub fn lcg_value(seed: u32) -> f64 {
    (seed >> 8) as f64 / 16777216.0 * 2.0 - 1.0
}

/// A seeded [`lcg`], giving -1..1.
#[derive(Clone, Copy)]
pub struct Rng(pub u32);

impl Rng {
    #[inline]
    pub fn next(&mut self) -> f64 {
        self.0 = lcg(self.0);
        lcg_value(self.0)
    }
}

#[inline]
pub(crate) fn clamp(v: f64, lo: f64, hi: f64) -> f64 {
    v.max(lo).min(hi)
}

/// Catmull-Rom style cubic read between y1 and y2, as the JS does.
#[inline]
pub(crate) fn cubic(y0: f64, y1: f64, y2: f64, y3: f64, fr: f64) -> f64 {
    y1 + 0.5 * fr * (y2 - y0 + fr * (2.0 * y0 - 5.0 * y1 + 4.0 * y2 - y3 + fr * (3.0 * (y1 - y2) + y3 - y0)))
}
