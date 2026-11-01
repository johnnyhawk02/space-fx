//! Every control, with the same ids, ranges, defaults and labels as the prototype's
//! dsp/params.js. Ids are stable: changing one breaks saved sessions.

use crate::dsp::delay::DelayParams;
use crate::dsp::filter::FilterParams;
use crate::dsp::phaser::PhaserParams;
use crate::dsp::rack::{Settings, N_MOD};
use crate::dsp::spring::SpringParams;
use crate::dsp::tape::TapeParams;
use nih_plug::prelude::*;
use nih_plug_egui::EguiState;
use std::sync::Arc;

pub const WIDTH: u32 = 1396;
pub const HEIGHT: u32 = 332;

#[derive(Enum, Debug, PartialEq, Eq, Clone, Copy)]
pub enum TapeSpeed {
    #[name = "3.75 ips"]
    S3,
    #[name = "7.5 ips"]
    S7,
    #[name = "15 ips"]
    S15,
    #[name = "30 ips"]
    S30,
}

impl TapeSpeed {
    pub fn ips(self) -> f64 {
        match self {
            Self::S3 => 3.75,
            Self::S7 => 7.5,
            Self::S15 => 15.0,
            Self::S30 => 30.0,
        }
    }
}

#[derive(Enum, Debug, PartialEq, Eq, Clone, Copy)]
pub enum LfoShape {
    Sine,
    Triangle,
    Square,
    Saw,
    Random,
    #[name = "Smooth Random"]
    SmoothRandom,
    Drunk,
    #[name = "Saw Down"]
    SawDown,
}

#[derive(Enum, Debug, PartialEq, Eq, Clone, Copy)]
pub enum FilterMode {
    #[name = "LP"]
    Lp,
    #[name = "BP"]
    Bp,
}

/// Delay Time when synced, in beats.
#[derive(Enum, Debug, PartialEq, Eq, Clone, Copy)]
pub enum NoteTime {
    #[name = "1/16"]
    N16,
    #[name = "1/8"]
    N8,
    #[name = "3/16"]
    N3_16,
    #[name = "1/4"]
    N4,
    #[name = "3/8"]
    N3_8,
    #[name = "1/2"]
    N2,
    #[name = "3/4"]
    N3_4,
    #[name = "1 Bar"]
    Bar,
}

impl NoteTime {
    pub fn beats(self) -> f64 {
        [0.25, 0.5, 0.75, 1.0, 1.5, 2.0, 3.0, 4.0][self as usize]
    }
}

/// Phaser Rate when synced: one sweep every so many beats.
#[derive(Enum, Debug, PartialEq, Eq, Clone, Copy)]
pub enum SweepTime {
    #[name = "8 Bars"]
    B8,
    #[name = "4 Bars"]
    B4,
    #[name = "2 Bars"]
    B2,
    #[name = "1 Bar"]
    B1,
    #[name = "1/2"]
    N2,
    #[name = "1/4"]
    N4,
    #[name = "1/8"]
    N8,
    #[name = "1/16"]
    N16,
}

impl SweepTime {
    pub fn beats(self) -> f64 {
        [32.0, 16.0, 8.0, 4.0, 2.0, 1.0, 0.5, 0.25][self as usize]
    }
}

#[derive(Enum, Debug, PartialEq, Eq, Clone, Copy)]
pub enum RouteMode {
    Series,
    Reverse,
    Parallel,
    #[name = "Echo + Verb"]
    EchoVerb,
}

fn pct(name: &str, def: f32) -> FloatParam {
    pct_max(name, def, 1.0)
}

fn pct_max(name: &str, def: f32, max: f32) -> FloatParam {
    FloatParam::new(name, def, FloatRange::Linear { min: 0.0, max })
        .with_unit(" %")
        .with_value_to_string(formatters::v2s_f32_percentage(0))
        .with_string_to_value(formatters::s2v_f32_percentage())
}

/// A range that feels logarithmic: the geometric middle sits at the dial's middle, as the
/// prototype's 'log' dials do.
fn log_range(min: f32, max: f32) -> FloatRange {
    let mid = (min * max).sqrt();
    let factor = 0.5f32.ln() / ((mid - min) / (max - min)).ln();
    FloatRange::Skewed { min, max, factor }
}

fn hz(name: &str, def: f32, min: f32, max: f32, digits: usize) -> FloatParam {
    FloatParam::new(name, def, log_range(min, max))
        .with_value_to_string(Arc::new(move |v| {
            if v >= 1000.0 {
                format!("{:.2} kHz", v / 1000.0)
            } else {
                format!("{v:.digits$} Hz")
            }
        }))
        .with_string_to_value(formatters::s2v_f32_hz_then_khz())
}

fn plain(name: &str, def: f32, range: FloatRange, unit: &'static str, digits: usize) -> FloatParam {
    FloatParam::new(name, def, range)
        .with_value_to_string(Arc::new(move |v| format!("{v:.digits$}{unit}")))
        .with_string_to_value(Arc::new(|s| s.trim().trim_end_matches(|c: char| !c.is_ascii_digit() && c != '.').trim().parse().ok()))
}

