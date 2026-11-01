//! Space Drive: Drive, Filter (after Drive, or before it with Pre) and the Sequencer that moves
//! the Filter. See drive/dsp/engine.js.

use super::autofilter::{AutoFilter, FilterParams};
use super::sequencer::{SeqParams, Sequencer};
use super::shaper::{DriveParams, Shaper};

pub use super::shaper::LATENCY;

#[derive(Clone, Copy, Debug)]
pub struct Settings {
    pub tempo: f64,
    pub drive_on: bool,
    pub filter_on: bool,
    pub seq_on: bool,
    pub drive: DriveParams,
    pub filter: FilterParams,
    pub seq: SeqParams,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            tempo: 120.0,
            drive_on: true,
            filter_on: true,
            seq_on: true,
            drive: Default::default(),
            filter: Default::default(),
            seq: Default::default(),
        }
    }
}

pub struct Engine {
    rate: f64,
    pub shaper: Shaper,
    pub filter: AutoFilter,
    pub seq: Sequencer,
    seq_buf: Vec<f64>,
    pub level: f32,
}

impl Engine {
    pub fn new(rate: f64) -> Self {
        Self {
            rate,
            shaper: Shaper::new(rate),
            filter: AutoFilter::new(rate),
            seq: Sequencer::new(rate),
            seq_buf: vec![0.0; 8192],
            level: 0.0,
        }
    }

    pub fn reset(&mut self) {
        self.shaper = Shaper::new(self.rate);
        self.filter = AutoFilter::new(self.rate);
        self.seq.reset();
    }

    /// Process L and R in place, in chunks of at most 8192 frames (no allocation).
    /// `song_beats`: the host's position at the first frame, when it's playing.
    pub fn process(&mut self, l: &mut [f32], r: &mut [f32], s: &Settings, song_beats: Option<f64>) {
        let n = l.len().min(r.len());
        let beat = self.rate * 60.0 / s.tempo.max(1.0);
        let mut off = 0;
        let mut peak = 0f32;
        while off < n {
            let len = (n - off).min(self.seq_buf.len());
            let (l, r) = (&mut l[off..off + len], &mut r[off..off + len]);
            let pos = song_beats.map(|b| b + off as f64 / beat);
            let buf = &mut self.seq_buf[..len];
            self.seq.render(buf, &s.seq, beat, pos);
            let seq = if s.seq_on { Some(&buf[..]) } else { None };
            if s.filter_on && s.filter.pre {
                self.filter.process(l, r, &s.filter, seq);
            }
            let drive = if s.drive_on { s.drive } else { DriveParams { mix: 0.0, ..s.drive } };
            self.shaper.process(l, r, &drive);
            if s.filter_on && !s.filter.pre {
                self.filter.process(l, r, &s.filter, seq);
            }
            for i in 0..len {
                peak = peak.max(l[i].abs()).max(r[i].abs());
            }
            off += len;
        }
        self.level = peak;
    }
}
