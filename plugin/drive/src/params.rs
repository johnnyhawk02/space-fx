//! Every control, with the same ranges, defaults and labels as the browser page's
//! drive/dsp/params.js. Ids are stable: changing one breaks saved sessions.

use crate::dsp::autofilter::FilterParams;
use crate::dsp::engine::Settings;
use crate::dsp::sequencer::{SeqParams, RATES, STEPS, STEP_DEFAULTS};
use crate::dsp::shaper::DriveParams;
use nih_plug::prelude::*;
use nih_plug_egui::EguiState;
use std::sync::Arc;

pub const WIDTH: u32 = 740;
pub const HEIGHT: u32 = 332;

#[derive(Enum, Debug, PartialEq, Eq, Clone, Copy)]
pub enum DriveType {
    Soft,
    Diode,
    Fuzz,
    Fold,
}

#[derive(Enum, Debug, PartialEq, Eq, Clone, Copy)]
pub enum FilterMode {
    #[name = "LP"]
    Lp,
    #[name = "BP"]
    Bp,
    #[name = "HP"]
    Hp,
}

/// Sequencer Rate when synced, a note value per step.
#[derive(Enum, Debug, PartialEq, Eq, Clone, Copy)]
pub enum SeqRate {
    #[name = "1/32"]
    N32,
    #[name = "1/16T"]
    N16T,
    #[name = "1/16"]
    N16,
    #[name = "1/8T"]
    N8T,
    #[name = "1/8"]
    N8,
    #[name = "1/4"]
    N4,
    #[name = "1/2"]
    N2,
    #[name = "1 Bar"]
    Bar,
}

fn pct(name: &str, def: f32, min: f32) -> FloatParam {
    FloatParam::new(name, def, FloatRange::Linear { min, max: 1.0 })
        .with_unit(" %")
        .with_value_to_string(formatters::v2s_f32_percentage(0))
        .with_string_to_value(formatters::s2v_f32_percentage())
}

fn log_range(min: f32, max: f32) -> FloatRange {
    let mid = (min * max).sqrt();
    let factor = 0.5f32.ln() / ((mid - min) / (max - min)).ln();
    FloatRange::Skewed { min, max, factor }
}

fn hz(name: &str, def: f32, min: f32, max: f32, digits: usize) -> FloatParam {
    FloatParam::new(name, def, log_range(min, max))
        .with_value_to_string(Arc::new(move |v| if v >= 1000.0 { format!("{:.2} kHz", v / 1000.0) } else { format!("{v:.digits$} Hz") }))
        .with_string_to_value(formatters::s2v_f32_hz_then_khz())
}

#[derive(Params)]
pub struct DriveControls {
    #[id = "drive_on"]
    pub on: BoolParam,
    #[id = "drive_type"]
    pub kind: EnumParam<DriveType>,
    #[id = "drive_amount"]
    pub amount: FloatParam,
    #[id = "drive_bias"]
    pub bias: FloatParam,
    #[id = "drive_tone"]
    pub tone: FloatParam,
    #[id = "drive_output"]
    pub output: FloatParam,
    #[id = "drive_mix"]
    pub mix: FloatParam,
}

impl Default for DriveControls {
    fn default() -> Self {
        Self {
            on: BoolParam::new("Drive On", true),
            kind: EnumParam::new("Drive Type", DriveType::Soft),
            amount: pct("Drive", 0.5, 0.0),
            bias: pct("Drive Bias", 0.0, 0.0),
            tone: pct("Drive Tone", 0.5, 0.0),
            output: FloatParam::new("Drive Output", 0.0, FloatRange::Linear { min: -24.0, max: 12.0 })
                .with_value_to_string(Arc::new(|v| format!("{v:.1} dB")))
                .with_string_to_value(Arc::new(|s| s.trim().trim_end_matches("dB").trim().parse().ok())),
            mix: pct("Drive Dry/Wet", 1.0, 0.0),
        }
    }
}

