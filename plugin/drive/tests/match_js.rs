//! The Rust DSP against the browser page's JS (tools/render-drive.mjs): every Type, every filter
//! Mode, the Sequencer free and following a song position should sound the same.
//! Needs `node`; skipped without.

use space_drive::dsp::engine::{Engine, Settings};
use std::process::Command;

const SR: f64 = 44100.0;

struct Render {
    in_l: Vec<f32>,
    in_r: Vec<f32>,
    l: Vec<f32>,
    r: Vec<f32>,
}

fn js(case: &str) -> Option<Render> {
    let script = concat!(env!("CARGO_MANIFEST_DIR"), "/../../tools/render-drive.mjs");
    let out = match Command::new("node").arg(script).arg(case).output() {
        Ok(o) if o.status.success() => o.stdout,
        Ok(o) => panic!("render-drive {case} failed: {}", String::from_utf8_lossy(&o.stderr)),
        Err(_) => {
            eprintln!("node not found: skipping the JS comparison");
            return None;
        }
    };
    let v: serde_json::Value = serde_json::from_slice(&out).unwrap();
    let get = |k: &str| v[k].as_array().unwrap().iter().map(|x| x.as_f64().unwrap() as f32).collect::<Vec<_>>();
    Some(Render { in_l: get("inL"), in_r: get("inR"), l: get("L"), r: get("R") })
}

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

fn check(case: &str, change: impl FnOnce(&mut Settings)) {
    let Some(want) = js(case) else { return };
    let mut s = Settings::default();
    change(&mut s);
    let (mut l, mut r) = (want.in_l.clone(), want.in_r.clone());
    let mut fx = Engine::new(SR);
    let beat = SR / 2.0;
    for (o, (a, b)) in l.chunks_mut(100).zip(r.chunks_mut(100)).enumerate() {
        let song = if case == "seq-song" { Some(3.5 + (o * 100) as f64 / beat) } else { None };
        fx.process(a, b, &s, song);
    }
    let (dl, dr) = (match_db(&l, &want.l), match_db(&r, &want.r));
    println!("{case}: L {dl:.1} dB, R {dr:.1} dB");
    assert!(dl > 100.0 && dr > 100.0, "{case}: only {dl:.1} / {dr:.1} dB from the JS");
}

#[test]
fn defaults_match() {
    check("default", |_| {});
}

#[test]
fn every_type_matches() {
    check("soft", |s| {
        s.drive.amount = 0.9;
        s.drive.bias = 0.5;
        s.drive.tone = 0.8;
    });
    check("diode", |s| {
        s.drive.kind = 1;
        s.drive.amount = 0.7;
        s.drive.mix = 0.6;
        s.drive.output = -3.0;
    });
    check("fuzz", |s| {
        s.drive.kind = 2;
        s.drive.amount = 1.0;
        s.drive.bias = 0.3;
        s.drive.tone = 0.2;
    });
    check("fold", |s| {
        s.drive.kind = 3;
        s.drive.amount = 0.8;
    });
}

#[test]
fn filter_modes_match() {
    check("filter-bp", |s| {
        s.filter.mode = 1;
        s.filter.res = 0.9;
        s.filter.env = 0.6;
        s.filter.pre = true;
    });
    check("filter-hp", |s| {
        s.filter.mode = 2;
        s.filter.cutoff = 2000.0;
        s.filter.seq = -0.8;
    });
}

#[test]
fn sequencer_matches() {
    check("seq-free", |s| {
        s.seq.sync = false;
        s.seq.hz = 13.0;
        s.seq.steps = 5;
        s.seq.slew = 0.8;
        s.seq.swing = 0.6;
    });
    check("seq-song", |s| {
        s.seq.rate = 1.0 / 6.0;
        s.seq.slew = 0.0;
        s.seq.swing = 0.3;
    });
    check("off", |s| {
        s.drive_on = false;
        s.seq_on = false;
    });
}
