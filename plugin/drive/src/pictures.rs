//! The black-and-white pictures on top of each card (drive/host/graphics.js): Drive's wave being
//! clipped, Filter's response where the Cutoff is right now, and the Sequencer's steps with the
//! slewed line and the playhead. UI only.

use crate::dsp::autofilter::{damping, mod_cutoff};
use crate::dsp::engine::Settings;
use crate::dsp::sequencer::{glide, locate, STEPS};
use crate::dsp::shaper::{bias_offset, curve, drive_gain, makeup};
use crate::editor::Which;
use crate::Shared;
use nih_plug_egui::egui::epaint::{PathShape, PathStroke};
use nih_plug_egui::egui::{pos2, vec2, Color32, Painter, Pos2, Rect, Shape, Stroke};
use std::f32::consts::PI;
use std::sync::atomic::Ordering;

pub const INK: Color32 = Color32::from_rgb(0xe8, 0xe8, 0xe8);
pub const MID: Color32 = Color32::from_rgb(0x8a, 0x8a, 0x8a);
pub const FAINT: Color32 = Color32::from_rgb(0x4a, 0x4a, 0x4a);
pub const BLACK: Color32 = Color32::from_rgb(0x16, 0x16, 0x16);
const PACK: Color32 = Color32::from_rgb(0x3a, 0x3a, 0x3a);
const LIT: Color32 = Color32::from_rgb(0x5a, 0x5a, 0x5a);
const SOFT: Color32 = Color32::from_rgb(0xc8, 0xc8, 0xc8);

pub struct Ctx<'a> {
    pub p: &'a Painter,
    pub r: Rect,
    pub s: &'a Settings,
    pub shared: &'a Shared,
    pub t: f32,
    pub on: bool,
}

impl Ctx<'_> {
    fn at(&self, x: f32, y: f32) -> Pos2 {
        self.r.min + vec2(x, y)
    }
    fn line(&self, pts: Vec<Pos2>, width: f32, color: Color32) {
        self.p.add(Shape::Path(PathShape::line(pts, PathStroke::new(width, color))));
    }
    fn dashed(&self, a: Pos2, b: Pos2, color: Color32) {
        self.p.extend(Shape::dashed_line(&[a, b], stroke(1.0, color), 2.0, 3.0));
    }
    fn level(&self) -> f32 {
        (self.shared.level.load(Ordering::Relaxed) * 2.0).min(1.0)
    }
}

pub fn stroke(width: f32, color: Color32) -> Stroke {
    Stroke { width, color }
}

pub fn draw(g: &Ctx, which: Which) {
    match which {
        Which::Drive => drive(g),
        Which::Filter => filter(g),
        Which::Seq => seq(g),
    }
}

/// Two cycles of a sine (dashed) and what the Type makes of it, drifting slowly.
fn drive(g: &Ctx) {
    let p = &g.s.drive;
    let t = p.kind.min(3);
    let gain = drive_gain(p.amount);
    let b = bias_offset(p.bias);
    let fb = curve(t, b);
    let out = makeup(t, gain) * 10f64.powf(p.output / 20.0);
    let (w, h) = (g.r.width(), g.r.height());
    let cy = h / 2.0;
    let amp = h * 0.36;
    let span = w - 12.0;
    let ph = g.t * 0.6;
    g.p.line_segment([g.at(6.0, cy), g.at(6.0 + span, cy)], stroke(1.0, FAINT));
    let wave = |shape: &dyn Fn(f64) -> f64| -> Vec<Pos2> {
        (0..=span as usize)
            .map(|i| {
                let x = 0.5 * ((i as f32 / span) * 4.0 * PI + ph).sin() as f64;
                let v = (shape(x) * 2.0).clamp(-1.1, 1.1) as f32;
                g.at(6.0 + i as f32, cy - v * amp)
            })
            .collect()
    };
    let dry = wave(&|x| x);
    for pair in dry.chunks(5) {
        if pair.len() > 2 {
            g.line(pair[..3].to_vec(), 1.0, MID);
        }
    }
    let mix = p.mix;
    let lit = if g.level() > 0.02 { INK } else { SOFT };
    g.line(wave(&|x| x * (1.0 - mix) + (curve(t, x * gain + b) - fb) * out * mix), 1.4, lit);
}

fn response(mode: usize, k: f64, f: f64, fc: f64) -> f64 {
    let v = f / fc;
    let den = (1.0 - v * v).hypot(k * v);
    let lp = (k / 2.0).sqrt();
    match mode {
        0 => lp / den,
        1 => k * v / den,
        _ => lp * v * v / den,
    }
}

