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

function drawPosterHeader(ctx, W, pad, y, label) {
  ctx.fillStyle = COL.muted
  ctx.font = '20px Georgia, serif'
  ctx.textBaseline = 'alphabetic'
  ctx.textAlign = 'left'
  ctx.fillText('MAP OF US', pad, y + 16)
  ctx.textAlign = 'right'
  ctx.fillText(label || '', W - pad, y + 16)
  ctx.textAlign = 'left'
  ctx.strokeStyle = COL.line
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(pad, y + 30)
  ctx.lineTo(W - pad, y + 30)
  ctx.stroke()
}

function drawPosterFooter(ctx, W, pad, y, text) {
  ctx.strokeStyle = COL.line
  ctx.beginPath()
  ctx.moveTo(pad, y)
  ctx.lineTo(W - pad, y)
  ctx.stroke()
  ctx.fillStyle = COL.faint
  ctx.font = '20px Georgia, "Songti SC", serif'
  ctx.textAlign = 'left'
  ctx.fillText('MAP OF US', pad, y + 34)
  ctx.textAlign = 'right'
  ctx.fillText(text || '我们一起走过的每一站', W - pad, y + 34)
  ctx.textAlign = 'left'
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
  drawPosterHeader(ctx, W, pad, cy, 'FOOTPRINT')
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
  drawPosterFooter(ctx, W, pad, cy, '每一次出发，都会被这张地图记住')

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
  drawPosterHeader(ctx, W, pad, cy, 'ITINERARY')
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
  drawPosterFooter(ctx, W, pad, cy, '用 MAP OF US 规划每一次出发')

  return new Promise((resolve, reject) => {
    wx.canvasToTempFilePath({
      canvas: node, x: 0, y: 0, width: W, height: H,
      destWidth: W * dpr, destHeight: H * dpr,
      success: (r) => resolve(r.tempFilePath),
      fail: reject,
    })
  })
}

// 年度回顾海报：大数字 + 常去城市 + 城市集章
// data = { title, headline, nums:{cityCount,spotCount,provinceCount,totalKm}, topCities:[{city,count,pct}], stamps:[{city,count}], style:'minimal'|'vintage'|'magazine', topPhotos:[{imageUrl}] }
const STYLES = {
  minimal:  { bg: '#f4f1ea', ink: '#1b1712', accent: '#1b1712', font: 'Georgia', mode: 'minimal' },
  vintage:  { bg: '#f0ebe0', ink: '#3d2b1f', accent: '#8b4513', font: 'Georgia', mode: 'vintage' },
  magazine: { bg: '#ffffff', ink: '#000000', accent: '#c0392b', font: 'Arial', mode: 'magazine' },
}

