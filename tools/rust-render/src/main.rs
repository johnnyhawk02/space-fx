//! rust-render <tape|phaser|spring> <in.wav> <out.wav> [settings json] [bpm]
//! Runs Clip's DSP exactly as it stands (the source files are included from a Clip checkout in
//! ../clip, which tools/compare.sh clones), with a 4 second tail.

#![allow(dead_code)]

#[path = "../clip/src/fx.rs"]
mod fx;
#[path = "../clip/src/phaser.rs"]
mod phaser;
#[path = "../clip/src/tape.rs"]
mod tape;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let (which, input, output) = (&args[1], &args[2], &args[3]);
    let json = args.get(4).cloned().unwrap_or_else(|| "{}".into());
    let bpm: f64 = args.get(5).map(|s| s.parse().unwrap()).unwrap_or(120.0);
    let mut r = hound::WavReader::open(input).expect("input wav");
    let spec = r.spec();
    let rate = spec.sample_rate;
    let ch = spec.channels as usize;
    let samples: Vec<f32> = match spec.sample_format {
        hound::SampleFormat::Float => r.samples::<f32>().map(|s| s.unwrap()).collect(),
        hound::SampleFormat::Int => {
            let scale = (1i64 << (spec.bits_per_sample - 1)) as f32;
            r.samples::<i32>().map(|s| s.unwrap() as f32 / scale).collect()
        }
    };
    let mut frames: Vec<[f32; 2]> = samples.chunks(ch).map(|c| [c[0], c[if ch > 1 { 1 } else { 0 }]]).collect();
    frames.extend(std::iter::repeat_n([0.0; 2], rate as usize * 4));
    let beat = rate as f64 * 60.0 / bpm;
    let v: serde_json::Value = serde_json::from_str(&json).unwrap();
    let get = |k: &str, d: f32| v.get(k).and_then(|x| x.as_f64()).map_or(d, |x| x as f32);
    match which.as_str() {
        "tape" => {
            let d = tape::Settings::default();
            let s = tape::Settings {
                beats: get("beats", d.beats), feedback: get("feedback", d.feedback), drive: get("drive", d.drive),
                bias: get("bias", d.bias), wow: get("wow", d.wow), speed: get("speed", d.speed),
                spacing: get("spacing", d.spacing), mix: get("mix", d.mix),
                lfo_shape: get("lfo_shape", 0.0) as u8, lfo_rate: get("lfo_rate", d.lfo_rate),
                lfo_slow: get("lfo_slow", 0.0) > 0.5, lfo_depth: get("lfo_depth", d.lfo_depth),
                lfo_slew: get("lfo_slew", d.lfo_slew), ..d
            };
            let mut t = tape::Tape::new(rate);
            for c in frames.chunks_mut(64) { t.process(&s, c, beat); }
        }
        "phaser" => {
            let d = phaser::Settings::default();
            let s = phaser::Settings { speed: get("speed", d.speed), mix: get("mix", d.mix), ..d };
            let mut p = phaser::Phaser::new(rate);
            for c in frames.chunks_mut(64) { p.process(&s, c); }
        }
        "spring" => {
            let d = fx::SpringSettings::default();
            let s = fx::SpringSettings {
                length: get("length", d.length), decay: get("decay", d.decay), tone: get("tone", d.tone),
                chirp: get("chirp", d.chirp), mix: get("mix", d.mix), ..d
            };
            let mut p = fx::Spring::new(rate);
            for c in frames.chunks_mut(64) { p.process(&s, c); }
        }
        _ => panic!("tape, phaser or spring"),
    }
    let out = hound::WavSpec { channels: 2, sample_rate: rate, bits_per_sample: 32, sample_format: hound::SampleFormat::Float };
    let mut w = hound::WavWriter::create(output, out).unwrap();
    for f in frames { w.write_sample(f[0]).unwrap(); w.write_sample(f[1]).unwrap(); }
    w.finalize().unwrap();
}