fn filter(g: &Ctx) {
    let p = &g.s.filter;
    let k = damping(p.res);
    let (w, h) = (g.r.width(), g.r.height());
    let (top, bot) = (8.0, h - 8.0);
    let y_of = |db: f64| top + ((18.0 - db.clamp(-36.0, 18.0)) / 54.0) as f32 * (bot - top);
    let x_of = |f: f64| 6.0 + ((f / 20.0).ln() / 1000f64.ln()) as f32 * (w - 12.0);
    for f in [100.0, 1000.0, 10000.0] {
        g.p.line_segment([g.at(x_of(f), top), g.at(x_of(f), bot)], stroke(1.0, FAINT));
    }
    g.dashed(g.at(6.0, y_of(0.0)), g.at(w - 6.0, y_of(0.0)), FAINT);
    g.dashed(g.at(x_of(p.cutoff), top), g.at(x_of(p.cutoff), bot), MID);
    let fc = if g.on && g.shared.level.load(Ordering::Relaxed) > 0.0 {
        g.shared.cutoff.load(Ordering::Relaxed) as f64
    } else {
        mod_cutoff(p, if g.s.seq_on { g.s.seq.values[0] } else { 0.0 }, 0.0, 44100.0)
    };
    let n = (w - 12.0) as usize;
    let pts = (0..=n)
        .map(|i| {
            let f = 20.0 * 1000f64.powf(i as f64 / n as f64);
            g.at(6.0 + i as f32, y_of(20.0 * response(p.mode, k, f, fc).max(1e-6).log10()))
        })
        .collect();
    g.line(pts, 1.4, if g.level() > 0.02 { INK } else { SOFT });
}

const PAD: f32 = 6.0;

/// Which step and level a point in the Sequencer's picture is.
pub fn seq_hit(r: Rect, at: Pos2) -> Option<(usize, f32)> {
    let bw = (r.width() - PAD * 2.0) / STEPS as f32;
    let x = at.x - r.left() - PAD;
    if x < 0.0 {
        return None;
    }
    let step = (x / bw) as usize;
    if step >= STEPS {
        return None;
    }
    let (top, bot) = (r.top() + PAD + 2.0, r.bottom() - PAD);
    let v = ((bot - at.y) / (bot - top)).clamp(0.0, 1.0);
    Some((step, (v * 100.0).round() / 100.0))
}

fn seq(g: &Ctx) {
    let p = &g.s.seq;
    let count = p.steps.clamp(1, STEPS);
    let (w, h) = (g.r.width(), g.r.height());
    let bw = (w - PAD * 2.0) / STEPS as f32;
    let split = 1.0 + p.swing.clamp(0.0, 1.0) as f32 / 3.0;
    let start = |i: usize| (i / 2 * 2) as f32 + if i % 2 == 1 { split } else { 0.0 };
    let x_of = |pos: f32| PAD + pos * bw;
    let (top, bot) = (PAD + 2.0, h - PAD);
    let y_of = |v: f64| bot - v as f32 * (bot - top);
    let playing = g.on;
    let cur = if playing { g.shared.step.load(Ordering::Relaxed) } else { -1 };
    for i in 0..STEPS {
        let x1 = x_of(start(i)) + 1.0;
        let x2 = x_of(if i + 1 < STEPS { start(i + 1) } else { STEPS as f32 }) - 1.0;
        let v = p.values[i];
        let active = i < count;
        let lit = i as i32 == cur;
        let fill = if !active { Color32::from_gray(0x22) } else if lit { LIT } else { PACK };
        g.p.rect_filled(Rect::from_min_max(g.at(x1, y_of(v)), g.at(x2, bot)), 0.0, fill);
        let edge = if !active { FAINT } else if lit { INK } else { MID };
        g.p.line_segment([g.at(x1, y_of(v)), g.at(x2, y_of(v))], stroke(1.0, edge));
    }
    // The line the Filter follows.
    let x0 = x_of(0.0);
    let span = x_of(count as f32) - x0;
    let n = span as usize;
    let pts = (0..=n)
        .map(|i| {
            let pos = (i as f64 / n as f64) * count as f64 - if i == n { 1e-9 } else { 0.0 };
            let (step, u) = locate(pos, p.swing);
            let idx = (step as usize).min(count - 1);
            let from = p.values[(idx + count - 1) % count];
            let to = p.values[idx];
            let v = if p.slew > 0.0 && u < p.slew { from + (to - from) * glide(u / p.slew) } else { to };
            g.at(x0 + i as f32, y_of(v))
        })
        .collect();
    g.line(pts, 1.4, INK);
    if playing {
        let pos = g.shared.pos.load(Ordering::Relaxed).rem_euclid(count as f32);
        let v = g.shared.seq_out.load(Ordering::Relaxed) as f64;
        g.p.circle_filled(g.at(x_of(pos), y_of(v)), 3.0, INK);
    }
    let _ = pos2;
}
