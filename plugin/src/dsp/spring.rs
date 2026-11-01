//! Spring: a stereo spring tank after Valimaki, Parker and Abel, via Clip's fx.rs and
//! dsp/spring.js. Two springs of slightly different length, each a feedback loop through a
//! stretched all-pass chain (the low chirps) and one through plain all-passes (the wide-band
//! chirps). True stereo: each spring is driven mostly by its own side. Buffers are sized for the
//! lowest Tone up front, so changing Tone never allocates.

use super::clamp;
use std::f64::consts::PI;

const M_LOW: usize = 100;
const M_HIGH: usize = 200;
/// How much of its own side each spring hears; the rest is the other side.
const OWN: f64 = 0.8;
/// The lowest Tone the buffers are sized for.
pub const MIN_TONE: f64 = 1500.0;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct SpringParams {
    /// ms
    pub length: f64,
    pub decay: f64,
    /// Hz
    pub tone: f64,
    pub chirp: f64,
    pub mix: f64,
}

impl Default for SpringParams {
    fn default() -> Self {
        Self { length: 56.0, decay: 0.7, tone: 4300.0, chirp: 0.6, mix: 0.5 }
    }
}

/// m cascaded first-order all-passes, each unit delay stretched to k samples.
struct Chain {
    k: usize,
    m: usize,
    x: Vec<f32>,
    y: Vec<f32>,
    i: usize,
}

impl Chain {
    fn new(m: usize, k_max: usize) -> Self {
        Self { k: 1, m, x: vec![0.0; m * k_max], y: vec![0.0; m * k_max], i: 0 }
    }

    fn clear(&mut self, k: usize) {
        self.k = k.clamp(1, self.x.len() / self.m);
        self.x.fill(0.0);
        self.y.fill(0.0);
        self.i = 0;
    }

    #[inline]
    fn process(&mut self, mut v: f64, a: f64) -> f64 {
        let k = self.k;
        for s in 0..self.m {
            let j = s * k + self.i;
            let out = (a * v + self.x[j] as f64 - a * self.y[j] as f64) as f32;
            self.x[j] = v as f32;
            self.y[j] = out;
            v = out as f64;
        }
        self.i = (self.i + 1) % k;
        v
    }
}

#[derive(Default, Clone, Copy)]
struct Biquad {
    b0: f64,
    b1: f64,
    b2: f64,
    a1: f64,
    a2: f64,
    x1: f64,
    x2: f64,
    y1: f64,
    y2: f64,
}

impl Biquad {
    fn lowpass(f: f64, q: f64, rate: f64) -> Self {
        let w = 2.0 * PI * f.min(0.45 * rate) / rate;
        let cw = w.cos();
        let alpha = w.sin() / (2.0 * q);
        let a0 = 1.0 + alpha;
        let b1 = (1.0 - cw) / a0;
        Self { b0: b1 / 2.0, b1, b2: b1 / 2.0, a1: -2.0 * cw / a0, a2: (1.0 - alpha) / a0, ..Default::default() }
    }

    #[inline]
    fn process(&mut self, x: f64) -> f64 {
        let y = self.b0 * x + self.b1 * self.x1 + self.b2 * self.x2 - self.a1 * self.y1 - self.a2 * self.y2;
        self.x2 = self.x1;
        self.x1 = x;
        self.y2 = self.y1;
        self.y1 = y;
        y
    }
}

/// Rust's `round` already rounds halves away from zero, like Clip.
fn stretch(rate: f64, tone: f64) -> usize {
    ((rate / (2.0 * tone.max(500.0))).round() as usize).max(1)
}

struct OneSpring {
    low: Chain,
    high: Chain,
    lp: [Biquad; 2],
    fb_low: Vec<f32>,
    fb_high: Vec<f32>,
    i: usize,
}

impl OneSpring {
    fn new(rate: f64) -> Self {
        let n = (rate * 0.25) as usize;
        Self {
            low: Chain::new(M_LOW, stretch(rate, MIN_TONE)),
            high: Chain::new(M_HIGH, 1),
            lp: [Biquad::default(); 2],
            fb_low: vec![0.0; n],
            fb_high: vec![0.0; n],
            i: 0,
        }
    }

    /// Start afresh for `tone`.
    fn rebuild(&mut self, rate: f64, tone: f64) {
        self.low.clear(stretch(rate, tone));
        self.high.clear(1);
        self.lp = [Biquad::lowpass(tone * 0.95, 0.541, rate), Biquad::lowpass(tone * 0.95, 1.307, rate)];
        self.fb_low.fill(0.0);
        self.fb_high.fill(0.0);
        self.i = 0;
    }
}

pub struct Spring {
    rate: f64,
    tone: f64,
    springs: [OneSpring; 2],
    pending_tone: f64,
    pending_for: usize,
}

impl Spring {
    pub fn new(rate: f64) -> Self {
        let mut s = Self {
            rate,
            tone: SpringParams::default().tone,
            springs: [OneSpring::new(rate), OneSpring::new(rate)],
            pending_tone: 0.0,
            pending_for: 0,
        };
        s.reset();
        s
    }

    pub fn reset(&mut self) {
        for sp in self.springs.iter_mut() {
            sp.rebuild(self.rate, self.tone);
        }
        self.pending_tone = self.tone;
        self.pending_for = 0;
    }

    pub fn process(&mut self, l: &mut [f32], r: &mut [f32], p: &SpringParams) {
        let n = l.len().min(r.len());
        let tone = p.tone.max(MIN_TONE);
        if (tone - self.tone).abs() > 1.0 {
            // A new Tone needs new chain stretches and starts the tank afresh, as in Clip, but
            // only once Tone has been still for 100 ms.
            if tone != self.pending_tone {
                self.pending_tone = tone;
                self.pending_for = 0;
            }
            self.pending_for += n;
            if self.pending_for as f64 >= 0.1 * self.rate {
                self.tone = tone;
                for sp in self.springs.iter_mut() {
                    sp.rebuild(self.rate, tone);
                }
            }
        }
        let g = 0.5 + 0.47 * clamp(p.decay, 0.0, 1.0);
        let a_low = 0.3 + 0.55 * clamp(p.chirp, 0.0, 1.0);
        let a_high = -a_low;
        let mix = clamp(p.mix, 0.0, 1.0);
        let len = clamp(p.length, 10.0, 200.0) * 0.001 * self.rate;
        let size = self.springs[0].fb_low.len();
        let delays = [(len as usize).clamp(1, size - 1), ((len * 1.13) as usize).clamp(1, size - 1)];
        let mut wet = [0.0f64; 2];
        for f in 0..n {
            let ins = [l[f] as f64, r[f] as f64];
            for (c, w) in wet.iter_mut().enumerate() {
                let x = OWN * ins[c] + (1.0 - OWN) * ins[1 - c];
                let sp = &mut self.springs[c];
                let back = (sp.i + size - delays[c]) % size;
                let lo = sp.low.process(x - g * sp.fb_low[back] as f64, a_low);
                let hi = sp.high.process(x - g * 0.9 * sp.fb_high[back] as f64, a_high);
                sp.fb_low[sp.i] = lo as f32;
                sp.fb_high[sp.i] = hi as f32;
                sp.i = (sp.i + 1) % size;
                let lo0 = sp.lp[0].process(lo);
                let lo_out = sp.lp[1].process(lo0);
                *w = 1.2 * lo_out + 0.06 * hi;
            }
            l[f] = (l[f] as f64 * (1.0 - mix) + wet[0] * mix) as f32;
            r[f] = (r[f] as f64 * (1.0 - mix) + wet[1] * mix) as f32;
        }
    }
}
