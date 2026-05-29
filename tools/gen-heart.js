// 生成地图 marker 图标 PNG（无外部依赖，仅用 Node 内置 zlib）
const fs = require('fs')
const path = require('path')
const zlib = require('zlib')

function crc32(buf) {
  let c = ~0
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i]
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1))
  }
  return ~c >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const typeBuf = Buffer.from(type, 'ascii')
  const crcBuf = Buffer.alloc(4)
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0)
  return Buffer.concat([len, typeBuf, data, crcBuf])
}

function encodePng(w, h, raw) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // color type RGBA
  const idat = zlib.deflateSync(raw)
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

function hex(h) {
  return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]
}

// 经典定位针：上圆 + 下尖，中间白点
function makePin(w, h, fillHex, dotHex) {
  const [fr, fg, fb] = hex(fillHex)
  const [dr, dg, db] = hex(dotHex)
  const cx = (w - 1) / 2
  const r = w * 0.42
  const cy = r + 2
  const tip = h - 2
  const dotR = r * 0.42

  const raw = Buffer.alloc((w * 4 + 1) * h)
  // 4x 超采样抗锯齿
  const SS = 4
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0
    for (let x = 0; x < w; x++) {
      let inFill = 0
      let inDot = 0
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const px = x + (sx + 0.5) / SS
          const py = y + (sy + 0.5) / SS
          const dx = px - cx
          const dy = py - cy
          let inside = false
          if (py <= cy) {
            inside = dx * dx + dy * dy <= r * r
          } else {
            const halfW = r * Math.max(0, (tip - py) / (tip - cy))
            inside = Math.abs(dx) <= halfW
          }
          if (inside) inFill++
          if (dx * dx + dy * dy <= dotR * dotR) inDot++
        }
      }
      const n = SS * SS
      const aFill = inFill / n
      const aDot = inDot / n
      const off = y * (w * 4 + 1) + 1 + x * 4
      if (aFill <= 0) {
        raw[off] = raw[off + 1] = raw[off + 2] = raw[off + 3] = 0
      } else {
        // 先填充色，再用白点覆盖
        const r0 = fr * (1 - aDot) + dr * aDot
        const g0 = fg * (1 - aDot) + dg * aDot
        const b0 = fb * (1 - aDot) + db * aDot
        raw[off] = Math.round(r0)
        raw[off + 1] = Math.round(g0)
        raw[off + 2] = Math.round(b0)
        raw[off + 3] = Math.round(aFill * 255)
      }
    }
  }
  return encodePng(w, h, raw)
}

const outDir = path.join(__dirname, '..', 'miniprogram', 'assets')
fs.mkdirSync(outDir, { recursive: true })
fs.writeFileSync(path.join(outDir, 'pin.png'), makePin(78, 98, '#b65b3c', '#ffffff'))
fs.writeFileSync(path.join(outDir, 'pin-active.png'), makePin(78, 98, '#9a4a2f', '#ffffff'))
console.log('pins generated at', outDir)
