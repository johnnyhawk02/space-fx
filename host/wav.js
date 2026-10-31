// WAV encode (16 / 24-bit PCM or 32-bit float) and a small decoder for Node tools. No DOM.

export function encodeWav(channels, rate, bits = 24) {
  const n = channels[0].length;
  const ch = channels.length;
  const float = bits === 32;
  const bytes = bits / 8;
  const data = n * ch * bytes;
  const buf = new ArrayBuffer(44 + data);
  const v = new DataView(buf);
  const str = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF');
  v.setUint32(4, 36 + data, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, float ? 3 : 1, true);
  v.setUint16(22, ch, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * ch * bytes, true);
  v.setUint16(32, ch * bytes, true);
  v.setUint16(34, bits, true);
  str(36, 'data');
  v.setUint32(40, data, true);
  let o = 44;
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < ch; c++) {
      const x = Math.max(-1, Math.min(1, channels[c][i]));
      if (float) {
        v.setFloat32(o, channels[c][i], true);
      } else if (bits === 16) {
        v.setInt16(o, Math.round(x * 32767), true);
      } else {
        const s = Math.round(x * 8388607);
        v.setUint8(o, s & 255);
        v.setUint8(o + 1, (s >> 8) & 255);
        v.setUint8(o + 2, (s >> 16) & 255);
      }
      o += bytes;
    }
  }
  return buf;
}

// PCM 16/24/32 or float 32 WAV to { rate, channels: [Float32Array...] }.
export function decodeWav(arrayBuffer) {
  const v = new DataView(arrayBuffer);
  let o = 12;
  let fmt = null;
  while (o + 8 <= v.byteLength) {
    const id = String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3));
    const size = v.getUint32(o + 4, true);
    if (id === 'fmt ') {
      fmt = { format: v.getUint16(o + 8, true), ch: v.getUint16(o + 10, true), rate: v.getUint32(o + 12, true), bits: v.getUint16(o + 22, true) };
      if (fmt.format === 0xfffe) fmt.format = v.getUint16(o + 32, true);
    } else if (id === 'data' && fmt) {
      const bytes = fmt.bits / 8;
      const n = Math.floor(size / (bytes * fmt.ch));
      const channels = Array.from({ length: fmt.ch }, () => new Float32Array(n));
      let p = o + 8;
      for (let i = 0; i < n; i++) {
        for (let c = 0; c < fmt.ch; c++) {
          let x;
          if (fmt.format === 3) x = v.getFloat32(p, true);
          else if (fmt.bits === 16) x = v.getInt16(p, true) / 32768;
          else if (fmt.bits === 24) x = ((v.getUint8(p) | (v.getUint8(p + 1) << 8) | (v.getInt8(p + 2) << 16))) / 8388608;
          else x = v.getInt32(p, true) / 2147483648;
          channels[c][i] = x;
          p += bytes;
        }
      }
      return { rate: fmt.rate, channels };
    }
    o += 8 + size + (size & 1);
  }
  throw new Error('Not a WAV file this can read');
}
