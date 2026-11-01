//! The Rust DSP against the browser prototype's JS (tools/render-js.mjs): each module, and the
//! whole rack in every Mode with Feedback, should sound the same. Needs `node`; skipped without.

use space_fx::dsp::delay::{Delay, DelayParams};
use space_fx::dsp::filter::{Filter, FilterParams};
use space_fx::dsp::phaser::{Phaser, PhaserParams};
use space_fx::dsp::rack::{Rack, Settings};
use space_fx::dsp::spring::{Spring, SpringParams};
use space_fx::dsp::tape::{Tape, TapeParams};
use std::process::Command;

const SR: f64 = 44100.0;

struct Render {
    in_l: Vec<f32>,
    in_r: Vec<f32>,
    l: Vec<f32>,
    r: Vec<f32>,
}

fn js(case: &str) -> Option<Render> {
    let script = concat!(env!("CARGO_MANIFEST_DIR"), "/../tools/render-js.mjs");
    let out = match Command::new("node").arg(script).arg(case).output() {
        Ok(o) if o.status.success() => o.stdout,
        Ok(o) => panic!("render-js {case} failed: {}", String::from_utf8_lossy(&o.stderr)),
        Err(_) => {
            eprintln!("node not found: skipping the JS comparison");
            return None;
        }
    };
    let v: serde_json::Value = serde_json::from_slice(&out).unwrap();
    let get = |k: &str| v[k].as_array().unwrap().iter().map(|x| x.as_f64().unwrap() as f32).collect::<Vec<_>>();
    Some(Render { in_l: get("inL"), in_r: get("inR"), l: get("L"), r: get("R") })
}

/// How far below the JS's level the difference sits, in dB (bigger is closer).
fn match_db(ours: &[f32], theirs: &[f32]) -> f64 {
    assert_eq!(ours.len(), theirs.len());
    let (mut e, mut s) = (0.0f64, 0.0f64);
    for (a, b) in ours.iter().zip(theirs) {
        assert!(a.is_finite());
        e += ((a - b) as f64).powi(2);
        s += (*b as f64).powi(2);
    }
    if e == 0.0 {
        return f64::INFINITY;
    }
    10.0 * (s / e).log10()
}

fn check(case: &str, min_db: f64, run: impl FnOnce(&mut [f32], &mut [f32])) {
    let Some(want) = js(case) else { return };
    let (mut l, mut r) = (want.in_l.clone(), want.in_r.clone());
    run(&mut l, &mut r);
    let (dl, dr) = (match_db(&l, &want.l), match_db(&r, &want.r));
    println!("{case}: L {dl:.1} dB, R {dr:.1} dB");
    assert!(dl > min_db && dr > min_db, "{case}: only {dl:.1} / {dr:.1} dB from the JS");
}

fn blocks(l: &mut [f32], r: &mut [f32], mut f: impl FnMut(&mut [f32], &mut [f32])) {
    for (a, b) in l.chunks_mut(64).zip(r.chunks_mut(64)) {
        f(a, b);
    }
}

const BEAT: f64 = SR / 2.0;

#[test]
fn tape_matches() {
    let p = TapeParams { mix: 1.0, drive: 0.8, lfo_depth: 3.0, lfo_rate: 2.0, lfo_shape: 1, ..Default::default() };
    let mut fx = Tape::new(SR);
    check("tape", 100.0, |l, r| blocks(l, r, |a, b| fx.process(a, b, &p)));
}

#[test]
fn filter_matches() {
    let p = FilterParams { mix: 1.0, resonance: 0.85, drive: 0.6, env: 0.5, ..Default::default() };
    let mut fx = Filter::new(SR);
    check("filter", 80.0, |l, r| blocks(l, r, |a, b| fx.process(a, b, &p)));
    let p = FilterParams { mix: 1.0, mode: 1, cutoff: 800.0, ..Default::default() };
    let mut fx = Filter::new(SR);
    check("filter-bp", 80.0, |l, r| blocks(l, r, |a, b| fx.process(a, b, &p)));
}

#[test]
fn delay_matches() {
    let p = DelayParams { mix: 1.0, ..Default::default() };
    let mut fx = Delay::new(SR);
    check("delay", 100.0, |l, r| blocks(l, r, |a, b| fx.process(a, b, &p, BEAT)));
    let p = DelayParams { mix: 0.7, sync: false, time_ms: 120.0, ..Default::default() };
    let mut fx = Delay::new(SR);
    check("delay-ms", 100.0, |l, r| blocks(l, r, |a, b| fx.process(a, b, &p, BEAT)));
}

#[test]
fn phaser_matches() {
    let p = PhaserParams { mix: 1.0, spread: 90.0, feedback: 0.6, speed: 2.0, ..Default::default() };
    let mut fx = Phaser::new(SR);
    check("phaser", 80.0, |l, r| blocks(l, r, |a, b| fx.process(a, b, &p, BEAT)));
    let p = PhaserParams { mix: 1.0, sync: true, rate_beats: 1.0, ..Default::default() };
    let mut fx = Phaser::new(SR);
    check("phaser-sync", 80.0, |l, r| blocks(l, r, |a, b| fx.process(a, b, &p, BEAT)));
}

#[test]
fn spring_matches() {
    let p = SpringParams { mix: 1.0, ..Default::default() };
    let mut fx = Spring::new(SR);
    check("spring", 100.0, |l, r| blocks(l, r, |a, b| fx.process(a, b, &p)));
}

#[test]
fn rack_matches_in_every_mode() {
    for mode in 0..4 {
        let s = Settings { mode, feedback: 0.6, ..Default::default() };
        let mut rack = Rack::new(SR);
        check(&format!("rack-{mode}"), 100.0, |l, r| rack.process_blocks(l, r, &s));
    }
}
