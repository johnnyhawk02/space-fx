//! Sequencer: up to 16 steps, stepping with the host's tempo (Sync) or free, gliding between
//! steps over Slew of each step's length. See drive/dsp/sequencer.js.

use super::clamp;

pub const STEPS: usize = 16;
pub const STEP_DEFAULTS: [f64; STEPS] = [1.0, 0.3, 0.65, 0.1, 0.85, 0.2, 0.5, 0.0, 0.9, 0.4, 0.7, 0.15, 0.55, 0.25, 0.8, 0.05];
/// Sync Rates: beats per step.
pub const RATES: [(&str, f64); 8] =
    [("1/32", 0.125), ("1/16T", 1.0 / 6.0), ("1/16", 0.25), ("1/8T", 1.0 / 3.0), ("1/8", 0.5), ("1/4", 1.0), ("1/2", 2.0), ("1 Bar", 4.0)];

const CURVE: f64 = 4.0;

/// Glide shape over 0..1 of the slew.
pub fn glide(u: f64) -> f64 {
    (1.0 - (-CURVE * u).exp()) / (1.0 - (-CURVE).exp())
}

/// The step number (not wrapped) and how far through it, with Swing.
pub fn locate(pos: f64, swing: f64) -> (i64, f64) {
    let pair = (pos / 2.0).floor();
    let w = pos - 2.0 * pair;
    let split = 1.0 + clamp(swing, 0.0, 1.0) / 3.0;
    if w < split {
        (2 * pair as i64, w / split)
    } else {
        (2 * pair as i64 + 1, (w - split) / (2.0 - split))
    }
}

#[derive(Clone, Copy, Debug)]
pub struct SeqParams {
    pub sync: bool,
    /// Beats per step when synced.
    pub rate: f64,
    /// Steps per second when free.
    pub hz: f64,
    pub steps: usize,
    pub slew: f64,
    pub swing: f64,
    pub values: [f64; STEPS],
}

impl Default for SeqParams {
    fn default() -> Self {
        Self { sync: true, rate: 0.25, hz: 8.0, steps: 16, slew: 0.3, swing: 0.0, values: STEP_DEFAULTS }
    }
}

pub struct Sequencer {
    rate: f64,
    pub pos: f64,
    pub step: i64,
    from: f64,
    pub out: f64,
}

impl Sequencer {
    pub fn new(rate: f64) -> Self {
        Self { rate, pos: 0.0, step: -1, from: 0.0, out: 0.0 }
    }

    pub fn reset(&mut self) {
        self.pos = 0.0;
        self.step = -1;
        self.from = 0.0;
        self.out = 0.0;
    }

    fn step_frames(&self, p: &SeqParams, beat: f64) -> f64 {
        if p.sync {
            p.rate.max(1.0 / 32.0) * beat
        } else {
            self.rate / clamp(p.hz, 0.05, 50.0)
        }
    }

    /// Fill `out` with values 0..1. `beat`: a beat's length in frames; `song_beats`: the host's
    /// position at the first frame, when it's playing.
    pub fn render(&mut self, out: &mut [f64], p: &SeqParams, beat: f64, song_beats: Option<f64>) {
        let frames = self.step_frames(p, beat);
        if let (Some(b), true) = (song_beats, p.sync) {
            self.pos = b / p.rate.max(1.0 / 32.0);
        }
        let count = p.steps.clamp(1, STEPS) as i64;
        let slew = clamp(p.slew, 0.0, 1.0);
        for o in out.iter_mut() {
            let (step, u) = locate(self.pos, p.swing);
            if step != self.step {
                self.step = step;
                self.from = self.out;
            }
            let to = clamp(p.values[step.rem_euclid(count) as usize], 0.0, 1.0);
            self.out = if slew > 0.0 && u < slew { self.from + (to - self.from) * glide(u / slew) } else { to };
            *o = self.out;
            self.pos += 1.0 / frames;
        }
        let wrap = (1u32 << 20) as f64;
        if self.pos >= wrap {
            self.pos -= wrap;
            self.step -= 1 << 20;
        }
    }

    /// The current step, wrapped.
    pub fn current(&self, p: &SeqParams) -> usize {
        self.step.rem_euclid(p.steps.clamp(1, STEPS) as i64) as usize
    }
}
