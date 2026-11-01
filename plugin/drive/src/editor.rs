//! The editor: three cards in a row (Drive, Filter, Sequencer), each with its live picture on top
//! and its dials below on one shared grid, black and white, as Space FX's editor and the browser
//! page (drive/index.html). Draw the steps in the Sequencer's picture.

use crate::params::{SpaceDriveParams, HEIGHT, WIDTH};
use crate::pictures::{self, stroke, BLACK};
use crate::Shared;
use nih_plug::prelude::*;
use nih_plug_egui::egui::{self, pos2, vec2, Align2, Color32, FontId, Id, Rect, Sense, StrokeKind};
use nih_plug_egui::{create_egui_editor, egui::Frame};
use std::f32::consts::PI;
use std::sync::atomic::Ordering;
use std::sync::Arc;

const COL: f32 = 56.0;
const ROW: f32 = 60.0;
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

#[derive(Clone, Copy, PartialEq)]
pub enum Which {
    Drive,
    Filter,
    Seq,
}

#[derive(Clone, Copy)]
enum Cell {
    /// A dial; `true` for one whose arc starts in the middle (-100..100 %).
    Dial(ParamPtr, &'static str, bool),
    Check(ParamPtr, &'static str),
}

struct Card {
    name: &'static str,
    which: Which,
    on: ParamPtr,
    min_w: f32,
    rows: Vec<Vec<Cell>>,
}

fn dial<P: Param>(p: &P, label: &'static str) -> Cell {
    Cell::Dial(p.as_ptr(), label, false)
}

fn check<P: Param>(p: &P, label: &'static str) -> Cell {
    Cell::Check(p.as_ptr(), label)
}

fn cards(p: &SpaceDriveParams) -> Vec<Card> {
    let (d, f, s) = (&p.drive, &p.filter, &p.seq);
    vec![
        Card {
            name: "Drive",
            which: Which::Drive,
            on: d.on.as_ptr(),
            min_w: 0.0,
            rows: vec![
                vec![dial(&d.kind, "Type"), dial(&d.amount, "Drive"), dial(&d.bias, "Bias")],
                vec![dial(&d.tone, "Tone"), dial(&d.output, "Output"), dial(&d.mix, "Dry/Wet")],
            ],
        },
        Card {
            name: "Filter",
            which: Which::Filter,
            on: f.on.as_ptr(),
            min_w: 0.0,
            rows: vec![
                vec![dial(&f.mode, "Mode"), dial(&f.cutoff, "Cutoff"), dial(&f.res, "Res")],
                vec![Cell::Dial(f.env.as_ptr(), "Env", true), Cell::Dial(f.seq.as_ptr(), "Seq", true), check(&f.pre, "Pre")],
            ],
        },
        Card {
            name: "Sequencer",
            which: Which::Seq,
            on: s.on.as_ptr(),
            min_w: 340.0,
            rows: vec![
                vec![check(&s.sync, "Sync"), if s.sync.value() { dial(&s.rate, "Rate") } else { dial(&s.hz, "Rate") }, dial(&s.steps, "Steps")],
                vec![dial(&s.slew, "Slew"), dial(&s.swing, "Swing")],
            ],
        },
    ]
}

pub struct UiState {
    t0: Option<f64>,
}

pub fn create(params: Arc<SpaceDriveParams>, shared: Arc<Shared>) -> Option<Box<dyn Editor>> {
    create_egui_editor(params.editor_state.clone(), UiState { t0: None }, |_, _| {}, move |ctx, setter, st| {
        draw(ctx, setter, st, &params, &shared);
        ctx.request_repaint();
    })
}

fn set(setter: &ParamSetter, p: ParamPtr, norm: f32) {
    unsafe { setter.raw_context.raw_set_parameter_normalized(p, norm.clamp(0.0, 1.0)) };
}

fn draw(ctx: &egui::Context, setter: &ParamSetter, st: &mut UiState, params: &SpaceDriveParams, shared: &Shared) {
    let now = ctx.input(|i| i.time);
    let t = (now - *st.t0.get_or_insert(now)) as f32;
    let tempo = shared.tempo.load(Ordering::Relaxed) as f64;
    let settings = params.settings(if tempo > 0.0 { tempo } else { 120.0 });

    egui::CentralPanel::default().frame(Frame::NONE.fill(BG)).show(ctx, |ui| {
        let painter = ui.painter().clone();
        let origin = ui.max_rect().min;
        painter.rect_filled(Rect::from_min_size(origin, vec2(WIDTH as f32, HEIGHT as f32)), 4.0, RACK);
        let mut x = origin.x + PAD;
        let top = origin.y + PAD;
        let card_h = HEIGHT as f32 - PAD * 2.0;
        for card in cards(params) {
            let w = (3.0 * COL + PAD * 2.0).max(card.min_w);
            let r = Rect::from_min_size(pos2(x, top), vec2(w, card_h));
            painter.rect_filled(r, 3.0, CARD);
            painter.rect_stroke(r, 3.0, stroke(1.0, LINE), StrokeKind::Inside);

            // Header: the Device Activator and the name.
            let on = unsafe { card.on.modulated_normalized_value() } > 0.5;
            let c = pos2(r.left() + 16.0, r.top() + 15.0);
            let resp = ui.interact(Rect::from_center_size(c, vec2(18.0, 18.0)), Id::new(("on", card.name)), Sense::click());
            if resp.clicked() {
                unsafe { setter.raw_context.raw_begin_set_parameter(card.on) };
                set(setter, card.on, if on { 0.0 } else { 1.0 });
                unsafe { setter.raw_context.raw_end_set_parameter(card.on) };
            }
            painter.circle_filled(c, 6.0, if on { ON } else { OFF });
            painter.circle_stroke(c, 6.0, stroke(1.0, if on { ON } else { DIM }));
            painter.text(pos2(c.x + 12.0, r.top() + 15.0), Align2::LEFT_CENTER, card.name.to_uppercase(), FontId::proportional(12.0), TEXT);

            // The picture.
            let pic = Rect::from_min_size(pos2(r.left() + PAD, r.top() + HEAD + 2.0), vec2(w - PAD * 2.0, PIC));
            painter.rect_filled(pic, 2.0, BLACK);
            if card.which == Which::Seq {
                edit_steps(ui, setter, params, pic);
            }
            let clip = painter.with_clip_rect(pic);
            let mut faded = clip.clone();
            if !on {
                faded.set_opacity(0.35);
            }
            let g = pictures::Ctx { p: &faded, r: pic, s: &settings, shared, t, on };
            pictures::draw(&g, card.which);

            // The dials.
            let mut y = pic.bottom() + 6.0 + GAP;
            for (ri, row) in card.rows.iter().enumerate() {
                if ri > 0 {
                    painter.line_segment([pos2(r.left() + PAD, y - GAP / 2.0), pos2(r.right() - PAD, y - GAP / 2.0)], stroke(1.0, Color32::from_gray(0x33)));
                }
                for (ci, cell) in row.iter().enumerate() {
                    let cr = Rect::from_min_size(pos2(r.left() + PAD + ci as f32 * COL, y), vec2(COL, ROW));
                    match *cell {
                        Cell::Dial(p, label, bi) => dial_cell(ui, &painter, setter, cr, p, label, card.name, bi),
                        Cell::Check(p, label) => check_cell(ui, &painter, setter, cr, p, label, card.name),
                    }
                }
                y += ROW + GAP;
            }
            x += w + PAD;
        }
    });
}

/// Drag across the Sequencer's picture to draw the steps; double-click one to set it to 0.
fn edit_steps(ui: &mut egui::Ui, setter: &ParamSetter, params: &SpaceDriveParams, pic: Rect) {
    let resp = ui.interact(pic, Id::new("steps"), Sense::click_and_drag());
    if resp.hovered() {
        ui.ctx().set_cursor_icon(egui::CursorIcon::Crosshair);
    }
    let Some(at) = resp.interact_pointer_pos() else { return };
    if !(resp.dragged() || resp.clicked() || resp.drag_started() || resp.double_clicked()) {
        return;
    }
    if let Some((step, value)) = pictures::seq_hit(pic, at) {
        let p = &params.seq.values[step].value;
        let v = if resp.double_clicked() { 0.0 } else { value };
        setter.begin_set_parameter(p);
        setter.set_parameter(p, v);
        setter.end_set_parameter(p);
    }
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

#[allow(clippy::too_many_arguments)]
fn dial_cell(ui: &mut egui::Ui, painter: &egui::Painter, setter: &ParamSetter, r: Rect, p: ParamPtr, label: &str, card: &str, bipolar: bool) {
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
                Some(n) => scroll.signum() / n as f32,
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
    let zero = if bipolar { 0.5 } else { 0.0 };
    let (a, b) = if x < zero { (x, zero) } else { (zero, x) };
    if b - a > 0.002 {
        painter.add(egui::Shape::line(arc(c, 11.0, a, b), stroke(2.5, TEXT)));
    }
    let ang = (-135.0 + 270.0 * x) * PI / 180.0;
    let d = vec2(ang.sin(), -ang.cos());
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
