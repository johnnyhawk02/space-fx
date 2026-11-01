//! The DSP, a line-by-line port of the browser page's `drive/dsp/*.js`. Plain Rust with no
//! plugin types, so it can be tested on its own. L and R are processed in place.

pub mod autofilter;
pub mod engine;
pub mod sequencer;
pub mod shaper;

#[inline]
pub(crate) fn clamp(v: f64, lo: f64, hi: f64) -> f64 {
    v.max(lo).min(hi)
}
