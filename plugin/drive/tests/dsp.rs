//! Space Drive's own checks: antialiasing works, the Sequencer lands on its steps in time and
//! glides between them, and the latency is what the plugin reports.

use space_drive::dsp::engine::{Engine, Settings, LATENCY};
use space_drive::dsp::sequencer::{SeqParams, Sequencer};
use space_drive::dsp::shaper::{curve, DriveParams, Shaper};
use std::f64::consts::PI;

const SR: f64 = 44100.0;

/// Energy away from the harmonics of bin `k0`, against the harmonics', in dB.
fn alias_db(x: &[f64], k0: usize) -> f64 {
    let n = x.len();
    let (mut harm, mut other) = (0.0, 0.0);
    for k in 1..n / 2 {
        let (mut re, mut im) = (0.0, 0.0);
        for (i, v) in x.iter().enumerate() {
            let a = 2.0 * PI * (k * i) as f64 / n as f64;
            re += v * a.cos();
            im -= v * a.sin();
        }
        let p = re * re + im * im;
        if k % k0 == 0 {
            harm += p;
        } else {
            other += p;
        }
    }
    10.0 * (other / harm).log10()
}

#[test]
fn antialiasing_beats_naive_clipping_by_20_db() {
    let (n, k0, pre) = (4096, 187, 2048);
    let f0 = SR * k0 as f64 / n as f64; // about 2 kHz
    for kind in 0..4 {
        let sine: Vec<f32> = (0..n + pre).map(|i| (0.9 * (2.0 * PI * f0 * i as f64 / SR).sin()) as f32).collect();
        let naive: Vec<f64> = sine[pre..].iter().map(|&v| curve(kind, v as f64 * 100.0)).collect();
        let (mut l, mut r) = (sine.clone(), sine.clone());
        let mut s = Shaper::new(SR);
        s.process(&mut l, &mut r, &DriveParams { kind, amount: 1.0, ..Default::default() });
        let ours: Vec<f64> = l[pre..].iter().map(|&v| v as f64).collect();
        let (a, b) = (alias_db(&naive, k0), alias_db(&ours, k0));
        println!("type {kind}: naive {a:.1} dB, ours {b:.1} dB");
        assert!(b < a - 20.0, "type {kind}: {b:.1} dB against naive {a:.1} dB");
    }
}

#[test]
fn latency_is_reported_exactly() {
    // Drive off: the output is the input, LATENCY frames late.
    let mut fx = Engine::new(SR);
    let s = Settings { drive_on: false, filter_on: false, ..Default::default() };
    let mut l = vec![0f32; 4096];
    l[0] = 1.0;
    let mut r = l.clone();
    fx.process(&mut l, &mut r, &s, None);
    let peak = l.iter().enumerate().max_by(|a, b| a.1.abs().total_cmp(&b.1.abs())).unwrap();
    assert_eq!(peak.0, LATENCY);
}

#[test]
fn steps_land_in_time_and_glide() {
    let beat = SR / 2.0;
    let mut values = [0.0; 16];
    values[1] = 1.0;
    let p = SeqParams { values, slew: 0.5, ..Default::default() };
    let mut sq = Sequencer::new(SR);
    let mut out = vec![0.0; (beat * 0.75) as usize];
    sq.render(&mut out, &p, beat, Some(0.0));
    let step = (beat / 4.0) as usize; // a 16th
    assert_eq!(out[step - 1], 0.0, "step 1 holds 0");
    assert!(out[step + step / 8] > 0.2 && out[step + step / 8] < 0.95, "gliding up: {}", out[step + step / 8]);
    assert!((out[step + step / 2 + 2] - 1.0).abs() < 1e-9, "arrived after half the step");
    assert!(out[2 * step + step / 4] < 0.6, "and back down in step 3");
    // Following the host: beat 1 is step 5.
    let mut sq = Sequencer::new(SR);
    let mut out = vec![0.0; 1];
    sq.render(&mut out, &p, beat, Some(1.0));
    assert_eq!(sq.current(&p), 4);
}

#[test]
fn stays_finite_when_pushed() {
    let mut fx = Engine::new(SR);
    let mut s = Settings::default();
    s.filter.res = 1.0;
    for kind in 0..4 {
        s.drive.kind = kind;
        s.drive.amount = 1.0;
        s.drive.output = 12.0;
        let mut l: Vec<f32> = (0..20000).map(|i| ((i * 7919 % 2000) as f32 / 1000.0 - 1.0) * 4.0).collect();
        let mut r = l.clone();
        fx.process(&mut l, &mut r, &s, None);
        assert!(l.iter().chain(&r).all(|v| v.is_finite() && v.abs() < 50.0));
    }
}
