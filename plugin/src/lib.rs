//! Space FX as a VST3 and CLAP plugin: the rack from the browser prototype (Tape, Filter, Delay,
//! Phaser, Spring and Routing), with the same controls and a black-and-white editor.

use nih_plug::prelude::*;
use std::sync::atomic::Ordering;
use std::sync::Arc;

pub mod dsp;
mod editor;
mod pictures;
pub mod params;

use dsp::rack::{Rack, N_MOD};
use params::SpaceFxParams;

/// What the audio thread tells the editor: each module's level and the host's tempo.
pub struct Shared {
    pub peaks: [AtomicF32; N_MOD],
    pub tempo: AtomicF32,
}

impl Default for Shared {
    fn default() -> Self {
        Self { peaks: Default::default(), tempo: AtomicF32::new(120.0) }
    }
}

pub struct SpaceFx {
    params: Arc<SpaceFxParams>,
    shared: Arc<Shared>,
    rack: Rack,
}

impl Default for SpaceFx {
    fn default() -> Self {
        Self { params: Arc::new(SpaceFxParams::default()), shared: Arc::new(Shared::default()), rack: Rack::new(44100.0) }
    }
}

impl Plugin for SpaceFx {
    const NAME: &'static str = "Space FX";
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
        self.rack = Rack::new(config.sample_rate as f64);
        context.set_latency_samples(Rack::latency());
        true
    }

    fn reset(&mut self) {
        self.rack.reset();
    }

    fn process(&mut self, buffer: &mut Buffer, _aux: &mut AuxiliaryBuffers, context: &mut impl ProcessContext<Self>) -> ProcessStatus {
        let tempo = context.transport().tempo.unwrap_or(120.0);
        let settings = self.params.settings(tempo);
        let channels = buffer.as_slice();
        if let [l, r] = channels {
            self.rack.process(l, r, &settings);
        }
        if self.params.editor_state.is_open() {
            for (shown, &p) in self.shared.peaks.iter().zip(self.rack.peaks.iter()) {
                shown.store(p, Ordering::Relaxed);
            }
            self.shared.tempo.store(tempo as f32, Ordering::Relaxed);
        }
        // The Delay, Spring and Feedback ring on after the input stops.
        ProcessStatus::KeepAlive
    }
}

impl ClapPlugin for SpaceFx {
    const CLAP_ID: &'static str = "com.johnnyhawk02.space-fx";
    const CLAP_DESCRIPTION: Option<&'static str> = Some("Tape, Filter, Delay, Phaser and Spring in one rack");
    const CLAP_MANUAL_URL: Option<&'static str> = Some(Self::URL);
    const CLAP_SUPPORT_URL: Option<&'static str> = None;
    const CLAP_FEATURES: &'static [ClapFeature] = &[ClapFeature::AudioEffect, ClapFeature::Stereo, ClapFeature::Delay, ClapFeature::Reverb, ClapFeature::Filter];
}

impl Vst3Plugin for SpaceFx {
    const VST3_CLASS_ID: [u8; 16] = *b"SpaceFxJohnnyHwk";
    const VST3_SUBCATEGORIES: &'static [Vst3SubCategory] = &[Vst3SubCategory::Fx, Vst3SubCategory::Delay, Vst3SubCategory::Reverb];
}

nih_export_clap!(SpaceFx);
nih_export_vst3!(SpaceFx);