#[derive(Params)]
pub struct FilterControls {
    #[id = "filter_on"]
    pub on: BoolParam,
    #[id = "filter_mode"]
    pub mode: EnumParam<FilterMode>,
    #[id = "filter_cutoff"]
    pub cutoff: FloatParam,
    #[id = "filter_res"]
    pub res: FloatParam,
    #[id = "filter_env"]
    pub env: FloatParam,
    #[id = "filter_seq"]
    pub seq: FloatParam,
    #[id = "filter_pre"]
    pub pre: BoolParam,
}

impl Default for FilterControls {
    fn default() -> Self {
        Self {
            on: BoolParam::new("Filter On", true),
            mode: EnumParam::new("Filter Mode", FilterMode::Lp),
            cutoff: hz("Filter Cutoff", 600.0, 40.0, 16000.0, 0),
            res: pct("Filter Res", 0.5, 0.0),
            env: pct("Filter Env", 0.0, -1.0),
            seq: pct("Filter Seq", 0.5, -1.0),
            pre: BoolParam::new("Filter Pre", false),
        }
    }
}

/// One step's level.
#[derive(Params)]
pub struct Step {
    #[id = "seq_step"]
    pub value: FloatParam,
}

#[derive(Params)]
pub struct SeqControls {
    #[id = "seq_on"]
    pub on: BoolParam,
    #[id = "seq_sync"]
    pub sync: BoolParam,
    #[id = "seq_rate"]
    pub rate: EnumParam<SeqRate>,
    #[id = "seq_hz"]
    pub hz: FloatParam,
    #[id = "seq_steps"]
    pub steps: IntParam,
    #[id = "seq_slew"]
    pub slew: FloatParam,
    #[id = "seq_swing"]
    pub swing: FloatParam,
    /// Ids seq_step_1 .. seq_step_16.
    #[nested(array, group = "Steps")]
    pub values: [Step; STEPS],
}

impl Default for SeqControls {
    fn default() -> Self {
        Self {
            on: BoolParam::new("Sequencer On", true),
            sync: BoolParam::new("Sequencer Sync", true),
            rate: EnumParam::new("Sequencer Rate", SeqRate::N16),
            hz: hz("Sequencer Rate Hz", 8.0, 0.5, 30.0, 2),
            steps: IntParam::new("Sequencer Steps", 16, IntRange::Linear { min: 1, max: STEPS as i32 }),
            slew: pct("Sequencer Slew", 0.3, 0.0),
            swing: pct("Sequencer Swing", 0.0, 0.0),
            values: std::array::from_fn(|i| Step { value: pct(&format!("Step {}", i + 1), STEP_DEFAULTS[i] as f32, 0.0) }),
        }
    }
}

#[derive(Params)]
pub struct SpaceDriveParams {
    #[persist = "editor-state"]
    pub editor_state: Arc<EguiState>,
    #[nested(group = "Drive")]
    pub drive: DriveControls,
    #[nested(group = "Filter")]
    pub filter: FilterControls,
    #[nested(group = "Sequencer")]
    pub seq: SeqControls,
}

impl Default for SpaceDriveParams {
    fn default() -> Self {
        Self { editor_state: EguiState::from_size(WIDTH, HEIGHT), drive: Default::default(), filter: Default::default(), seq: Default::default() }
    }
}

impl SpaceDriveParams {
    pub fn settings(&self, tempo: f64) -> Settings {
        let (d, fl, s) = (&self.drive, &self.filter, &self.seq);
        let f = |p: &FloatParam| p.value() as f64;
        Settings {
            tempo,
            drive_on: d.on.value(),
            filter_on: fl.on.value(),
            seq_on: s.on.value(),
            drive: DriveParams { kind: d.kind.value() as usize, amount: f(&d.amount), bias: f(&d.bias), tone: f(&d.tone), output: f(&d.output), mix: f(&d.mix) },
            filter: FilterParams { mode: fl.mode.value() as usize, cutoff: f(&fl.cutoff), res: f(&fl.res), env: f(&fl.env), seq: f(&fl.seq), pre: fl.pre.value() },
            seq: SeqParams {
                sync: s.sync.value(),
                rate: RATES[s.rate.value() as usize].1,
                hz: f(&s.hz),
                steps: s.steps.value() as usize,
                slew: f(&s.slew),
                swing: f(&s.swing),
                values: std::array::from_fn(|i| f(&s.values[i].value)),
            },
        }
    }
}
