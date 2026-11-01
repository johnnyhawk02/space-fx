//! Filter: Zavalishin's zero-delay-feedback state-variable filter, LP / BP / HP, its Cutoff moved
//! by the Sequencer (Seq) and the input's level (Env). See drive/dsp/autofilter.js.

use super::clamp;
use std::f64::consts::PI;

pub const MODES: [&str; 3] = ["LP", "BP", "HP"];

pub fn damping(res: f64) -> f64 {
    2.0 - 1.88 * clamp(res, 0.0, 1.0)
}

#[derive(Clone, Copy, Debug)]
pub struct FilterParams {
    pub mode: usize,
    pub cutoff: f64,
    pub res: f64,
    pub env: f64,
    pub seq: f64,
    pub pre: bool,
}

impl Default for FilterParams {
    fn default() -> Self {
        Self { mode: 0, cutoff: 600.0, res: 0.5, env: 0.0, seq: 0.5, pre: false }
    }
}

/// The Cutoff after modulation, in Hz.
pub fn mod_cutoff(p: &FilterParams, seq: f64, env: f64, rate: f64) -> f64 {
    let oct = 4.0 * (clamp(p.seq, -1.0, 1.0) * seq + clamp(p.env, -1.0, 1.0) * env);
    clamp(clamp(p.cutoff, 40.0, 16000.0) * 2f64.powf(oct), 20.0, rate * 0.45)
}

pub struct AutoFilter {
    rate: f64,
    env: f64,
    log_fc: f64,
    pub fc: f64,
    ic: [[f64; 2]; 2],
    atk: f64,
    rel: f64,
    glide: f64,
}

impl AutoFilter {
    pub fn new(rate: f64) -> Self {
        Self {
            rate,
            env: 0.0,
            log_fc: 600f64.ln(),
            fc: 600.0,
            ic: [[0.0; 2]; 2],
            atk: 1.0 - (-1.0 / (0.003 * rate)).exp(),
            rel: 1.0 - (-1.0 / (0.12 * rate)).exp(),
            glide: 1.0 - (-1.0 / (0.0007 * rate)).exp(),
        }
    }

    /// `seq`: the Sequencer's value for each frame, or None.
    pub fn process(&mut self, l: &mut [f32], r: &mut [f32], p: &FilterParams, seq: Option<&[f64]>) {
        let mode = p.mode.min(2);
        let k = damping(p.res);
        let lp_gain = (k / 2.0).sqrt();
        for i in 0..l.len().min(r.len()) {
            let a = (l[i].abs() as f64).max(r[i].abs() as f64);
            self.env += (a - self.env) * if a > self.env { self.atk } else { self.rel };
            let s = seq.map(|q| q[i]).unwrap_or(0.0);
            let want = mod_cutoff(p, s, (self.env * 2.0).min(1.0), self.rate).ln();
            self.log_fc += (want - self.log_fc) * self.glide;
            self.fc = self.log_fc.exp();
            let g = (PI * self.fc / self.rate).tan();
            let a1 = 1.0 / (1.0 + g * (g + k));
            let a2 = g * a1;
            let a3 = g * a2;
            for c in 0..2 {
                let io = if c == 0 { &mut l[i] } else { &mut r[i] };
                let st = &mut self.ic[c];
                let x = *io as f64;
                let v3 = x - st[1];
                let v1 = a1 * st[0] + a2 * v3;
                let v2 = st[1] + a2 * st[0] + a3 * v3;
                st[0] = 2.0 * v1 - st[0];
                st[1] = 2.0 * v2 - st[1];
                *io = match mode {
                    0 => v2 * lp_gain,
                    1 => k * v1,
                    _ => (x - k * v1 - v2) * lp_gain,
                } as f32;
            }
        }
        for st in self.ic.iter_mut() {
            if !st[0].is_finite() || !st[1].is_finite() {
                *st = [0.0; 2];
            }
        }
    }
}
