//! The black-and-white picture at the top of each module (host/graphics.js): Tape's reels,
//! Filter's response, Delay's echo, Phaser's sweeping notches, Spring's coil, and the Routing
//! diagram. Drawn from the settings and each module's level. UI only.

use crate::dsp::filter::damping;
use crate::dsp::rack::{MODES, MODULE_NAMES, N_MOD, TAIL};
use crate::dsp::rack::{DELAY, FILTER, PHASER, SPRING, TAPE};
use crate::dsp::rack::Settings;
use nih_plug_egui::egui::epaint::{CubicBezierShape, Mesh, PathShape, PathStroke};
use nih_plug_egui::egui::{vec2, Align2, Color32, FontId, Painter, Pos2, Rect, Shape, Stroke, StrokeKind};
use std::f32::consts::{PI, TAU};

pub const INK: Color32 = Color32::from_rgb(0xe8, 0xe8, 0xe8);
pub const MID: Color32 = Color32::from_rgb(0x8a, 0x8a, 0x8a);
pub const FAINT: Color32 = Color32::from_rgb(0x4a, 0x4a, 0x4a);
pub const BLACK: Color32 = Color32::from_rgb(0x16, 0x16, 0x16);
const PACK: Color32 = Color32::from_rgb(0x3a, 0x3a, 0x3a);

/// What the pictures remember between frames.
#[derive(Default)]
pub struct Anim {
    travel: f32,
    wound: f32,
    a_l: f32,
    a_r: f32,
    shake: f32,
}

/// Everything one picture needs.
pub struct Ctx<'a> {
    pub p: &'a Painter,
    /// The picture's area.
    pub r: Rect,
    pub s: &'a Settings,
    /// The module's level, 0..1.
    pub lvl: f32,
    /// Seconds, for animation.
    pub t: f32,
    /// Frames of 60 Hz since the last draw, so animation speed doesn't depend on frame rate.
    pub steps: f32,
}

impl Ctx<'_> {
    fn at(&self, x: f32, y: f32) -> Pos2 {
        self.r.min + vec2(x, y)
    }
    fn w(&self) -> f32 {
        self.r.width()
    }
    fn h(&self) -> f32 {
        self.r.height()
    }
    fn line(&self, pts: Vec<Pos2>, width: f32, color: Color32) {
        self.p.add(Shape::Path(PathShape::line(pts, PathStroke::new(width as f32, color))));
    }
    fn seg(&self, a: Pos2, b: Pos2, width: f32, color: Color32) {
        self.p.line_segment([a, b], stroke(width, color));
    }
}

/// A filled ring sector, from radius r0 to r1, its edges at angles (a0, a1) inside and
/// (b0, b1) outside.
fn sector(p: &Painter, c: Pos2, r0: f32, r1: f32, (a0, a1): (f32, f32), (b0, b1): (f32, f32), fill: Color32) {
    let n = 12;
    let mut mesh = Mesh::default();
    for i in 0..=n {
        let u = i as f32 / n as f32;
        let ai = a0 + (a1 - a0) * u;
        let bo = b0 + (b1 - b0) * u;
        mesh.colored_vertex(c + vec2(ai.cos(), ai.sin()) * r0, fill);
        mesh.colored_vertex(c + vec2(bo.cos(), bo.sin()) * r1, fill);
        if i > 0 {
            let k = (i as u32) * 2;
            mesh.add_triangle(k - 2, k - 1, k);
            mesh.add_triangle(k - 1, k + 1, k);
        }
    }
    p.add(Shape::mesh(mesh));
}

fn arc_pts(c: Pos2, r: f32, a0: f32, a1: f32, n: usize) -> Vec<Pos2> {
    (0..=n).map(|i| {
        let a = a0 + (a1 - a0) * i as f32 / n as f32;
        c + vec2(a.cos(), a.sin()) * r
    }).collect()
}

