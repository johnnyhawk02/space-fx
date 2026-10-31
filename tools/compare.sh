#!/bin/sh
# tools/compare.sh <in.wav> [out dir]: builds the Rust renderer from a fresh Clip checkout and
# compares each effect's JS and Rust outputs.
set -e
here=$(cd "$(dirname "$0")" && pwd)
[ -d "$here/rust-render/clip" ] || git clone -q --depth 1 https://github.com/johnnyhawk02/clip "$here/rust-render/clip"
(cd "$here/rust-render" && cargo build -q --release)
node "$here/compare.mjs" "$1" "${2:-out}"
