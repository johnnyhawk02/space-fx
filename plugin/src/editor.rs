//! The editor: one row of cards, left to right (Tape, Filter, Delay, Phaser, Spring, Routing),
//! each with its live picture on top and its dials below on one shared grid, black and white,
//! as in the browser prototype (host/style.css).

use crate::dsp::rack::{DELAY, FILTER, N_MOD, PHASER, SPRING, TAPE};
use crate::params::{SpaceFxParams, HEIGHT, WIDTH};
use crate::pictures::{self, stroke, Anim, BLACK};
use crate::Shared;
use nih_plug::prelude::*;
use nih_plug_egui::egui::{self, pos2, vec2, Align2, Color32, FontId, Id, Rect, Sense, StrokeKind};
use nih_plug_egui::{create_egui_editor, egui::Frame};
use std::f32::consts::PI;
use std::sync::atomic::Ordering;
use std::sync::Arc;

/// One dial cell, as in the prototype.
const COL: f32 = 56.0;
const ROW: f32 = 60.0;
/// The gap above each row of dials.
const GAP: f32 = 16.0;
const PAD: f32 = 8.0;
const HEAD: f32 = 28.0;
const PIC: f32 = 120.0;

const BG: Color32 = Color32::from_rgb(0x1e, 0x1e, 0x1e);
const RACK: Color32 = Color32::from_rgb(0x20, 0x20, 0x20);
const CARD: Color32 = Color32::from_rgb(0x26, 0x26, 0x26);
const LINE: Color32 = Color32::from_rgb(0x4a, 0x4a, 0x4a);
const TEXT: Color32 = Color32::from_rgb(0xd0, 0xd0, 0xd0);
const DIM: Color32 = Color32::from_rgb(0x8a, 0x8a, 0x8a);
const ON: Color32 = Color32::from_rgb(0xf2, 0xf2, 0xf2);
const OFF: Color32 = Color32::from_rgb(0x5a, 0x5a, 0x5a);