/// A reel seen from the front: the wound tape shows through three windows in the flange.
fn reel(g: &Ctx, c: Pos2, r: f32, pack: f32, angle: f32) {
    g.p.circle_filled(c, r, BLACK);
    let half = 50.0 * PI / 360.0;
    for k in 0..3 {
        let a = angle + k as f32 * TAU / 3.0;
        let inner = (a - half, a + half);
        let outer = (a - half * 1.25, a + half * 1.25);
        let lerp = |t: f32| (inner.0 + (outer.0 - inner.0) * t, inner.1 + (outer.1 - inner.1) * t);
        // The pack shows up to its own radius.
        let top = pack.min(r * 0.84);
        if top > r * 0.36 {
            let t = (top - r * 0.36) / (r * 0.48);
            sector(g.p, c, r * 0.36, top, inner, lerp(t), PACK);
        }
        let mut outline = arc_pts(c, r * 0.84, outer.0, outer.1, 10);
        outline.extend(arc_pts(c, r * 0.36, inner.1, inner.0, 6));
        outline.push(outline[0]);
        g.line(outline, 1.2, INK);
    }
    g.p.circle_stroke(c, r, stroke(1.2, INK));
    g.p.circle_filled(c, r * 0.24, BLACK);
    g.p.circle_stroke(c, r * 0.24, stroke(1.2, INK));
    g.p.circle_stroke(c, r * 0.07, stroke(1.2, INK));
}

pub fn tape(g: &Ctx, st: &mut Anim) {
    let p = &g.s.tape;
    let (w, h) = (g.w(), g.h());
    let r = (h * 0.31).min(w * 0.16);
    let cy = r + 3.0;
    let x1 = w / 2.0 - r - 2.0;
    let x2 = w / 2.0 + r + 2.0;
    let v = (p.speed as f32 / 15.0) * (1.0 + p.wow as f32 * 0.3 * (g.t * 2.1).sin());
    st.travel += v * 0.35 * g.steps;
    st.wound += v * 0.0004 * g.steps;
    let prog = 1.0 - ((st.wound % 2.0) - 1.0).abs();
    let pl = r * (0.4 + 0.5 * (1.0 - prog));
    let pr = r * (0.4 + 0.5 * prog);
    st.a_l -= v * 0.35 / pl * g.steps;
    st.a_r -= v * 0.35 / pr * g.steps;

    // The deck behind.
    let top = cy + r * 0.35;
    let dl = x1 - r * 0.55;
    let dr = x2 + r * 0.55;
    g.p.rect_stroke(Rect::from_min_max(g.at(dl, top), g.at(dr, h - 4.0)), 0.0, stroke(1.0, MID), StrokeKind::Inside);

    // The tape: off each pack's outer edge, round a guide roller, under the head cover.
    let ry = cy + r + 12.0;
    let rr = 6.0;
    let gx1 = w / 2.0 - r * 1.15;
    let gx2 = w / 2.0 + r * 1.15;
    let mut path = vec![g.at(x1 - pl, cy), g.at(gx1 - rr, ry)];
    path.extend(arc_pts(g.at(gx1, ry), rr, PI, PI / 2.0, 6));
    path.extend(arc_pts(g.at(gx2, ry), rr, PI / 2.0, 0.0, 6));
    path.push(g.at(x2 + pr, cy));
    g.line(path.clone(), 1.4, INK);
    // Dark gaps travelling along it, so it moves.
    let mut acc = 0.0;
    let phase = st.travel.rem_euclid(11.0);
    for s in path.windows(2) {
        let len = s[0].distance(s[1]);
        let mut d = (phase - acc).rem_euclid(11.0);
        while d < len {
            let q = s[0] + (s[1] - s[0]) * (d / len);
            g.p.circle_filled(q, 1.0, BLACK);
            d += 11.0;
        }
        acc += len;
    }

    reel(g, g.at(x1, cy), r, pl, st.a_l);
    reel(g, g.at(x2, cy), r, pr, st.a_r);

    for gx in [gx1, gx2] {
        g.p.circle_filled(g.at(gx, ry), rr, BLACK);
        g.p.circle_stroke(g.at(gx, ry), rr, stroke(1.2, INK));
        g.p.circle_stroke(g.at(gx, ry), 1.5, stroke(1.2, INK));
    }
    // The head cover, and the play head's lamp, lit when there's signal.
    let cw = r * 0.8;
    let ct = ry - 8.0;
    let cb = (ry + 18.0).min(h - 12.0);
    let cover = vec![
        g.at(w / 2.0 - cw, ct),
        g.at(w / 2.0 + cw, ct),
        g.at(w / 2.0 + cw, ct + 9.0),
        g.at(w / 2.0 + 6.0, cb),
        g.at(w / 2.0 - 6.0, cb),
        g.at(w / 2.0 - cw, ct + 9.0),
    ];
    g.p.add(Shape::convex_polygon(cover, BLACK, stroke(1.2, INK)));
    g.p.rect_filled(Rect::from_min_size(g.at(w / 2.0 - 8.0, ct + 4.0), vec2(16.0, 3.0)), 0.0, if g.lvl > 0.02 { INK } else { FAINT });
    g.p.circle_stroke(g.at(w / 2.0, (cb + 5.0).min(h - 7.0)), 3.0, stroke(1.0, MID));
}

