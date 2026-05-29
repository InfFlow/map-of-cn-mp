// 生成一个静态 HTML 预览（仅用于给用户看小程序三屏的视觉效果，不是小程序本体）
const fs = require('fs')
const path = require('path')
const { toneGradient, prettyDate } = require('../miniprogram/utils/util')

const data = require('C:/Users/Administrator/repos/journeys-live.json')
const polys = require('C:/Users/Administrator/repos/provinces-live.json')
const journeys = data.journeys

function daysTogether(anns) {
  for (const a of anns || []) {
    const m = /第\s*(\d+)\s*天/.exec(a.label || '')
    if (m && a.date) {
      const n = +m[1]
      const [y, mo, d] = a.date.split('.').map(Number)
      const s = new Date(y, mo - 1, d)
      s.setDate(s.getDate() - (n - 1))
      return Math.floor((Date.now() - s) / 86400000) + 1
    }
  }
  return 0
}

// ---- SVG 地图 ----
const allPts = []
polys.forEach((p) => p.points.forEach((pt) => allPts.push(pt)))
journeys.forEach((j) => allPts.push({ latitude: j.latitude, longitude: j.longitude }))
const lats = allPts.map((p) => p.latitude)
const lngs = allPts.map((p) => p.longitude)
const minLat = Math.min(...lats)
const maxLat = Math.max(...lats)
const minLng = Math.min(...lngs)
const maxLng = Math.max(...lngs)
const W = 600
const H = 700
const pad = 40
function px(lng) {
  return pad + ((lng - minLng) / (maxLng - minLng)) * (W - 2 * pad)
}
function py(lat) {
  return pad + ((maxLat - lat) / (maxLat - minLat)) * (H - 2 * pad)
}
const polyPaths = polys
  .map((p) => {
    const d = p.points.map((pt, i) => `${i ? 'L' : 'M'}${px(pt.longitude).toFixed(1)},${py(pt.latitude).toFixed(1)}`).join(' ') + ' Z'
    return `<path d="${d}" fill="#ff5c8a30" stroke="#ff2d6f" stroke-width="1.2"/>`
  })
  .join('\n')
const markerEls = journeys
  .map((j) => {
    const x = px(j.longitude)
    const y = py(j.latitude)
    return `<g transform="translate(${x.toFixed(1)},${y.toFixed(1)})">
      <text x="0" y="0" font-size="22" text-anchor="middle" dominant-baseline="middle">\u2764\uFE0F</text>
      <text x="0" y="20" font-size="13" fill="#43303a" text-anchor="middle" font-weight="700">${j.city}</text>
    </g>`
  })
  .join('\n')
const mapSvg = `<svg viewBox="0 0 ${W} ${H}" width="100%" xmlns="http://www.w3.org/2000/svg">${polyPaths}${markerEls}</svg>`

// ---- 时间线卡片 ----
const anniHtml = `<div class="card anni">
  <div class="anni-title">\u2764 我们的纪念日</div>
  ${data.anniversaries.map((a) => `<div class="anni-item"><span class="anni-dot"></span><b>${a.label}</b><div class="anni-meta">${prettyDate(a.date)} \u00b7 ${a.city}</div></div>`).join('')}
</div>`
const tlHtml = journeys
  .map(
    (j) => `<div class="card trip">
    <div class="cover" style="background:${toneGradient(j.coverTone)}">
      <div class="cover-text"><span class="city">${j.city}</span><span class="date">${prettyDate(j.date)}</span></div>
    </div>
    <div class="content">
      <div class="title">${j.title}</div>
      <div class="intro">${j.intro}</div>
      <div class="tags">${j.tags.map((t) => `<span class="chip">${t}</span>`).join('')}</div>
    </div>
  </div>`,
  )
  .join('')

// ---- 详情（济南） ----
const d0 = journeys[0]
const detailHtml = `
  <div class="d-head"><span class="d-city">\u2764 ${d0.city}</span><span class="date">${prettyDate(d0.date)}</span></div>
  <div class="title big">${d0.title}</div>
  <div class="tags">
    <span class="chip">${d0.season}</span><span class="chip">\u2601 ${d0.weather}</span><span class="chip">\ud83d\udccd ${d0.landmark}</span>
  </div>
  <div class="intro big">${d0.intro}</div>
  <div class="tags">${d0.tags.map((t) => `<span class="chip soft">#${t}</span>`).join('')}</div>
  <div class="photos">
    ${d0.photos.map((p) => `<div class="photo" style="background:${toneGradient(p.tone)}"><div class="ptext"><div class="pt">${p.title}</div><div class="ps">${p.subtitle}</div></div></div>`).join('')}
  </div>
  <div class="notes-title">手记</div>
  ${d0.notes.map((n) => `<div class="note">${n}</div>`).join('')}
