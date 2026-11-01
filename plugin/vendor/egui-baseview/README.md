# egui-baseview (vendored)

[egui-baseview](https://github.com/BillyDM/egui-baseview) at rev ec70c3fe (the one nih-plug
de421011 uses), MIT licensed (LICENSE), with one change in `src/window.rs`: keyboard events are
returned to baseview as `Ignored`, so the host gets them too and its shortcuts (Space to play and
stop) work while Space FX's or Space Drive's window has focus. Wired in by the `[patch]` in
../../Cargo.toml.