fn freq_grid(g: &Ctx, top: f32, bot: f32) {
    for f in [100.0f32, 1000.0, 10000.0] {
        let x = (4.0 + (f / 20.0).log10() / 3.0 * (g.w() - 8.0)).round() + 0.5;
        g.seg(g.at(x, top), g.at(x, bot), 1.0, FAINT);
    }
}

pub fn filter(g: &Ctx) {
    let p = &g.s.filter;
    let (w, h) = (g.w(), g.h());
    let top = 8.0;
    let bot = h - 8.0;
    let span = w - 8.0;
    freq_grid(g, top, bot);
    let k = damping(p.resonance) as f32;
    let fc = (p.cutoff as f32 * 2f32.powf(4.0 * p.env as f32 * g.lvl)).min(16000.0);
    let bp = p.mode == 1;
    let kd = k.max(0.06);
    let (db_top, db_bot) = (18.0, -36.0);
    let y_of = |db: f32| top + (db_top - db.clamp(db_bot, db_top)) / (db_top - db_bot) * (bot - top);
    let zero = y_of(0.0).round() + 0.5;
    g.p.add(Shape::dashed_line(&[g.at(4.0, zero), g.at(w - 4.0, zero)], stroke(1.0, FAINT), 2.0, 3.0));
    let pts = (0..=span as usize)
        .map(|i| {
            let f = 20.0 * 1000f32.powf(i as f32 / span);
            let v = f / fc;
            let den = (1.0 - v * v).hypot(kd * v);
            let mag = if bp { kd * v } else { 1.0 } / den;
            g.at(4.0 + i as f32, y_of(20.0 * mag.log10()))
        })
        .collect();
    g.line(pts, 1.4, if g.lvl > 0.02 { INK } else { MID });
    if k < 0.06 {
        // Self-oscillation: a triangle wave scrolling across the top.
        let ph = (g.t * 30.0) % 10.0;
        let pts = (4..=(w - 4.0) as i32)
            .map(|x| {
                let u = ((x as f32 + ph) % 10.0) / 10.0;
                g.at(x as f32, top + 10.0 - 10.0 * (2.0 * u - 1.0).abs())
            })
            .collect();
        g.line(pts, 1.0, INK);
    }
}

/// Seconds between the dry hit and the echo.
fn delay_time(s: &Settings) -> f32 {
    if s.delay.sync {
        (s.delay.beats * 60.0 / s.tempo.max(1.0)) as f32
    } else {
        s.delay.time_ms as f32 / 1000.0
    }
}

pub fn delay(g: &Ctx) {
    let (w, h) = (g.w(), g.h());
    let left = 10.0;
    let right = w - 10.0;
    let base = h - 14.0;
    let span = 2.0;
    let dt = delay_time(g.s);
    g.seg(g.at(left, base + 0.5), g.at(right, base + 0.5), 1.0, FAINT);
    for i in 0..=4 {
        let x = (left + i as f32 * 0.5 / span * (right - left)).round() + 0.5;
        g.seg(g.at(x, base), g.at(x, base + 4.0), 1.0, FAINT);
    }
    for k in 0..2 {
        let x = left + k as f32 * dt / span * (right - left);
        if x > right {
            break;
        }
        let bh = base - 12.0;
        g.p.rect_filled(Rect::from_min_size(g.at(x.round() - 1.0, base - bh), vec2(3.0, bh)), 0.0, if k == 0 { FAINT } else { INK });
    }
    if dt > 0.0 {
        let x = left + (g.t % dt) / span * (right - left);
        g.seg(g.at(x + 0.5, 8.0), g.at(x + 0.5, base), 1.0, if g.lvl > 0.02 { MID } else { FAINT });
    }
}