async function buildRecapPoster(node, data, style) {
  // style 也可从 data.style 读取，保持向后兼容
  const styleName = style || data.style || 'minimal'
  const S = STYLES[styleName] || STYLES.minimal
  // 用风格色覆盖绘制时用到的颜色变量
  const C = {
    bg: S.bg,
    ink: S.ink,
    ink2: S.ink,           // ink2 跟随 ink，vintage/magazine 自然显深色
    muted: S.ink + '99',   // 60% opacity hex 近似，用 rgba 更准确，canvas 支持 rgba
    faint: S.ink + '55',
    line: S.ink + '26',
    accent: S.accent,
    font: S.font,
  }

  const dpr = (wx.getWindowInfo && wx.getWindowInfo().pixelRatio) || 2
  const W = 600
  const pad = 48
  const innerW = W - pad * 2
  const ctx = node.getContext('2d')
  const nums = data.nums || {}

  // 顶部照片拼贴（最多3张，高120px）
  const topPhotos = (data.topPhotos || []).slice(0, 3)
  const photoH = topPhotos.length > 0 ? 120 : 0
  const photoGap = 8

  // 预下载照片
  const photoPaths = photoH > 0
    ? await Promise.all(topPhotos.map((p) => downloadImage(p.imageUrl || '')))
    : []

  // ---- 量度高度 ----
  let y = 56 // 顶部留白 + kicker
  if (photoH) y += photoH + 20 // 照片拼贴 + 间距
  y += 40 // 标题
  ctx.font = `28px "${C.font}", serif`
  const headLines = wrapLines(ctx, data.headline || '', innerW)
  y += 20 + headLines.length * 42
  y += 36 + 150 // 四宫格
  const topCities = data.topCities || []
  if (topCities.length) y += 50 + topCities.length * 46
  const stamps = (data.stamps || []).slice(0, 18)
  if (stamps.length) {
    ctx.font = `24px "Songti SC", ${C.font}, serif`
    let line = 0, x = pad
    stamps.forEach((s) => {
      const w = ctx.measureText(s.city).width + 44
      if (x + w > W - pad) { line += 1; x = pad }
      x += w + 12
    })
    y += 50 + (line + 1) * 56
  }
  y += 50 + 60 // footer
  const H = Math.ceil(y)

  // ---- 画 ----
  node.width = W * dpr
  node.height = H * dpr
  ctx.scale(dpr, dpr)
  ctx.fillStyle = C.bg
  ctx.fillRect(0, 0, W, H)
  ctx.textBaseline = 'alphabetic'

  if (S.mode === 'vintage') {
    ctx.strokeStyle = C.accent
    ctx.lineWidth = 3
    ctx.strokeRect(22, 22, W - 44, H - 44)
    ctx.strokeStyle = `rgba(${hexToRgb(C.accent)},0.28)`
    ctx.lineWidth = 1
    ctx.strokeRect(32, 32, W - 64, H - 64)
  } else if (S.mode === 'magazine') {
    ctx.fillStyle = C.ink
    ctx.fillRect(0, 0, W, 34)
    ctx.fillStyle = C.accent
    ctx.fillRect(0, 34, W, 8)
  }

  // 预加载照片 image 对象
  const photoImgs = photoH > 0
    ? await Promise.all(photoPaths.map((p) => loadImage(node, p)))
    : []

  let cy = 56
  ctx.fillStyle = S.mode === 'magazine' ? C.accent : `rgba(${hexToRgb(C.ink)},0.5)`
  ctx.font = `20px ${C.font}, serif`
  ctx.fillText(S.mode === 'vintage' ? 'MAP OF US · MEMORY ARCHIVE' : 'MAP OF US · 旅行回顾', pad, cy)
  ctx.strokeStyle = `rgba(${hexToRgb(C.ink)},0.15)`
  ctx.lineWidth = 1
  ctx.beginPath(); ctx.moveTo(pad, cy + 14); ctx.lineTo(W - pad, cy + 14); ctx.stroke()
  cy += 40

  // 照片拼贴
  if (photoH > 0 && photoImgs.some(Boolean)) {
    const validImgs = photoImgs.filter(Boolean)
    const count = validImgs.length
    const cellW = (innerW - photoGap * (count - 1)) / count
    validImgs.forEach((img, i) => {
      const dx = pad + i * (cellW + photoGap)
      drawCover(ctx, img, dx, cy, cellW, photoH)
      ctx.strokeStyle = `rgba(${hexToRgb(C.ink)},0.15)`
      ctx.strokeRect(dx, cy, cellW, photoH)
    })
    cy += photoH + 20
  }

  // 标题
  ctx.fillStyle = C.ink
  ctx.font = S.mode === 'magazine'
    ? `900 48px -apple-system, "PingFang SC", sans-serif`
    : `800 44px -apple-system, "PingFang SC", serif`
  ctx.fillText(data.title || '旅行回顾', pad, cy + 36)
  if (S.mode === 'vintage') {
    ctx.save()
    ctx.translate(W - pad - 92, cy + 8)
    ctx.rotate(-0.12)
    ctx.strokeStyle = C.accent
    ctx.lineWidth = 2
    ctx.strokeRect(0, 0, 86, 42)
    ctx.fillStyle = C.accent
    ctx.font = `16px ${C.font}, serif`
    ctx.fillText('MEMORY', 12, 27)
    ctx.restore()
  } else if (S.mode === 'magazine') {
    ctx.fillStyle = C.accent
    ctx.fillRect(pad, cy + 48, 112, 8)
  }
  cy += 40

  // headline
  ctx.fillStyle = C.ink
  ctx.font = `28px "Songti SC", ${C.font}, serif`
  cy += 20
  headLines.forEach((ln) => { ctx.fillText(ln, pad, cy + 28); cy += 42 })

  // 四宫格
  cy += 36
  const cells = [
    { n: nums.cityCount, l: '城市 Cities' },
    { n: nums.spotCount, l: '地点 Spots' },
    { n: nums.provinceCount, l: '省份 Provinces' },
    { n: nums.totalKm, l: '公里 Kilometres' },
  ]
  const cw = innerW / 2
  const ch = 75
  ctx.strokeStyle = S.mode === 'magazine' ? C.ink : `rgba(${hexToRgb(C.ink)},0.15)`
  cells.forEach((c, i) => {
    const cx = pad + (i % 2) * cw
    const cyy = cy + Math.floor(i / 2) * ch
    if (S.mode === 'magazine' && i === 0) {
      ctx.fillStyle = C.ink
      ctx.fillRect(cx, cyy, cw, ch)
    }
    ctx.strokeRect(cx, cyy, cw, ch)
    ctx.fillStyle = C.accent
    ctx.font = '800 46px -apple-system, "PingFang SC", serif'
    if (S.mode === 'magazine' && i === 0) ctx.fillStyle = C.bg
    ctx.fillText(String(c.n || 0), cx + 20, cyy + 48)
    ctx.fillStyle = S.mode === 'magazine' && i === 0 ? `rgba(255,255,255,0.72)` : `rgba(${hexToRgb(C.ink)},0.5)`
    ctx.font = `18px ${C.font}, serif`
    ctx.fillText(c.l, cx + 20, cyy + 66)
  })
  cy += 150

  // 常去城市
  if (topCities.length) {
    cy += 50
    ctx.fillStyle = C.ink
    ctx.font = `700 24px -apple-system, "PingFang SC", serif`
    ctx.fillText('常去城市', pad, cy - 14)
    const maxBarW = innerW - 180
    topCities.forEach((c) => {
      ctx.fillStyle = C.ink
      ctx.font = `22px "Songti SC", ${C.font}, serif`
      ctx.fillText(c.city, pad, cy + 22)
      ctx.fillStyle = `rgba(${hexToRgb(C.ink)},0.12)`
      ctx.fillRect(pad + 120, cy + 8, maxBarW, 16)
      ctx.fillStyle = C.accent
      ctx.fillRect(pad + 120, cy + 8, Math.max(6, (maxBarW * (c.pct || 0)) / 100), 16)
      ctx.fillStyle = `rgba(${hexToRgb(C.ink)},0.5)`
      ctx.font = `20px ${C.font}, serif`
      ctx.textAlign = 'right'
      ctx.fillText(String(c.count), W - pad, cy + 22)
      ctx.textAlign = 'left'
      cy += 46
    })
  }

  // 城市集章
  if (stamps.length) {
    cy += 50
    ctx.fillStyle = C.ink
    ctx.font = `700 24px -apple-system, "PingFang SC", serif`
    ctx.fillText('城市集章', pad, cy - 14)
    let x = pad
    ctx.font = `24px "Songti SC", ${C.font}, serif`
    stamps.forEach((s) => {
      const w = ctx.measureText(s.city).width + 44
      if (x + w > W - pad) { x = pad; cy += 56 }
      ctx.strokeStyle = C.accent
      ctx.lineWidth = 1
      ctx.strokeRect(x, cy, w, 44)
      ctx.fillStyle = C.ink
      ctx.fillText(s.city, x + 22, cy + 30)
      x += w + 12
    })
    cy += 56
  }

  // footer
  cy += 50
  ctx.strokeStyle = `rgba(${hexToRgb(C.ink)},0.15)`
  ctx.beginPath(); ctx.moveTo(pad, cy); ctx.lineTo(W - pad, cy); ctx.stroke()
  ctx.fillStyle = `rgba(${hexToRgb(C.ink)},0.35)`
  ctx.font = `20px ${C.font}, serif`
  ctx.fillText('用 MAP OF US 记录每一次出发', pad, cy + 34)

  return new Promise((resolve, reject) => {
    wx.canvasToTempFilePath({
      canvas: node, x: 0, y: 0, width: W, height: H,
      destWidth: W * dpr, destHeight: H * dpr,
      success: (r) => resolve(r.tempFilePath),
      fail: reject,
    })
  })
}

// 将 #rrggbb 或 #rgb 转为 "r,g,b" 字符串，供 rgba() 使用
function hexToRgb(hex) {
  let h = hex.replace('#', '')
  if (h.length === 3) h = h[0]+h[0]+h[1]+h[1]+h[2]+h[2]
  const n = parseInt(h, 16)
  return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`
}

module.exports = { buildJourneyPoster, buildItineraryPoster, buildRecapPoster }
