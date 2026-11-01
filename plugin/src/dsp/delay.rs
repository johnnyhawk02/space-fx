//! Delay: a clean stereo echo (dsp/delay.js). Time in notes (Sync) or ms; when Time changes the
//! read point glides there, so the echo bends in pitch like moving a tape head. One repeat: more
//! come from the Routing Feedback.

use super::{clamp, cubic};

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct DelayParams {
    pub sync: bool,
    /// Time in beats when synced.
    pub beats: f64,
    pub time_ms: f64,
    pub mix: f64,
}

impl Default for DelayParams {
    fn default() -> Self {
        Self { sync: true, beats: 0.75, time_ms: 375.0, mix: 0.5 }
    }
}

pub struct Delay {
    rate: f64,
    len: usize,
    buf: [Vec<f32>; 2],
    i: usize,
    base: f64,
}

impl Delay {
    pub fn new(rate: f64) -> Self {
        let len = (rate * 5.0).round() as usize;
        Self { rate, len, buf: [vec![0.0; len], vec![0.0; len]], i: 0, base: f64::NAN }
    }

    pub fn reset(&mut self) {
        self.buf[0].fill(0.0);
        self.buf[1].fill(0.0);
        self.i = 0;
        self.base = f64::NAN;
    }

    /// `beat` is a beat's length in frames.
    pub fn process(&mut self, l: &mut [f32], r: &mut [f32], p: &DelayParams, beat: f64) {
        let target = if p.sync {
            p.beats.max(0.0625) * beat
        } else {
            clamp(p.time_ms, 10.0, 2000.0) * 0.001 * self.rate
        };
        let len = self.len;
        let want = clamp(target, 2.0, len as f64 - 4.0);
        // Glide to a new Time instead of jumping: about a quarter second to settle, and never
        // faster than an octave down or a fifth up.
        if !(self.base >= 0.0) {
            self.base = want;
        }
        let glide = 1.0 - (-1.0 / (0.25 * self.rate)).exp();
        let mix = clamp(p.mix, 0.0, 1.0);
        let n = l.len().min(r.len());
        for f in 0..n {
            self.base += clamp((want - self.base) * glide, -0.5, 0.5);
            let pos = (self.i + len) as f64 - self.base;
            let k = pos.floor() as usize;
            let fr = pos - k as f64;
            for c in 0..2 {
                let io = if c == 0 { &mut *l } else { &mut *r };
                let b = &mut self.buf[c];
                let echo = cubic(b[(k + len - 1) % len] as f64, b[k % len] as f64, b[(k + 1) % len] as f64, b[(k + 2) % len] as f64, fr);
                let x = io[f];
                b[self.i] = x;
                io[f] = (x as f64 * (1.0 - mix) + echo * mix) as f32;
            }
            self.i = (self.i + 1) % len;
        }
    }
}