pub fn spring(g: &Ctx, st: &mut Anim) {
    let p = &g.s.spring;
    let (w, h) = (g.w(), g.h());
    st.shake = g.lvl.max(st.shake * (0.86 + p.decay as f32 * 0.13).powf(g.steps));
    let pad = 10.0;
    let len = (w - pad * 2.0) * (0.55 + 0.45 * (p.length as f32 - 20.0) / 100.0);
    let x0 = (w - len) / 2.0;
    let cy = h / 2.0;
    let turns = (7.0 + (p.tone as f32 - 1500.0) / 800.0).round();
    let r = (h * 0.2).min(30.0);
    let lead = 8.0;
    g.p.rect_filled(Rect::from_min_size(g.at(x0 - lead - 3.0, cy - r - 6.0), vec2(3.0, r * 2.0 + 12.0)), 0.0, MID);
    g.p.rect_filled(Rect::from_min_size(g.at(x0 + len + lead, cy - r - 6.0), vec2(3.0, r * 2.0 + 12.0)), 0.0, MID);
    let mut pts = vec![g.at(x0 - lead, cy), g.at(x0, cy)];
    let steps = (turns * 40.0) as usize;
    for i in 0..=steps {
        let u = i as f32 / steps as f32;
        let a = u * turns * TAU;
        let wob = st.shake * h * 0.18 * (u * PI).sin() * (g.t * 40.0 + u * (6.0 + p.chirp as f32 * 12.0)).sin();
        let x = x0 + u * len + (a.cos() - 1.0) * (r * 0.35).min(len / turns * 0.4) * (u * PI).sin();
        pts.push(g.at(x, cy + a.sin() * r + wob));
    }
    pts.push(g.at(x0 + len + lead, cy));
    g.line(pts, 1.1, INK);
}

pub fn phaser(g: &Ctx) {
    let p = &g.s.phaser;
    let (w, h) = (g.w(), g.h());
    let hz = if p.sync { (g.s.tempo / 60.0 / p.rate_beats.max(0.0625)) as f32 } else { p.speed as f32 };
    let top = 8.0;
    let bot = h - 8.0;
    freq_grid(g, top, bot);
    let sharp = 3.0 + 9.0 * p.feedback as f32;
    let mix = (p.mix as f32).clamp(0.0, 1.0);
    let curve = |phase: f32| -> Vec<Pos2> {
        let tri = |ph: f32| if ph < 0.65 { ph / 0.65 } else { 1.0 - (ph - 0.65) / 0.35 };
        let sweep = 2.0 * tri(phase) - 1.0;
        let fc = p.center as f32 * 2.2f32.powf(p.depth as f32 / 0.6 * sweep);
        (0..=(w - 8.0) as usize)
            .map(|i| {
                let f = 20.0 * 1000f32.powf(i as f32 / (w - 8.0));
                let mut m = 1.0;
                for k in [0.45, 1.0, 2.2] {
                    let d = (f / (fc * k)).log2() * sharp;
                    m *= 1.0 - mix * (-d * d).exp();
                }
                g.at(4.0 + i as f32, top + (1.0 - m) * (bot - top))
            })
            .collect()
    };
    let ph = (g.t * hz) % 1.0;
    if p.spread > 0.0 {
        let pts = curve((ph + p.spread as f32 / 360.0) % 1.0);
        g.p.add(Shape::dashed_line(&pts, stroke(1.4, MID), 3.0, 3.0));
    }
    g.line(curve(ph), 1.4, if g.lvl > 0.02 { INK } else { MID });
}

fn arrow(g: &Ctx, a: Pos2, b: Pos2, color: Color32, width: f32) {
    g.seg(a, b, width, color);
    let d = (b - a).normalized();
    let n = vec2(-d.y, d.x);
    g.p.add(Shape::convex_polygon(vec![b, b - d * 6.0 + n * 3.0, b - d * 6.0 - n * 3.0], color, Stroke::NONE));
}

fn node(g: &Ctx, x: f32, y: f32, w: f32, bh: f32, i: usize) {
    let r = Rect::from_min_size(g.at(x, y - bh / 2.0), vec2(w, bh));
    g.p.rect_filled(r, 2.0, BLACK);
    if g.s.on[i] {
        g.p.rect_stroke(r, 2.0, stroke(1.2, INK), StrokeKind::Inside);
    } else {
        let c = [r.left_top(), r.right_top(), r.right_bottom(), r.left_bottom(), r.left_top()];
        g.p.add(Shape::dashed_line(&c, stroke(1.2, Color32::from_gray(0x5a)), 3.0, 3.0));
    }
    g.p.text(r.center(), Align2::CENTER_CENTER, MODULE_NAMES[i], FontId::proportional(8.5), INK);
}

fn end_label(g: &Ctx, x: f32, y: f32, label: &str) {
    g.p.text(g.at(x, y), Align2::CENTER_CENTER, label, FontId::proportional(8.5), MID);
}

fn fb_curve(g: &Ctx, pts: [Pos2; 4], alpha: f32) {
    let c = INK.gamma_multiply(alpha);
    let curve = CubicBezierShape::from_points_stroke(pts, false, Color32::TRANSPARENT, stroke(1.4, c));
    let flat = curve.flatten(Some(0.5));
    g.p.add(Shape::dashed_line(&flat, stroke(1.4, c), 4.0, 3.0));
    let n = flat.len();
    if n >= 2 {
        arrow(g, flat[n - 2], flat[n - 1], c, 1.4);
    }
}

