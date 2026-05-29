// 生成爱心 marker 图标 PNG（无外部依赖，仅用 Node 内置 zlib）
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

function makeHeartPng(size, hex) {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)

  const raw = Buffer.alloc((size * 4 + 1) * size)
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0 // filter byte
    for (let x = 0; x < size; x++) {
      // 归一化到 [-1.3, 1.3]，y 轴向上
      const nx = (x / (size - 1)) * 2.6 - 1.3
      const ny = 1.15 - (y / (size - 1)) * 2.6
      const v = Math.pow(nx * nx + ny * ny - 1, 3) - nx * nx * ny * ny * ny
      const inside = v <= 0
      const off = y * (size * 4 + 1) + 1 + x * 4
      if (inside) {
        raw[off] = r
        raw[off + 1] = g
        raw[off + 2] = b
        raw[off + 3] = 255
      } else {
        raw[off] = 0
        raw[off + 1] = 0
        raw[off + 2] = 0
        raw[off + 3] = 0
      }
    }
  }

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
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

const outDir = path.join(__dirname, '..', 'miniprogram', 'assets')
fs.mkdirSync(outDir, { recursive: true })
fs.writeFileSync(path.join(outDir, 'heart.png'), makeHeartPng(64, '#ff5c8a'))
fs.writeFileSync(path.join(outDir, 'heart-active.png'), makeHeartPng(64, '#ff2d6f'))
console.log('hearts generated at', outDir)
