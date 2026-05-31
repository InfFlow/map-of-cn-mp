// 足迹分享长图：在 canvas 2d 上绘制「封面 + 城市/标题 + 手记 + 照片九宫格」
// 用法：const tempFilePath = await buildJourneyPoster(node, trip)

const COL = {
  bg: '#faf8f3',
  paper: '#ffffff',
  ink: '#1b1712',
  ink2: '#4a463f',
  muted: '#8c8475',
  faint: '#b3ab9c',
  line: '#1b171226',
}

// 下载网络图片到本地临时路径
function downloadImage(url) {
  return new Promise((resolve) => {
    if (!url) return resolve('')
    wx.downloadFile({
      url,
      success: (r) => resolve(r.statusCode === 200 ? r.tempFilePath : ''),
      fail: () => resolve(''),
    })
  })
}

// 在指定 canvas 上把本地路径加载为可绘制 image
function loadImage(canvas, path) {
  return new Promise((resolve) => {
    if (!path) return resolve(null)
    const img = canvas.createImage()
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null)
    img.src = path
  })
}

// 文本按宽度折行
function wrapLines(ctx, text, maxWidth) {
  const out = []
  const src = String(text || '').replace(/\r/g, '')
  src.split('\n').forEach((para) => {
    if (para === '') {
      out.push('')
      return
    }
    let line = ''
    for (const ch of para) {
      if (ctx.measureText(line + ch).width > maxWidth && line) {
        out.push(line)
        line = ch
      } else {
        line += ch
      }
    }
    if (line) out.push(line)
  })
  return out
}

// 画「object-fit: cover」的图片
function drawCover(ctx, img, dx, dy, dw, dh) {
  const ir = img.width / img.height
  const dr = dw / dh
  let sx = 0
  let sy = 0
  let sw = img.width
  let sh = img.height
  if (ir > dr) {
    sw = img.height * dr
    sx = (img.width - sw) / 2
  } else {
    sh = img.width / dr
    sy = (img.height - sh) / 2
  }
  ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh)
}

