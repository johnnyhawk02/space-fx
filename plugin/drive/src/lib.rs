//! Space Drive as a VST3 and CLAP plugin: the browser page's distortion (four antialiased Types),
//! sequenced filter and step sequencer with slew, with the same controls and a black-and-white
//! editor in Space FX's style.

use nih_plug::prelude::*;
use std::sync::atomic::{AtomicI32, Ordering};
use std::sync::Arc;

pub mod dsp;
mod editor;
pub mod params;
mod pictures;

use dsp::engine::{Engine, LATENCY};
use params::SpaceDriveParams;

/// What the audio thread tells the editor.
pub struct Shared {
    pub level: AtomicF32,
    pub cutoff: AtomicF32,
    pub pos: AtomicF32,
    pub seq_out: AtomicF32,
    pub step: AtomicI32,
    pub tempo: AtomicF32,
}

impl Default for Shared {
    fn default() -> Self {
        Self {
            level: AtomicF32::new(0.0),
            cutoff: AtomicF32::new(600.0),
            pos: AtomicF32::new(0.0),
            seq_out: AtomicF32::new(0.0),
            step: AtomicI32::new(-1),
            tempo: AtomicF32::new(120.0),
        }
    }
}

pub struct SpaceDrive {
    params: Arc<SpaceDriveParams>,
    shared: Arc<Shared>,
    engine: Engine,
}

impl Default for SpaceDrive {
    fn default() -> Self {
        Self { params: Arc::new(SpaceDriveParams::default()), shared: Arc::new(Shared::default()), engine: Engine::new(44100.0) }
    }
}

impl Plugin for SpaceDrive {
    const NAME: &'static str = "Space Drive";
    const VENDOR: &'static str = "Johnny Hawk";
    const URL: &'static str = "https://github.com/johnnyhawk02/space-fx";
    const EMAIL: &'static str = "";
    const VERSION: &'static str = env!("CARGO_PKG_VERSION");

    const AUDIO_IO_LAYOUTS: &'static [AudioIOLayout] = &[AudioIOLayout {
        main_input_channels: NonZeroU32::new(2),
        main_output_channels: NonZeroU32::new(2),
        ..AudioIOLayout::const_default()
    }];

    type SysExMessage = ();
    type BackgroundTask = ();

    fn params(&self) -> Arc<dyn Params> {
        self.params.clone()
    }

    fn editor(&mut self, _async_executor: AsyncExecutor<Self>) -> Option<Box<dyn Editor>> {
        editor::create(self.params.clone(), self.shared.clone())
    }

    fn initialize(&mut self, _layout: &AudioIOLayout, config: &BufferConfig, context: &mut impl InitContext<Self>) -> bool {
        self.engine = Engine::new(config.sample_rate as f64);
        context.set_latency_samples(LATENCY as u32);
        true
    }

    fn reset(&mut self) {
        self.engine.reset();
    }

    fn process(&mut self, buffer: &mut Buffer, _aux: &mut AuxiliaryBuffers, context: &mut impl ProcessContext<Self>) -> ProcessStatus {
        let transport = context.transport();
        let tempo = transport.tempo.unwrap_or(120.0);
        // Locked to the host's bar while it plays; free-running while it's stopped.
        let song = if transport.playing { transport.pos_beats() } else { None };
        let settings = self.params.settings(tempo);
        if let [l, r] = buffer.as_slice() {
            self.engine.process(l, r, &settings, song);
        }
        if self.params.editor_state.is_open() {
            let e = &self.engine;
            let sh = &self.shared;
            sh.level.store(e.level, Ordering::Relaxed);
            sh.cutoff.store(e.filter.fc as f32, Ordering::Relaxed);
            sh.pos.store(e.seq.pos as f32, Ordering::Relaxed);
            sh.seq_out.store(e.seq.out as f32, Ordering::Relaxed);
            sh.step.store(e.seq.current(&settings.seq) as i32, Ordering::Relaxed);
            sh.tempo.store(tempo as f32, Ordering::Relaxed);
        }
        ProcessStatus::Normal
    }
}

impl ClapPlugin for SpaceDrive {
    const CLAP_ID: &'static str = "com.johnnyhawk02.space-drive";
    const CLAP_DESCRIPTION: Option<&'static str> = Some("Antialiased distortion into a sequenced filter");
    const CLAP_MANUAL_URL: Option<&'static str> = Some(Self::URL);
    const CLAP_SUPPORT_URL: Option<&'static str> = None;
    const CLAP_FEATURES: &'static [ClapFeature] = &[ClapFeature::AudioEffect, ClapFeature::Stereo, ClapFeature::Distortion, ClapFeature::Filter];
}

impl Vst3Plugin for SpaceDrive {
    const VST3_CLASS_ID: [u8; 16] = *b"SpaceDriveJHawk2";
    const VST3_SUBCATEGORIES: &'static [Vst3SubCategory] = &[Vst3SubCategory::Fx, Vst3SubCategory::Distortion, Vst3SubCategory::Filter];
}

nih_export_clap!(SpaceDrive);
nih_export_vst3!(SpaceDrive);
