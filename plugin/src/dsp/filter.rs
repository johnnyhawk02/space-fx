//! Filter: the Polivoks VCF (dsp/filter.js). A 12 dB/oct state-variable filter, low-pass or
//! band-pass, built from two slew-limited op-amp integrators (dy = f * tanh(u)) in a Chamberlin
//! loop, with the damping fed back through a soft rail clip and allowed to go slightly negative
//! so it self-oscillates. An asymmetric input stage, 4x oversampling, and Env opens the Cutoff
//! with the input's level.

use super::clamp;
use std::f64::consts::{LN_2, PI};

const OS: usize = 4;
const ASYM: f64 = 0.25;
const RAIL: f64 = 1.5;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct FilterParams {
    /// 0 = LP, 1 = BP
    pub mode: usize,
    pub cutoff: f64,
    pub resonance: f64,
    pub drive: f64,
    pub env: f64,
    pub mix: f64,
}

impl Default for FilterParams {
    fn default() -> Self {
        Self { mode: 0, cutoff: 1500.0, resonance: 0.5, drive: 0.3, env: 0.0, mix: 0.5 }
    }
}

/// Resonance (0..1) to the SVF's damping: through zero (self-oscillation) at about 90%.
pub fn damping(res: f64) -> f64 {
    1.6 - 1.75 * clamp(res, 0.0, 1.0).powf(0.8)
}

#[inline]
fn asym(x: f64) -> f64 {
    (x + ASYM).tanh() - ASYM.tanh()
}

#[derive(Default, Clone, Copy)]
struct Side {
    bp: f64,
    lp: f64,
    x: f64,
    dc_x: f64,
    dc_y: f64,
}

pub struct Filter {
    rate: f64,
    env: f64,
    log_fc: f64,
    sides: [Side; 2],
}

impl Filter {
    pub fn new(rate: f64) -> Self {
        Self { rate, env: 0.0, log_fc: 1500f64.ln(), sides: [Side::default(); 2] }
    }

    pub fn reset(&mut self) {
        *self = Self::new(self.rate);
    }

    pub fn process(&mut self, l: &mut [f32], r: &mut [f32], p: &FilterParams) {
        let os_rate = self.rate * OS as f64;
        let bandpass = p.mode == 1;
        let k = damping(p.resonance);
        let drive = clamp(p.drive, 0.0, 1.0);
        let g_in = 0.6 * 10f64.powf(drive * 30.0 / 20.0);
        let g_out = 1.0 / g_in.min(2.0);
        let env_amt = clamp(p.env, 0.0, 1.0);
        let mix = clamp(p.mix, 0.0, 1.0);
        let atk = 1.0 - (-1.0 / (0.004 * self.rate)).exp();
        let rel = 1.0 - (-1.0 / (0.15 * self.rate)).exp();
        let glide = 1.0 - (-1.0 / (0.005 * self.rate)).exp();
        let dc = (-2.0 * PI * 8.0 / self.rate).exp();
        let base = clamp(p.cutoff, 30.0, 12000.0).ln();
        let top = (16000f64.min(os_rate * 0.14)).ln();
        let n = l.len().min(r.len());
        for i in 0..n {
            let a = (l[i] as f64).abs().max((r[i] as f64).abs());
            self.env += (a - self.env) * if a > self.env { atk } else { rel };
            let want = (base + env_amt * (self.env * 2.0).min(1.0) * 4.0 * LN_2).min(top);
            self.log_fc += (want - self.log_fc) * glide;
            let f = (2.0 * (PI * self.log_fc.exp() / os_rate).sin()).min(0.9);
            for c in 0..2 {
                let io = if c == 0 { &mut *l } else { &mut *r };
                let s = &mut self.sides[c];
                let x = io[i] as f64;
                let xin = g_in * x;
                let mut acc = 0.0;
                for o in 1..=OS {
                    let u = asym(s.x + (xin - s.x) * (o as f64 / OS as f64));
                    let fb = RAIL * (s.bp / RAIL).tanh();
                    let hp = u - s.lp - k * fb;
                    s.bp = clamp(s.bp + f * hp.tanh(), -RAIL, RAIL);
                    s.lp = clamp(s.lp + f * s.bp.tanh(), -RAIL, RAIL);
                    acc += if bandpass { s.bp } else { s.lp };
                }
                s.x = xin;
                let y = acc / OS as f64;
                let out = y - s.dc_x + dc * s.dc_y;
                s.dc_x = y;
                s.dc_y = out;
                io[i] = (x * (1.0 - mix) + out * g_out * mix) as f32;
            }
        }
        for s in self.sides.iter_mut() {
            if !s.bp.is_finite() || !s.lp.is_finite() {
                *s = Side::default();
            }
        }
    }
}
