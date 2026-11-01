//! Behaviour checks on the Rust DSP, after the prototype's test/dsp.test.js, plus what only the
//! plugin needs: any host buffer size gives the same sound, and nothing blows up.

use space_fx::dsp::delay::{Delay, DelayParams};
use space_fx::dsp::phaser::{Phaser, PhaserParams};
use space_fx::dsp::rack::{Rack, Settings, BLOCK, MODES, N_MOD};
use space_fx::dsp::spring::{Spring, SpringParams};
use space_fx::dsp::tape::{Tape, TapeParams};

const SR: f64 = 44100.0;

fn impulse(n: usize) -> (Vec<f32>, Vec<f32>) {
    let mut l = vec![0.0; n];
    l[0] = 1.0;
    (l.clone(), l)
}

fn peak(a: &[f32]) -> f32 {
    a.iter().fold(0.0, |m, v| m.max(v.abs()))
}

fn finite(a: &[f32]) -> bool {
    a.iter().all(|v| v.is_finite())
}

#[test]
fn spring_echoes_and_stays_finite() {
    let (mut l, mut r) = impulse(SR as usize * 2);
    let mut s = Spring::new(SR);
    let p = SpringParams { mix: 1.0, ..Default::default() };
    for (a, b) in l.chunks_mut(128).zip(r.chunks_mut(128)) {
        s.process(a, b, &p);
    }
    assert!(finite(&l) && peak(&l) < 4.0);
    assert!(peak(&l[SR as usize..]) > 1e-4, "still echoing after a second");
}

#[test]
fn delay_gives_one_echo() {
    let (mut l, mut r) = impulse(SR as usize * 2);
    let mut d = Delay::new(SR);
    let p = DelayParams { mix: 1.0, ..Default::default() };
    for (a, b) in l.chunks_mut(128).zip(r.chunks_mut(128)) {
        d.process(a, b, &p, 22050.0);
    }
    assert!(finite(&l) && peak(&l) < 2.0);
    assert!(peak(&l[16000..18000]) > 0.01, "an echo after 3/16 at 120");
    assert!(peak(&l[20000..]) < 1e-6, "and no more");
}

#[test]
fn tape_colours_and_stays_bounded() {
    let n = SR as usize;
    let mut l: Vec<f32> = (0..n).map(|i| 0.5 * (i as f32 * 0.02).sin()).collect();
    let mut r = l.clone();
    Tape::new(SR).process(&mut l, &mut r, &TapeParams { wow: 0.0, mix: 1.0, ..Default::default() });
    assert!(finite(&l) && peak(&l) > 0.05 && peak(&l) < 4.0);
}

#[test]
fn phaser_spread_and_feedback() {
    let n = SR as usize * 2;
    let mk = || (0..n).map(|i| 0.5 * (i as f32 * 0.05).sin() + 0.3 * (i as f32 * 0.31).sin()).collect::<Vec<f32>>();
    let (mut l, mut r) = (mk(), mk());
    let p = PhaserParams { speed: 1.0, mix: 1.0, spread: 180.0, feedback: 0.9, depth: 1.0, center: 4500.0, ..Default::default() };
    Phaser::new(SR).process(&mut l, &mut r, &p, SR / 2.0);
    assert!(finite(&l) && finite(&r) && peak(&l) < 4.0 && peak(&r) < 4.0);
    let diff = l.iter().zip(&r).fold(0.0f32, |m, (a, b)| m.max((a - b).abs()));
    assert!(diff > 0.05, "left and right sweep apart");
}

fn wet_settings(mode: usize, feedback: f64) -> Settings {
    let mut s = Settings { mode, feedback, ..Default::default() };
    s.tape.mix = 1.0;
    s.filter.mix = 1.0;
    s.delay.mix = 1.0;
    s.spring.mix = 1.0;
    s.phaser.mix = 1.0;
    s
}

#[test]
fn every_mode_passes_sound_and_feedback_keeps_it_going() {
    for mode in 0..MODES.len() {
        for fb in [0.0, 1.0] {
            let (mut l, mut r) = impulse(SR as usize * 3);
            let mut rack = Rack::new(SR);
            rack.process(&mut l, &mut r, &wet_settings(mode, fb));
            assert!(finite(&l) && peak(&l) <= 1.0 && peak(&l) > 1e-3, "mode {mode} fb {fb}");
            if fb > 0.0 {
                assert!(peak(&l[SR as usize * 2..]) > 1e-5, "mode {mode} feeds back");
            }
        }
    }
}