/// The current Mode as boxes and arrows, with a loop for Feedback. A module switched off is
/// drawn dashed. Laid out on a 240 x 180 grid and scaled to fit.
pub fn routing(g: &Ctx) {
    let m = &MODES[g.s.mode.min(MODES.len() - 1)];
    let loop_ = g.s.feedback as f32;
    let (w, h) = (g.w(), g.h());
    let cx = w / 2.0;
    let fb_alpha = if loop_ > 0.0 { 0.35 + 0.65 * loop_ } else { 0.0 };
    let wire = Color32::from_gray(0x9a);
    end_label(g, cx, 7.0, "In");
    end_label(g, cx, h - 6.0, "Out");
    if m.parallel {
        let loopers: Vec<usize> = (0..N_MOD).filter(|&t| t != TAIL).collect();
        let bw = (w - 20.0) / 4.0;
        let y = h * 0.42;
        let sy = h * 0.75;
        for (i, &t) in loopers.iter().enumerate() {
            let x = 4.0 + i as f32 * (bw + 4.0);
            let mx = x + bw / 2.0;
            let a = CubicBezierShape::from_points_stroke([g.at(cx, 12.0), g.at(cx, 24.0), g.at(mx, 22.0), g.at(mx, y - 8.0)], false, Color32::TRANSPARENT, stroke(1.2, wire));
            g.p.add(a);
            let b = CubicBezierShape::from_points_stroke([g.at(mx, y + 7.0), g.at(mx, y + 22.0), g.at(cx, y + 18.0), g.at(cx, sy - 6.0)], false, Color32::TRANSPARENT, stroke(1.2, wire));
            g.p.add(b);
            node(g, x, y, bw, 14.0, t);
            if fb_alpha > 0.0 {
                fb_curve(g, [g.at(x + bw - 8.0, y - 7.0), g.at(x + bw - 8.0, y - 18.0), g.at(x + 8.0, y - 18.0), g.at(x + 8.0, y - 8.0)], fb_alpha);
            }
        }
        node(g, cx - 32.0, sy, 64.0, 12.0, TAIL);
        arrow(g, g.at(cx, sy + 6.0), g.at(cx, h - 12.0), wire, 1.2);
    } else {
        let mut order: Vec<usize> = m.order.to_vec();
        order.push(TAIL);
        let n = order.len();
        let bw = 64.0;
        let x = cx - bw / 2.0;
        let bh = if n > 4 { 11.0 } else { 14.0 };
        let top = 24.0;
        let step = ((h - top - 28.0) / (n - 1) as f32).min(41.0);
        let ys: Vec<f32> = (0..n).map(|i| top + i as f32 * step).collect();
        arrow(g, g.at(cx, 12.0), g.at(cx, ys[0] - bh / 2.0 - 1.0), wire, 1.2);
        for (i, &t) in order.iter().enumerate() {
            node(g, x, ys[i], bw, bh, t);
            if i > 0 {
                arrow(g, g.at(cx, ys[i - 1] + bh / 2.0), g.at(cx, ys[i] - bh / 2.0 - 1.0), wire, 1.2);
            }
        }
        arrow(g, g.at(cx, ys[n - 1] + bh / 2.0), g.at(cx, h - 12.0), wire, 1.2);
        // Feedback: from the last module before the Spring back to the first.
        if fb_alpha > 0.0 {
            let l = n - 2;
            let r = x + bw;
            let (y1, y0, bulge) = if l > 0 { (ys[l], ys[0], 26.0) } else { (ys[0] + 4.0, ys[0] - 4.0, 16.0) };
            fb_curve(g, [g.at(r, y1), g.at(r + bulge, y1), g.at(r + bulge, y0), g.at(r + 2.0, y0)], fb_alpha);
        }
    }
}

/// Draw module `i`'s picture (or the Routing diagram for `None`).
pub fn draw(g: &Ctx, which: Option<usize>, anim: &mut [Anim; N_MOD]) {
    match which {
        Some(TAPE) => tape(g, &mut anim[TAPE]),
        Some(FILTER) => filter(g),
        Some(DELAY) => delay(g),
        Some(PHASER) => phaser(g),
        Some(SPRING) => spring(g, &mut anim[SPRING]),
        _ => routing(g),
    }
}

#[inline]
pub fn stroke(width: f32, color: Color32) -> Stroke {
    Stroke { width, color }
}