`

const stats = {
  province: new Set(journeys.map((j) => j.province)).size,
  city: new Set(journeys.map((j) => j.city)).size,
  trip: journeys.length,
}
const days = daysTogether(data.anniversaries)

const html = `<!doctype html><html lang="zh"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Map of Us 小程序预览</title>
<style>
  :root{--rose:#ff5c8a;--rose-deep:#ff2d6f;--rose-soft:#ffe3ec;--ink:#43303a;--ink-soft:#8a6f7b;--bg:#fff6f9;}
  *{box-sizing:border-box;margin:0;padding:0;font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;}
  body{background:#fbe8ef;padding:30px;display:flex;gap:28px;justify-content:center;flex-wrap:wrap;align-items:flex-start;}
  .phone{width:340px;background:var(--bg);border-radius:36px;box-shadow:0 24px 60px rgba(255,45,111,.25);overflow:hidden;border:10px solid #fff;}
  .bar{background:linear-gradient(135deg,#ff5c8a,#ff2d6f);color:#fff;text-align:center;padding:14px;font-weight:700;font-size:15px;}
  .screen{padding:16px;height:720px;overflow:auto;}
  .label{text-align:center;color:#a8607c;font-weight:700;margin-bottom:10px;}
  .header{display:flex;justify-content:space-between;align-items:flex-end;}
  .h-title{font-size:24px;font-weight:800;color:var(--rose-deep);}
  .h-sub{font-size:12px;color:var(--ink-soft);margin-top:4px;}
  .together{background:var(--rose-soft);border-radius:12px;padding:6px 12px;text-align:center;}
  .together .n{font-size:22px;font-weight:800;color:var(--rose-deep);}
  .together .t{font-size:11px;color:var(--ink-soft);}
  .stats{display:flex;gap:8px;margin:14px 0;}
  .stat{flex:1;background:#fff;border-radius:12px;padding:10px 0;text-align:center;box-shadow:0 6px 16px rgba(255,92,138,.14);}
  .stat .num{font-size:22px;font-weight:800;color:var(--rose-deep);}
  .stat .lab{font-size:11px;color:var(--ink-soft);}
  .map{background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 8px 20px rgba(255,92,138,.14);}
  .card{background:#fff;border-radius:16px;box-shadow:0 8px 20px rgba(255,92,138,.14);margin-bottom:14px;overflow:hidden;}
  .anni{padding:16px;}
  .anni-title{font-weight:800;color:var(--rose-deep);margin-bottom:10px;}
  .anni-item{position:relative;padding-left:18px;margin-bottom:10px;font-size:14px;}
  .anni-dot{position:absolute;left:0;top:6px;width:8px;height:8px;border-radius:50%;background:var(--rose);}
  .anni-meta{font-size:11px;color:var(--ink-soft);}
  .cover{height:110px;position:relative;}
  .cover-text{position:absolute;left:14px;right:14px;bottom:10px;display:flex;justify-content:space-between;align-items:baseline;color:#fff;text-shadow:0 1px 6px rgba(0,0,0,.35);}
  .city{font-size:20px;font-weight:800;}
  .date{font-size:12px;}
  .content{padding:12px 14px;}
  .title{font-size:15px;font-weight:700;}.title.big{font-size:19px;margin:10px 0;}
  .intro{font-size:13px;color:var(--ink-soft);line-height:1.6;margin-top:6px;}.intro.big{color:var(--ink);font-size:14px;margin:12px 0;}
  .tags{margin-top:8px;}
  .chip{display:inline-block;background:var(--rose-soft);color:var(--rose-deep);padding:3px 10px;border-radius:999px;font-size:11px;margin:0 6px 6px 0;}
  .chip.soft{background:#fff;border:1px solid var(--rose-soft);}
  .d-head{display:flex;justify-content:space-between;align-items:baseline;}
  .d-city{font-size:24px;font-weight:800;color:var(--rose-deep);}
  .photos{display:flex;flex-wrap:wrap;gap:8px;margin:12px 0;}
  .photo{position:relative;width:calc(50% - 4px);height:120px;border-radius:12px;overflow:hidden;}
  .ptext{position:absolute;left:10px;bottom:8px;right:10px;color:#fff;text-shadow:0 1px 6px rgba(0,0,0,.4);}
  .pt{font-size:13px;font-weight:700;}.ps{font-size:11px;opacity:.92;}
  .notes-title{font-weight:800;color:var(--rose-deep);margin:6px 0 8px;}
  .note{background:#fff;border-radius:12px;padding:12px 14px;font-size:13px;line-height:1.6;margin-bottom:10px;box-shadow:0 6px 16px rgba(255,92,138,.12);}
</style></head><body>
  <div class="phone"><div class="bar">Map of Us</div><div class="screen">
    <div class="label">① 地图首页</div>
    <div class="header"><div><div class="h-title">Map of Us \u2764</div><div class="h-sub">我们的地图 \u00b7 一起走过的路</div></div>
      <div class="together"><div class="n">${days}</div><div class="t">在一起第 N 天</div></div></div>
    <div class="stats">
      <div class="stat"><div class="num">${stats.province}</div><div class="lab">点亮省份</div></div>
      <div class="stat"><div class="num">${stats.city}</div><div class="lab">点亮城市</div></div>
      <div class="stat"><div class="num">${stats.trip}</div><div class="lab">段回忆</div></div>
    </div>
    <div class="map">${mapSvg}</div>
  </div></div>

  <div class="phone"><div class="bar">时间线</div><div class="screen">
    <div class="label">② 时间线</div>
    ${anniHtml}${tlHtml}
  </div></div>

  <div class="phone"><div class="bar">${d0.city}</div><div class="screen">
    <div class="label">③ 城市详情</div>
    ${detailHtml}
  </div></div>
</body></html>`

const out = path.join(__dirname, '..', 'preview.html')
fs.writeFileSync(out, html)
console.log('preview written to', out)