#[test]
fn bypassed_rack_is_the_input_one_block_late() {
    let s = Settings { on: [false; N_MOD], ..Default::default() };
    let x: Vec<f32> = (0..1000).map(|i| 0.3 * (i as f32 / 7.0).sin()).collect();
    let (mut l, mut r) = (x.clone(), x.clone());
    let mut rack = Rack::new(SR);
    rack.process(&mut l, &mut r, &s);
    assert_eq!(Rack::latency() as usize, BLOCK);
    for i in BLOCK..1000 {
        assert!((l[i] - x[i - BLOCK]).abs() < 1e-6, "frame {i}");
    }
}

#[test]
fn host_buffer_size_does_not_change_the_sound() {
    let n = 64 * 300;
    let x: Vec<f32> = (0..n).map(|i| 0.4 * ((i as f32) * 0.011).sin() * if i < 3000 { 1.0 } else { 0.2 }).collect();
    let s = wet_settings(0, 0.5);
    let run = |sizes: &[usize]| {
        let (mut l, mut r) = (x.clone(), x.clone());
        let mut rack = Rack::new(SR);
        let mut o = 0;
        let mut k = 0;
        while o < n {
            let len = sizes[k % sizes.len()].min(n - o);
            rack.process(&mut l[o..o + len], &mut r[o..o + len], &s);
            o += len;
            k += 1;
        }
        l
    };
    let a = run(&[512]);
    let b = run(&[1, 37, 64, 129, 1000]);
    assert_eq!(a, b);
}

#[test]
fn extreme_settings_stay_finite() {
    let mut s = wet_settings(2, 1.0);
    s.filter.resonance = 1.0;
    s.filter.drive = 1.0;
    s.phaser.feedback = 0.9;
    s.spring.decay = 1.0;
    s.tape.drive = 1.0;
    s.tape.lfo_depth = 50.0;
    s.volume_db = 6.0;
    let (mut l, mut r) = impulse(SR as usize * 2);
    for v in l.iter_mut().take(2000) {
        *v = 1.0;
    }
    let mut rack = Rack::new(SR);
    rack.process(&mut l, &mut r, &s);
    assert!(finite(&l) && peak(&l) <= 1.0);
}

#[test]
fn spring_is_stereo() {
    let n = SR as usize;
    let (mut l, mut r) = (vec![0.0f32; n], vec![0.0f32; n]);
    l[0] = 1.0;
    Spring::new(SR).process(&mut l, &mut r, &SpringParams { mix: 1.0, ..Default::default() });
    let e = |a: &[f32]| a.iter().map(|v| (v * v) as f64).sum::<f64>();
    assert!(e(&l) > 4.0 * e(&r));
}

#[test]
fn ping_pong_repeats_bounce_left_and_right() {
    let mut s = Settings { mode: 3, feedback: 0.9, ..Default::default() };
    s.on[space_fx::dsp::rack::TAPE] = false;
    s.on[space_fx::dsp::rack::SPRING] = false;
    s.delay = DelayParams { pingpong: true, sync: false, time_ms: 250.0, mix: 1.0, ..Default::default() };
    let t0 = (0.125 * SR).round() as usize;
    let (mut l, mut r) = (vec![0.0f32; SR as usize * 2], vec![0.0f32; SR as usize * 2]);
    l[t0] = 1.0;
    r[t0] = 1.0;
    Rack::new(SR).process(&mut l, &mut r, &s);
    let mut sides = vec![];
    for k in 1..=4usize {
        // One block of FIFO latency, plus a block per trip round the Feedback loop.
        let at = t0 + (k as f64 * 0.25 * SR).round() as usize + (k - 1) * 64 + BLOCK;
        let (pl, pr) = (peak(&l[at - 400..at + 400]), peak(&r[at - 400..at + 400]));
        assert!(pl.max(pr) > 1e-3, "repeat {k} is there");
        assert!(pl.max(pr) > 8.0 * pl.min(pr), "repeat {k} is on one side ({pl} / {pr})");
        sides.push(pl > pr);
    }
    assert!(sides.windows(2).all(|w| w[0] != w[1]), "{sides:?}");
}