#[derive(Params)]
pub struct TapeControls {
    #[id = "tape_on"]
    pub on: BoolParam,
    #[id = "tape_drive"]
    pub drive: FloatParam,
    #[id = "tape_bias"]
    pub bias: FloatParam,
    #[id = "tape_speed"]
    pub speed: EnumParam<TapeSpeed>,
    #[id = "tape_spacing"]
    pub spacing: FloatParam,
    #[id = "tape_mix"]
    pub mix: FloatParam,
    #[id = "tape_wow"]
    pub wow: FloatParam,
    #[id = "tape_lfo_shape"]
    pub lfo_shape: EnumParam<LfoShape>,
    #[id = "tape_lfo_rate"]
    pub lfo_rate: FloatParam,
    #[id = "tape_lfo_slow"]
    pub lfo_slow: BoolParam,
    #[id = "tape_lfo_depth"]
    pub lfo_depth: FloatParam,
    #[id = "tape_lfo_slew"]
    pub lfo_slew: FloatParam,
}

impl Default for TapeControls {
    fn default() -> Self {
        Self {
            on: BoolParam::new("Tape On", true),
            drive: pct("Tape Drive", 0.5),
            bias: pct("Tape Bias", 0.9),
            speed: EnumParam::new("Tape Speed", TapeSpeed::S15),
            spacing: plain("Tape Spacing", 5.0, FloatRange::Linear { min: 0.0, max: 30.0 }, " um", 0),
            mix: pct("Tape Dry/Wet", 0.5),
            wow: pct("Tape Wow", 0.3),
            lfo_shape: EnumParam::new("Tape LFO Shape", LfoShape::Sine),
            lfo_rate: hz("Tape LFO Rate", 0.5, 0.01, 20.0, 2),
            lfo_slow: BoolParam::new("Tape LFO x0.01", false),
            lfo_depth: plain("Tape LFO Depth", 0.0, FloatRange::Linear { min: 0.0, max: 50.0 }, " ms", 1),
            lfo_slew: pct("Tape LFO Slew", 0.0),
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
    pub resonance: FloatParam,
    #[id = "filter_drive"]
    pub drive: FloatParam,
    #[id = "filter_env"]
    pub env: FloatParam,
    #[id = "filter_mix"]
    pub mix: FloatParam,
}

impl Default for FilterControls {
    fn default() -> Self {
        Self {
            on: BoolParam::new("Filter On", true),
            mode: EnumParam::new("Filter Mode", FilterMode::Lp),
            cutoff: hz("Filter Cutoff", 1500.0, 30.0, 12000.0, 0),
            resonance: pct("Filter Res", 0.5),
            drive: pct("Filter Drive", 0.3),
            env: pct("Filter Env", 0.0),
            mix: pct("Filter Dry/Wet", 0.5),
        }
    }
}

#[derive(Params)]
pub struct DelayControls {
    #[id = "delay_on"]
    pub on: BoolParam,
    #[id = "delay_sync"]
    pub sync: BoolParam,
    #[id = "delay_beats"]
    pub beats: EnumParam<NoteTime>,
    #[id = "delay_ms"]
    pub time_ms: FloatParam,
    #[id = "delay_mix"]
    pub mix: FloatParam,
}

impl Default for DelayControls {
    fn default() -> Self {
        Self {
            on: BoolParam::new("Delay On", true),
            sync: BoolParam::new("Delay Sync", true),
            beats: EnumParam::new("Delay Time", NoteTime::N3_16),
            time_ms: plain("Delay Time ms", 375.0, log_range(10.0, 2000.0), " ms", 0),
            mix: pct("Delay Dry/Wet", 0.5),
        }
    }
}

#[derive(Params)]
pub struct PhaserControls {
    #[id = "phaser_on"]
    pub on: BoolParam,
    #[id = "phaser_sync"]
    pub sync: BoolParam,
    #[id = "phaser_rate"]
    pub speed: FloatParam,
    #[id = "phaser_rate_sync"]
    pub rate_beats: EnumParam<SweepTime>,
    #[id = "phaser_depth"]
    pub depth: FloatParam,
    #[id = "phaser_center"]
    pub center: FloatParam,
    #[id = "phaser_feedback"]
    pub feedback: FloatParam,
    #[id = "phaser_spread"]
    pub spread: FloatParam,
    #[id = "phaser_mix"]
    pub mix: FloatParam,
}

impl Default for PhaserControls {
    fn default() -> Self {
        Self {
            on: BoolParam::new("Phaser On", true),
            sync: BoolParam::new("Phaser Sync", false),
            speed: hz("Phaser Rate", 0.5, 0.05, 10.0, 2),
            rate_beats: EnumParam::new("Phaser Rate Sync", SweepTime::B2),
            depth: pct("Phaser Depth", 0.6),
            center: hz("Phaser Center", 1663.0, 200.0, 4500.0, 0),
            feedback: pct_max("Phaser Feedback", 0.0, 0.9),
            spread: plain("Phaser Spread", 0.0, FloatRange::Linear { min: 0.0, max: 180.0 }, " °", 0),
            mix: pct("Phaser Dry/Wet", 0.5),
        }
    }
}

#[derive(Params)]
pub struct SpringControls {
    #[id = "spring_on"]
    pub on: BoolParam,
    #[id = "spring_length"]
    pub length: FloatParam,
    #[id = "spring_decay"]
    pub decay: FloatParam,
    #[id = "spring_tone"]
    pub tone: FloatParam,
    #[id = "spring_chirp"]
    pub chirp: FloatParam,
    #[id = "spring_mix"]
    pub mix: FloatParam,
}

impl Default for SpringControls {
    fn default() -> Self {
        Self {
            on: BoolParam::new("Spring On", true),
            length: plain("Spring Length", 56.0, FloatRange::Linear { min: 20.0, max: 120.0 }, " ms", 0),
            decay: pct("Spring Decay", 0.7),
            tone: hz("Spring Tone", 4300.0, 1500.0, 7000.0, 0),
            chirp: pct("Spring Chirp", 0.6),
            mix: pct("Spring Dry/Wet", 0.5),
        }
    }
}

#[derive(Params)]
pub struct MainControls {
    #[id = "mode"]
    pub mode: EnumParam<RouteMode>,
    #[id = "feedback"]
    pub feedback: FloatParam,
    #[id = "dry_wet"]
    pub dry_wet: FloatParam,
    #[id = "volume"]
    pub volume: FloatParam,
}

impl Default for MainControls {
    fn default() -> Self {
        Self {
            mode: EnumParam::new("Mode", RouteMode::Series),
            feedback: pct("Feedback", 0.0),
            dry_wet: pct("Dry/Wet", 1.0),
            volume: FloatParam::new("Volume", 0.0, FloatRange::Linear { min: -60.0, max: 6.0 })
                .with_value_to_string(Arc::new(|v| if v <= -60.0 { "-inf dB".into() } else { format!("{v:.1} dB") }))
                .with_string_to_value(Arc::new(|s| s.trim().trim_end_matches("dB").trim().parse().ok())),
        }
    }
}

#[derive(Params)]
pub struct SpaceFxParams {
    #[persist = "editor-state"]
    pub editor_state: Arc<EguiState>,
    #[nested(group = "Tape")]
    pub tape: TapeControls,
    #[nested(group = "Filter")]
    pub filter: FilterControls,
    #[nested(group = "Delay")]
    pub delay: DelayControls,
    #[nested(group = "Phaser")]
    pub phaser: PhaserControls,
    #[nested(group = "Spring")]
    pub spring: SpringControls,
    #[nested(group = "Routing")]
    pub main: MainControls,
}

impl Default for SpaceFxParams {
    fn default() -> Self {
        Self {
            editor_state: EguiState::from_size(WIDTH, HEIGHT),
            tape: Default::default(),
            filter: Default::default(),
            delay: Default::default(),
            phaser: Default::default(),
            spring: Default::default(),
            main: Default::default(),
        }
    }
}

impl SpaceFxParams {
    /// Every control's current value, for the rack.
    pub fn settings(&self, tempo: f64) -> Settings {
        let (t, fl, d, ph, sp, m) = (&self.tape, &self.filter, &self.delay, &self.phaser, &self.spring, &self.main);
        let f = |p: &FloatParam| p.value() as f64;
        let mut on = [true; N_MOD];
        on.copy_from_slice(&[t.on.value(), fl.on.value(), d.on.value(), sp.on.value(), ph.on.value()]);
        Settings {
            tempo,
            on,
            tape: TapeParams {
                drive: f(&t.drive),
                bias: f(&t.bias),
                speed: t.speed.value().ips(),
                spacing: f(&t.spacing),
                mix: f(&t.mix),
                wow: f(&t.wow),
                lfo_shape: t.lfo_shape.value() as usize,
                lfo_rate: f(&t.lfo_rate),
                lfo_slow: t.lfo_slow.value(),
                lfo_depth: f(&t.lfo_depth),
                lfo_slew: f(&t.lfo_slew),
            },
            filter: FilterParams {
                mode: fl.mode.value() as usize,
                cutoff: f(&fl.cutoff),
                resonance: f(&fl.resonance),
                drive: f(&fl.drive),
                env: f(&fl.env),
                mix: f(&fl.mix),
            },
            delay: DelayParams { sync: d.sync.value(), beats: d.beats.value().beats(), time_ms: f(&d.time_ms), mix: f(&d.mix) },
            phaser: PhaserParams {
                sync: ph.sync.value(),
                speed: f(&ph.speed),
                rate_beats: ph.rate_beats.value().beats(),
                depth: f(&ph.depth),
                center: f(&ph.center),
                feedback: f(&ph.feedback),
                spread: f(&ph.spread),
                mix: f(&ph.mix),
            },
            spring: SpringParams { length: f(&sp.length), decay: f(&sp.decay), tone: f(&sp.tone), chirp: f(&sp.chirp), mix: f(&sp.mix) },
            mode: m.mode.value() as usize,
            feedback: f(&m.feedback),
            dry_wet: f(&m.dry_wet),
            volume_db: f(&m.volume),
        }
    }
}