async function buildJourneyPoster(node, trip) {
  const dpr = (wx.getWindowInfo && wx.getWindowInfo().pixelRatio) || 2
  const W = 600
  const pad = 44
  const innerW = W - pad * 2
  const ctx = node.getContext('2d')

  // 预下载图片
  const photoUrls = (trip.photos || []).map((p) => p.imageUrl).filter(Boolean)
  const coverUrl = trip.cover || photoUrls[0] || ''
  const gridUrls = photoUrls.slice(0, 6)
  const [coverPath, gridPaths] = await Promise.all([
    downloadImage(coverUrl),
    Promise.all(gridUrls.map(downloadImage)),
  ])

  // ---- 量度高度 ----
  let y = 0
  y += 44 // 顶部留白
  y += 24 // kicker
  const coverH = coverPath ? 360 : 0
  if (coverH) y += 18 + coverH
  y += 40 // city 上间距
  y += 64 // city display
  ctx.font = '600 30px Georgia, serif'
  const titleLines = wrapLines(ctx, trip.title || '', innerW)
  y += titleLines.length * 40
  y += 30 // meta
  // 手记
  const noteText =
    (trip.intro ? trip.intro + '\n' : '') + ((trip.restNotes || []).join('\n'))
  ctx.font = '26px "Songti SC", Georgia, serif'
  const noteLines = wrapLines(ctx, noteText, innerW)
  if (noteLines.length) y += 24 + noteLines.length * 42
  // 照片九宫格
  const cols = 3
  const gap = 12
  const cell = (innerW - gap * (cols - 1)) / cols
  const rows = Math.ceil(gridPaths.filter(Boolean).length / cols)
  if (rows > 0) y += 34 + rows * cell + (rows - 1) * gap
  y += 40 // footer 上
  y += 60 // footer
  const H = Math.ceil(y)

  // ---- 设置画布尺寸并绘制 ----
  node.width = W * dpr
  node.height = H * dpr
  ctx.scale(dpr, dpr)

  ctx.fillStyle = COL.bg
  ctx.fillRect(0, 0, W, H)

  // 预加载要绘制的 image 对象
  const [coverImg, gridImgs] = await Promise.all([
    loadImage(node, coverPath),
    Promise.all(gridPaths.map((p) => loadImage(node, p))),
  ])

  let cy = 44
  // kicker
  ctx.fillStyle = COL.muted
  ctx.font = '20px Georgia, serif'
  ctx.textBaseline = 'alphabetic'
  ctx.fillText('MAP OF US · 我们的地图', pad, cy + 16)
  // 顶部细线
  ctx.strokeStyle = COL.line
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(pad, cy + 30)
  ctx.lineTo(W - pad, cy + 30)
  ctx.stroke()
  cy += 24

  // 封面
  if (coverImg) {
    cy += 18
    drawCover(ctx, coverImg, pad, cy, innerW, coverH)
    ctx.strokeStyle = COL.line
    ctx.strokeRect(pad, cy, innerW, coverH)
    cy += coverH
  }

  // 城市
  cy += 40
  ctx.fillStyle = COL.ink
  ctx.font = '800 56px -apple-system, "PingFang SC", serif'
  ctx.fillText(trip.city || '', pad, cy + 44)
  cy += 64

  // 标题
  ctx.fillStyle = COL.ink2
  ctx.font = '600 30px Georgia, "Songti SC", serif'
  titleLines.forEach((ln) => {
    ctx.fillText(ln, pad, cy + 28)
    cy += 40
  })

  // meta：季节 · 天气 · 日期
  const metaParts = [trip.season, trip.weather, trip.dateShort].filter(Boolean)
  ctx.fillStyle = COL.muted
  ctx.font = '22px Georgia, serif'
  ctx.fillText(metaParts.join('  ·  '), pad, cy + 18)
  cy += 30

  // 手记
  if (noteLines.length) {
    cy += 24
    ctx.fillStyle = COL.ink2
    ctx.font = '26px "Songti SC", Georgia, serif'
    noteLines.forEach((ln) => {
      ctx.fillText(ln, pad, cy + 26)
      cy += 42
    })
  }

  // 照片九宫格
  const drawable = gridImgs.filter(Boolean)
  if (drawable.length) {
    cy += 34
    drawable.forEach((img, i) => {
      const r = Math.floor(i / cols)
      const c = i % cols
      const dx = pad + c * (cell + gap)
      const dy = cy + r * (cell + gap)
      drawCover(ctx, img, dx, dy, cell, cell)
      ctx.strokeStyle = COL.line
      ctx.strokeRect(dx, dy, cell, cell)
    })
    cy += rows * cell + (rows - 1) * gap
  }

  // footer
  cy += 40
  ctx.strokeStyle = COL.line
  ctx.beginPath()
  ctx.moveTo(pad, cy)
  ctx.lineTo(W - pad, cy)
  ctx.stroke()
  ctx.fillStyle = COL.faint
  ctx.font = '20px Georgia, serif'
  ctx.fillText('每一次出发，都会被这张地图记住', pad, cy + 34)

  // 导出
  return new Promise((resolve, reject) => {
    wx.canvasToTempFilePath({
      canvas: node,
      x: 0,
      y: 0,
      width: W,
      height: H,
      destWidth: W * dpr,
      destHeight: H * dpr,
      success: (r) => resolve(r.tempFilePath),
      fail: reject,
    })
  })
}