#[derive(Clone, Copy)]
enum Cell {
    Dial(ParamPtr, &'static str),
    Check(ParamPtr, &'static str),
}

struct Card {
    name: &'static str,
    /// The module this card is, or None for Routing.
    module: Option<usize>,
    on: Option<ParamPtr>,
    cols: usize,
    /// At least this wide (Routing, so its diagram has room).
    min_w: f32,
    rows: Vec<Vec<Cell>>,
}

fn dial<P: Param>(p: &P, label: &'static str) -> Cell {
    Cell::Dial(p.as_ptr(), label)
}

fn check<P: Param>(p: &P, label: &'static str) -> Cell {
    Cell::Check(p.as_ptr(), label)
}

fn cards(p: &SpaceFxParams) -> Vec<Card> {
    let (t, f, d, ph, sp, m) = (&p.tape, &p.filter, &p.delay, &p.phaser, &p.spring, &p.main);
    vec![
        Card {
            name: "Tape",
            module: Some(TAPE),
            on: Some(t.on.as_ptr()),
            cols: 6,
            min_w: 0.0,
            rows: vec![
                vec![dial(&t.drive, "Drive"), dial(&t.bias, "Bias"), dial(&t.speed, "Speed"), dial(&t.spacing, "Spacing"), dial(&t.mix, "Dry/Wet")],
                vec![
                    dial(&t.wow, "Wow"),
                    dial(&t.lfo_shape, "Shape"),
                    dial(&t.lfo_rate, "Rate"),
                    check(&t.lfo_slow, "x0.01"),
                    dial(&t.lfo_depth, "Depth"),
                    dial(&t.lfo_slew, "Slew"),
                ],
            ],
        },
        Card {
            name: "Filter",
            module: Some(FILTER),
            on: Some(f.on.as_ptr()),
            cols: 3,
            min_w: 0.0,
            rows: vec![
                vec![dial(&f.mode, "Mode"), dial(&f.cutoff, "Cutoff"), dial(&f.resonance, "Res")],
                vec![dial(&f.drive, "Drive"), dial(&f.env, "Env"), dial(&f.mix, "Dry/Wet")],
            ],
        },
        Card {
            name: "Delay",
            module: Some(DELAY),
            on: Some(d.on.as_ptr()),
            cols: 3,
            min_w: 0.0,
            rows: vec![vec![
                check(&d.sync, "Sync"),
                if d.sync.value() { dial(&d.beats, "Time") } else { dial(&d.time_ms, "Time") },
                dial(&d.mix, "Dry/Wet"),
            ]],
        },
        Card {
            name: "Phaser",
            module: Some(PHASER),
            on: Some(ph.on.as_ptr()),
            cols: 4,
            min_w: 0.0,
            rows: vec![
                vec![
                    check(&ph.sync, "Sync"),
                    if ph.sync.value() { dial(&ph.rate_beats, "Rate") } else { dial(&ph.speed, "Rate") },
                    dial(&ph.depth, "Depth"),
                    dial(&ph.center, "Center"),
                ],
                vec![dial(&ph.feedback, "Feedback"), dial(&ph.spread, "Spread"), dial(&ph.mix, "Dry/Wet")],
            ],
        },
        Card {
            name: "Spring",
            module: Some(SPRING),
            on: Some(sp.on.as_ptr()),
            cols: 3,
            min_w: 0.0,
            rows: vec![
                vec![dial(&sp.length, "Length"), dial(&sp.decay, "Decay"), dial(&sp.tone, "Tone")],
                vec![dial(&sp.chirp, "Chirp"), dial(&sp.mix, "Dry/Wet")],
            ],
        },
        Card {
            name: "Routing",
            module: None,
            on: None,
            cols: 2,
            min_w: 196.0,
            rows: vec![vec![dial(&m.mode, "Mode"), dial(&m.feedback, "Feedback")], vec![dial(&m.dry_wet, "Dry/Wet"), dial(&m.volume, "Volume")]],
        },
    ]
}

pub struct UiState {
    anim: [Anim; N_MOD],
    last: f64,
}

pub fn create(params: Arc<SpaceFxParams>, shared: Arc<Shared>) -> Option<Box<dyn Editor>> {
    let state = UiState { anim: Default::default(), last: 0.0 };
    create_egui_editor(params.editor_state.clone(), state, |_, _| {}, move |ctx, setter, st| {
        draw(ctx, setter, st, &params, &shared);
        ctx.request_repaint();
    })
}

fn set(setter: &ParamSetter, p: ParamPtr, norm: f32) {
    unsafe { setter.raw_context.raw_set_parameter_normalized(p, norm.clamp(0.0, 1.0)) };
}

fn draw(ctx: &egui::Context, setter: &ParamSetter, st: &mut UiState, params: &SpaceFxParams, shared: &Shared) {
    let now = ctx.input(|i| i.time);
    let steps = (((now - st.last) * 60.0) as f32).clamp(0.0, 6.0);
    st.last = now;
    let tempo = shared.tempo.load(Ordering::Relaxed) as f64;
    let settings = params.settings(if tempo > 0.0 { tempo } else { 120.0 });

    egui::CentralPanel::default().frame(Frame::NONE.fill(BG)).show(ctx, |ui| {
        let painter = ui.painter().clone();
        let origin = ui.max_rect().min;
        let rack = Rect::from_min_size(origin, vec2(WIDTH as f32, HEIGHT as f32));
        painter.rect_filled(rack, 4.0, RACK);
        let mut x = origin.x + PAD;
        let top = origin.y + PAD;
        let card_h = HEIGHT as f32 - PAD * 2.0;
        for card in cards(params) {
            let w = (card.cols as f32 * COL + PAD * 2.0).max(card.min_w);
            let r = Rect::from_min_size(pos2(x, top), vec2(w, card_h));
            painter.rect_filled(r, 3.0, CARD);
            painter.rect_stroke(r, 3.0, stroke(1.0, LINE), StrokeKind::Inside);

            // Header: the Device Activator and the name.
            let on = card.on.map(|p| unsafe { p.modulated_normalized_value() } > 0.5).unwrap_or(true);
            let mut name_x = r.left() + 10.0;
            if let Some(p) = card.on {
                let c = pos2(r.left() + 16.0, r.top() + 15.0);
                let resp = ui.interact(Rect::from_center_size(c, vec2(18.0, 18.0)), Id::new(("on", card.name)), Sense::click());
                if resp.clicked() {
                    unsafe { setter.raw_context.raw_begin_set_parameter(p) };
                    set(setter, p, if on { 0.0 } else { 1.0 });
                    unsafe { setter.raw_context.raw_end_set_parameter(p) };
                }
                painter.circle_filled(c, 6.0, if on { ON } else { OFF });
                painter.circle_stroke(c, 6.0, stroke(1.0, if on { ON } else { DIM }));
                name_x = c.x + 12.0;
            }
            painter.text(pos2(name_x, r.top() + 15.0), Align2::LEFT_CENTER, card.name.to_uppercase(), FontId::proportional(12.0), TEXT);

            // The picture.
            let pic = Rect::from_min_size(pos2(r.left() + PAD, r.top() + HEAD + 2.0), vec2(w - PAD * 2.0, PIC));
            painter.rect_filled(pic, 2.0, BLACK);
            let lvl = card.module.map(|i| if on { (shared.peaks[i].load(Ordering::Relaxed) * 2.0).min(1.0) } else { 0.0 }).unwrap_or(0.0);
            let clip = painter.with_clip_rect(pic);
            let faded = if on { clip } else { faded_painter(&clip) };
            let g = pictures::Ctx { p: &faded, r: pic, s: &settings, lvl, t: now as f32, steps };
            pictures::draw(&g, card.module, &mut st.anim);

            // The dials.
            let mut y = pic.bottom() + 6.0 + GAP;
            for (ri, row) in card.rows.iter().enumerate() {
                if ri > 0 {
                    painter.line_segment([pos2(r.left() + PAD, y - GAP / 2.0), pos2(r.right() - PAD, y - GAP / 2.0)], stroke(1.0, Color32::from_gray(0x33)));
                }
                for (ci, cell) in row.iter().enumerate() {
                    let cr = Rect::from_min_size(pos2(r.left() + PAD + ci as f32 * COL, y), vec2(COL, ROW));
                    match *cell {
                        Cell::Dial(p, label) => dial_cell(ui, &painter, setter, cr, p, label, card.name),
                        Cell::Check(p, label) => check_cell(ui, &painter, setter, cr, p, label, card.name),
                    }
                }
                y += ROW + GAP;
            }
            x += w + PAD;
        }
    });
}

/// Pictures of a module that's switched off are drawn at a third strength.
fn faded_painter(p: &egui::Painter) -> egui::Painter {
    let mut p = p.clone();
    p.set_opacity(0.35);
    p
}

fn label_and_value(painter: &egui::Painter, r: Rect, label: &str, value: Option<String>) {
    painter.text(pos2(r.center().x, r.top() + 6.0), Align2::CENTER_CENTER, label, FontId::proportional(11.0), DIM);
    if let Some(v) = value {
        painter.text(pos2(r.center().x, r.top() + 50.0), Align2::CENTER_CENTER, v, FontId::proportional(11.0), TEXT);
    }
}

fn arc(c: egui::Pos2, rad: f32, from: f32, to: f32) -> Vec<egui::Pos2> {
    let a0 = (-135.0 + 270.0 * from) * PI / 180.0;
    let a1 = (-135.0 + 270.0 * to) * PI / 180.0;
    let n = ((a1 - a0).abs() * 12.0).ceil().max(2.0) as usize;
    (0..=n)
        .map(|i| {
            let a = a0 + (a1 - a0) * i as f32 / n as f32;
            c + vec2(a.sin(), -a.cos()) * rad
        })
        .collect()
}

fn dial_cell(ui: &mut egui::Ui, painter: &egui::Painter, setter: &ParamSetter, r: Rect, p: ParamPtr, label: &str, card: &str) {
    let id = Id::new(("dial", card, label));
    let resp = ui.interact(r, id, Sense::click_and_drag());
    let norm = unsafe { p.modulated_normalized_value() };
    if resp.drag_started() {
        unsafe { setter.raw_context.raw_begin_set_parameter(p) };
        ui.data_mut(|d| d.insert_temp(id, unsafe { p.unmodulated_normalized_value() }));
    }
    if resp.dragged() {
        let fine = ui.input(|i| i.modifiers.shift);
        let dy = resp.drag_delta().y;
        let held: f32 = ui.data(|d| d.get_temp(id)).unwrap_or(norm);
        let next = (held - dy / if fine { 1500.0 } else { 150.0 }).clamp(0.0, 1.0);
        ui.data_mut(|d| d.insert_temp(id, next));
        set(setter, p, next);
    }
    if resp.drag_stopped() {
        unsafe { setter.raw_context.raw_end_set_parameter(p) };
    }
    if resp.double_clicked() {
        unsafe {
            setter.raw_context.raw_begin_set_parameter(p);
            setter.raw_context.raw_set_parameter_normalized(p, p.default_normalized_value());
            setter.raw_context.raw_end_set_parameter(p);
        }
    }
    if resp.hovered() {
        let scroll = ui.input(|i| i.smooth_scroll_delta.y);
        if scroll != 0.0 {
            let step = match unsafe { p.step_count() } {
                Some(n) => (scroll.signum()) / n as f32,
                None => scroll / 600.0,
            };
            unsafe {
                setter.raw_context.raw_begin_set_parameter(p);
                setter.raw_context.raw_set_parameter_normalized(p, (norm + step).clamp(0.0, 1.0));
                setter.raw_context.raw_end_set_parameter(p);
            }
        }
        ui.ctx().set_cursor_icon(egui::CursorIcon::ResizeVertical);
    }

    let value = unsafe { p.normalized_value_to_string(norm, true) };
    label_and_value(painter, r, label, Some(value));
    let c = pos2(r.center().x, r.top() + 29.0);
    painter.add(egui::Shape::line(arc(c, 11.0, 0.0, 1.0), stroke(2.5, Color32::from_gray(0x55))));
    let x = norm.clamp(0.0, 1.0);
    if x > 0.002 {
        painter.add(egui::Shape::line(arc(c, 11.0, 0.0, x), stroke(2.5, TEXT)));
    }
    let a = (-135.0 + 270.0 * x) * PI / 180.0;
    let d = vec2(a.sin(), -a.cos());
    painter.line_segment([c + d * 4.0, c + d * 11.0], stroke(1.5, TEXT));
}

fn check_cell(ui: &mut egui::Ui, painter: &egui::Painter, setter: &ParamSetter, r: Rect, p: ParamPtr, label: &str, card: &str) {
    let on = unsafe { p.modulated_normalized_value() } > 0.5;
    let b = Rect::from_center_size(pos2(r.center().x, r.top() + 29.0), vec2(14.0, 14.0));
    let resp = ui.interact(b.expand(6.0), Id::new(("check", card, label)), Sense::click());
    if resp.clicked() {
        unsafe { setter.raw_context.raw_begin_set_parameter(p) };
        set(setter, p, if on { 0.0 } else { 1.0 });
        unsafe { setter.raw_context.raw_end_set_parameter(p) };
    }
    label_and_value(painter, r, label, None);
    if on {
        painter.rect_filled(b, 2.0, ON);
        let tick = vec![b.min + vec2(3.5, 7.0), b.min + vec2(6.0, 9.5), b.min + vec2(10.5, 4.5)];
        painter.add(egui::Shape::line(tick, stroke(2.0, Color32::from_gray(0x11))));
    } else {
        painter.rect_filled(b, 2.0, Color32::from_gray(0x1a));
        painter.rect_stroke(b, 2.0, stroke(1.0, DIM), StrokeKind::Inside);
    }
}