// 行程单分享长图：封面（可选）+ 标题/日期 + 按天列出目的地（时间表/停留/出发点/节奏）
// 用法：const tempFilePath = await buildItineraryPoster(node, data)
// data = { title, meta, coverUrl, days: [{ label, dateText, weather, startName, summary, stops: [{ idx, name, timeText, stayText, note }] }] }
async function buildItineraryPoster(node, data) {
  const dpr = (wx.getWindowInfo && wx.getWindowInfo().pixelRatio) || 2
  const W = 600
  const pad = 44
  const innerW = W - pad * 2
  const ctx = node.getContext('2d')

  const coverPath = await downloadImage(data.coverUrl || '')

  // ---- 量度高度 ----
  let y = 44 // 顶部留白
  y += 24 // kicker + 细线
  const coverH = coverPath ? 300 : 0
  if (coverH) y += 18 + coverH
  y += 40
  ctx.font = '800 48px -apple-system, "PingFang SC", serif'
  const titleLines = wrapLines(ctx, data.title || '行程单', innerW)
  y += titleLines.length * 56
  y += 30 // meta
  ;(data.days || []).forEach((d) => {
    y += 34 // 天头
    if (d.startName) y += 30
    ;(d.stops || []).forEach((s) => {
      y += 34 // 名称行
      if (s.timeText || s.stayText) y += 26
      ctx.font = '22px "Songti SC", Georgia, serif'
      if (s.note) y += wrapLines(ctx, s.note, innerW - 40).length * 30
    })
    if (d.summary) y += 30
    y += 14
  })
  y += 40 + 60 // footer
  const H = Math.ceil(y)

  // ---- 画 ----
  node.width = W * dpr
  node.height = H * dpr
  ctx.scale(dpr, dpr)
  ctx.fillStyle = COL.bg
  ctx.fillRect(0, 0, W, H)
  const coverImg = await loadImage(node, coverPath)

  let cy = 44
  ctx.fillStyle = COL.muted
  ctx.font = '20px Georgia, serif'
  ctx.textBaseline = 'alphabetic'
  ctx.fillText('MAP OF US · 行程单', pad, cy + 16)
  ctx.strokeStyle = COL.line
  ctx.lineWidth = 1
  ctx.beginPath(); ctx.moveTo(pad, cy + 30); ctx.lineTo(W - pad, cy + 30); ctx.stroke()
  cy += 24

  if (coverImg) {
    cy += 18
    drawCover(ctx, coverImg, pad, cy, innerW, coverH)
    ctx.strokeStyle = COL.line
    ctx.strokeRect(pad, cy, innerW, coverH)
    cy += coverH
  }

  cy += 40
  ctx.fillStyle = COL.ink
  ctx.font = '800 48px -apple-system, "PingFang SC", serif'
  titleLines.forEach((ln) => { ctx.fillText(ln, pad, cy + 40); cy += 56 })

  ctx.fillStyle = COL.muted
  ctx.font = '22px Georgia, serif'
  ctx.fillText(data.meta || '', pad, cy + 18)
  cy += 30

  ;(data.days || []).forEach((d) => {
    // 天头：第N天 + 日期 + 天气
    ctx.fillStyle = COL.ink
    ctx.font = '700 26px -apple-system, "PingFang SC", serif'
    ctx.fillText(d.label || '', pad, cy + 24)
    const right = [d.dateText, d.weather].filter(Boolean).join('  ')
    if (right) {
      ctx.fillStyle = COL.muted
      ctx.font = '20px Georgia, serif'
      ctx.textAlign = 'right'
      ctx.fillText(right, W - pad, cy + 24)
      ctx.textAlign = 'left'
    }
    cy += 34
    if (d.startName) {
      ctx.fillStyle = COL.muted
      ctx.font = '22px "Songti SC", Georgia, serif'
      ctx.fillText('出发 · ' + d.startName, pad, cy + 20)
      cy += 30
    }
    ;(d.stops || []).forEach((s) => {
      ctx.fillStyle = COL.ink2
      ctx.font = '600 25px -apple-system, "PingFang SC", serif'
      ctx.fillText((s.idx != null ? s.idx + '. ' : '') + (s.name || ''), pad, cy + 24)
      cy += 34
      const sub = [s.timeText, s.stayText].filter(Boolean).join('   ')
      if (sub) {
        ctx.fillStyle = COL.muted
        ctx.font = '20px Georgia, serif'
        ctx.fillText(sub, pad + 8, cy + 16)
        cy += 26
      }
      if (s.note) {
        ctx.fillStyle = COL.muted
        ctx.font = '22px "Songti SC", Georgia, serif'
        wrapLines(ctx, s.note, innerW - 40).forEach((ln) => { ctx.fillText(ln, pad + 8, cy + 22); cy += 30 })
      }
    })
    if (d.summary) {
      ctx.fillStyle = COL.faint
      ctx.font = '20px Georgia, serif'
      ctx.fillText(d.summary, pad, cy + 20)
      cy += 30
    }
    cy += 14
  })

  cy += 40
  ctx.strokeStyle = COL.line
  ctx.beginPath(); ctx.moveTo(pad, cy); ctx.lineTo(W - pad, cy); ctx.stroke()
  ctx.fillStyle = COL.faint
  ctx.font = '20px Georgia, serif'
  ctx.fillText('用 MAP OF US 规划每一次出发', pad, cy + 34)

  return new Promise((resolve, reject) => {
    wx.canvasToTempFilePath({
      canvas: node, x: 0, y: 0, width: W, height: H,
      destWidth: W * dpr, destHeight: H * dpr,
      success: (r) => resolve(r.tempFilePath),
      fail: reject,
    })
  })
}

module.exports = { buildJourneyPoster, buildItineraryPoster }
