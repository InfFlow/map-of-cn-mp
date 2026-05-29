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
const H = 680
const pad = 52
function px(lng) {
  return pad + ((lng - minLng) / (maxLng - minLng)) * (W - 2 * pad)
}
function py(lat) {
  return pad + ((maxLat - lat) / (maxLat - minLat)) * (H - 2 * pad)
}
const polyPaths = polys
  .map((p) => {
    const d = p.points.map((pt, i) => `${i ? 'L' : 'M'}${px(pt.longitude).toFixed(1)},${py(pt.latitude).toFixed(1)}`).join(' ') + ' Z'
    return `<path d="${d}" fill="#b65b3c2E" stroke="#b65b3c" stroke-width="1.1"/>`
  })
  .join('\n')
// 定位针：圆头 + 下尖 + 白点
function pinSvg(x, y) {
  const r = 11
  const tipY = y + 30
  return `<g>
    <path d="M ${x - r} ${y} A ${r} ${r} 0 1 1 ${x + r} ${y} L ${x} ${tipY} Z" fill="#b65b3c"/>
    <circle cx="${x}" cy="${y}" r="4.4" fill="#fff"/>
  </g>`
}
const markerEls = journeys
  .map((j) => {
    const x = px(j.longitude)
    const y = py(j.latitude) - 18
    return `${pinSvg(x, y)}<text x="${x.toFixed(1)}" y="${(y + 46).toFixed(1)}" font-size="13" fill="#1f1d1b" text-anchor="middle" font-weight="700">${j.city}</text>`
  })
  .join('\n')
const mapSvg = `<svg viewBox="0 0 ${W} ${H}" width="100%" xmlns="http://www.w3.org/2000/svg" style="display:block;background:#f7f4ef">${polyPaths}${markerEls}</svg>`

// ---- 最近的回忆（首页横滑） ----
const recent = [...journeys].sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 6)
const recentHtml = recent
  .map(
    (j) => `<div class="rcard">
      <div class="rcover" style="background:${toneGradient(j.coverTone)}"><div class="rcity">${j.city}</div></div>
      <div class="rmeta"><div class="rtitle">${j.title}</div><div class="rdate">${prettyDate(j.date)}</div></div>
    </div>`,
  )
  .join('')

// ---- 时间线 ----
const anniCards = data.anniversaries
  .map(
    (a) => `<div class="anni-card">
      <div class="anni-label">${a.label}</div>
      <div class="anni-date">${prettyDate(a.date)}</div>
      <div class="anni-city">${a.city}</div>
    </div>`,
  )
  .join('')
const tlHtml = journeys
  .map(
    (j, i) => `<div class="tl-item">
    <div class="rail"><div class="node"></div><div class="line"></div></div>
    <div class="body card">
      <div class="cover" style="background:${toneGradient(j.coverTone)}">
        <div class="cover-shade"></div>
        <div class="cover-top"><span class="season">${j.season}</span><span class="date">${prettyDate(j.date)}</span></div>
        <div class="cover-city display">${j.city}</div>
      </div>
      <div class="content">
        <div class="title">${j.title}</div>
        <div class="intro">${j.intro}</div>
        <div class="tags">${j.tags.map((t) => `<span class="chip">${t}</span>`).join('')}</div>
      </div>
    </div>
  </div>`,
  )
  .join('')

// ---- 详情（济南） ----
const d0 = journeys[0]
const detailHtml = `
  <div class="d-hero" style="background:${toneGradient(d0.coverTone)}">
    <div class="d-hero-shade"></div>
    <div class="d-hero-text">
      <div class="d-prov">${d0.province} \u00b7 ${d0.season}</div>
      <div class="d-city display">${d0.city}</div>
      <div class="d-date">${prettyDate(d0.date)}</div>
    </div>
  </div>
  <div class="sheet">
    <div class="d-title">${d0.title}</div>
    <div class="tags meta"><span class="chip">\u2601 ${d0.weather}</span><span class="chip">\ud83d\udccd ${d0.landmark}</span></div>
    <div class="intro big">${d0.intro}</div>
    <div class="tags">${d0.tags.map((t) => `<span class="chip soft">#${t}</span>`).join('')}</div>
    <div class="sec-title"><span class="sdot"></span>那天的画面</div>
    <div class="photos">
      ${d0.photos.map((p) => `<div class="photo" style="background:${toneGradient(p.tone)}"><div class="photo-shade"></div><div class="ptext"><div class="pt">${p.title}</div><div class="ps">${p.subtitle}</div></div></div>`).join('')}
    </div>
    <div class="sec-title"><span class="sdot"></span>手记</div>
    ${d0.notes.map((n) => `<div class="note"><span class="quote">\u201c</span>${n}</div>`).join('')}
  </div>
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
  :root{--bg:#f4f1ec;--bg-el:#faf8f4;--surface:#fff;--ink:#1f1d1b;--ink2:#57514b;--muted:#948d84;--line:rgba(31,29,27,.08);--line2:rgba(31,29,27,.14);--accent:#b65b3c;--accent-deep:#9a4a2f;--accent-soft:#f1e4dc;}
  *{box-sizing:border-box;margin:0;padding:0;font-family:-apple-system,"SF Pro Text","PingFang SC","Microsoft YaHei",sans-serif;-webkit-font-smoothing:antialiased;}
  .display{font-weight:800;letter-spacing:-.5px;}
  body{background:#e9e3da;padding:34px;display:flex;gap:30px;justify-content:center;flex-wrap:wrap;align-items:flex-start;}
  .phone{width:344px;background:var(--bg);border-radius:42px;box-shadow:0 30px 70px rgba(31,29,27,.2);overflow:hidden;border:10px solid #fff;}
  .bar{background:var(--bg);color:var(--ink);text-align:center;padding:14px;font-weight:600;font-size:15px;border-bottom:1px solid var(--line);}
  .screen{height:724px;overflow:auto;background:var(--bg);}
  .label{text-align:center;color:var(--muted);font-weight:600;margin:12px 0;font-size:12px;letter-spacing:1px;}
  .card{background:var(--surface);border-radius:22px;border:1px solid var(--line);box-shadow:0 2px 2px rgba(31,29,27,.02),0 14px 30px rgba(31,29,27,.05);}
  .chip{display:inline-flex;align-items:center;background:var(--bg);color:var(--ink2);border:1px solid var(--line);padding:4px 12px;border-radius:999px;font-size:11px;margin:0 8px 8px 0;}
  .chip.soft{background:var(--accent-soft);color:var(--accent-deep);border-color:transparent;}
  .sec-title{display:flex;align-items:center;gap:8px;font-size:13px;font-weight:700;color:var(--ink);margin:22px 0 14px;}
  .sdot{width:7px;height:7px;border-radius:50%;background:var(--accent);}

  /* 首页 */
  .head{padding:22px 24px 4px;}
  .kicker{font-size:10px;letter-spacing:4px;color:var(--muted);margin-bottom:8px;}
  .h1{font-size:42px;line-height:1.02;color:var(--ink);}
  .hsub{font-size:14px;color:var(--ink2);margin-top:9px;}
  .together{margin-top:13px;font-size:14px;color:var(--ink2);}
  .together .n{font-size:18px;font-weight:800;color:var(--accent);margin:0 3px;}
  .stats{display:flex;align-items:center;margin:18px 18px 0;padding:18px 8px;}
  .stat{flex:1;text-align:center;}
  .stat .num{font-size:28px;color:var(--ink);line-height:1;}
  .stat .lab{font-size:12px;color:var(--muted);margin-top:7px;}
  .vline{width:1px;height:28px;background:var(--line);}
  .block{margin:26px 18px 0;}
  .blocktitle{display:flex;align-items:center;gap:8px;font-size:13px;font-weight:700;color:var(--ink);margin-bottom:13px;}
  .legend{margin-left:auto;display:flex;gap:10px;}
  .lg{display:inline-flex;align-items:center;gap:5px;font-size:10px;font-weight:500;color:var(--muted);}
  .sw{width:9px;height:9px;border-radius:3px;display:inline-block;}
  .sw.p{background:rgba(182,91,60,.18);border:1px solid var(--accent);}
  .sw.c{border-radius:50%;background:var(--accent);}
  .map-card{padding:7px;overflow:hidden;}
  .map-card svg{border-radius:15px;}
  .recent{display:flex;gap:11px;overflow-x:auto;padding-bottom:6px;}
  .rcard{min-width:150px;background:var(--surface);border:1px solid var(--line);border-radius:18px;overflow:hidden;box-shadow:0 10px 24px rgba(31,29,27,.05);}
  .rcover{position:relative;height:96px;}
  .rcity{position:absolute;left:14px;bottom:9px;color:#fff;font-size:18px;font-weight:700;text-shadow:0 1px 6px rgba(0,0,0,.35);}
  .rmeta{padding:11px 14px 13px;}
  .rtitle{font-size:13px;font-weight:600;color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
  .rdate{font-size:11px;color:var(--muted);margin-top:5px;}

  /* 时间线 */
  .tl{padding:14px 18px 22px;}
  .anni-scroll{display:flex;gap:10px;overflow-x:auto;padding-bottom:6px;}
  .anni-card{min-width:128px;background:var(--surface);border:1px solid var(--line);border-left:4px solid var(--accent);border-radius:16px;box-shadow:0 10px 24px rgba(31,29,27,.05);padding:14px 15px;}
  .anni-label{font-size:15px;font-weight:700;color:var(--ink);}
  .anni-date{font-size:12px;color:var(--accent);margin-top:8px;}
  .anni-city{font-size:11px;color:var(--muted);margin-top:4px;}
  .tl-item{display:flex;gap:12px;}
  .rail{flex:0 0 14px;display:flex;flex-direction:column;align-items:center;padding-top:8px;}
  .node{width:11px;height:11px;border-radius:50%;background:#fff;border:3px solid var(--accent);box-shadow:0 0 0 4px var(--accent-soft);}
  .line{flex:1;width:1.5px;background:var(--line2);margin-top:7px;}
  .tl-item:last-child .line{display:none;}
  .body{flex:1;margin-bottom:20px;overflow:hidden;}
  .cover{position:relative;height:150px;}
  .cover-shade{position:absolute;inset:0;background:linear-gradient(180deg,rgba(0,0,0,.08),rgba(0,0,0,0) 38%,rgba(0,0,0,.5));}
  .cover-top{position:absolute;top:12px;left:14px;right:14px;display:flex;justify-content:space-between;align-items:center;}
  .season{background:rgba(255,255,255,.92);color:var(--ink);font-size:10px;padding:3px 10px;border-radius:999px;}
  .date{color:#fff;font-size:12px;text-shadow:0 1px 5px rgba(0,0,0,.4);}
  .cover-city{position:absolute;left:15px;bottom:11px;color:#fff;font-size:30px;text-shadow:0 2px 9px rgba(0,0,0,.45);}
  .content{padding:14px 16px 16px;}
  .title{font-size:17px;font-weight:700;color:var(--ink);}
  .intro{font-size:13px;color:var(--ink2);line-height:1.7;margin-top:7px;}
  .tags{margin-top:10px;}.tags.meta{margin-top:12px;}
  .footer{text-align:center;color:var(--muted);font-size:12px;line-height:1.9;margin-top:24px;padding-top:20px;border-top:1px solid var(--line);}

  /* 详情 */
  .d-hero{position:relative;height:250px;}
  .d-hero-shade{position:absolute;inset:0;background:linear-gradient(180deg,rgba(0,0,0,.12),rgba(0,0,0,0) 40%,rgba(0,0,0,.55));}
  .d-hero-text{position:absolute;left:24px;right:24px;bottom:42px;color:#fff;}
  .d-prov{font-size:12px;letter-spacing:1px;opacity:.92;margin-bottom:6px;}
  .d-city{font-size:46px;line-height:1;text-shadow:0 4px 14px rgba(0,0,0,.45);}
  .d-date{font-size:13px;opacity:.92;margin-top:8px;}
  .sheet{position:relative;margin:-32px 14px 0;padding:24px 20px 26px;background:var(--surface);border:1px solid var(--line);border-radius:24px;box-shadow:0 -2px 2px rgba(31,29,27,.02),0 18px 40px rgba(31,29,27,.08);}
  .d-title{font-size:25px;font-weight:800;letter-spacing:-.5px;color:var(--ink);line-height:1.25;}
  .intro.big{color:var(--ink2);font-size:14px;line-height:1.85;margin:8px 0 0;}
  .photos{display:flex;flex-wrap:wrap;gap:9px;}
  .photo{position:relative;width:calc(50% - 4.5px);height:120px;border-radius:14px;overflow:hidden;}
  .photo-shade{position:absolute;inset:0;background:linear-gradient(180deg,rgba(0,0,0,0) 45%,rgba(0,0,0,.5));}
  .ptext{position:absolute;left:10px;right:10px;bottom:9px;color:#fff;text-shadow:0 1px 6px rgba(0,0,0,.4);}
  .pt{font-size:13px;font-weight:600;}.ps{font-size:10px;opacity:.9;margin-top:2px;}
  .note{background:var(--bg-el);border:1px solid var(--line);border-radius:14px;padding:13px 15px 13px 16px;font-size:13px;line-height:1.85;color:var(--ink2);margin-bottom:10px;}
  .quote{color:var(--accent);font-size:20px;font-weight:800;margin-right:3px;vertical-align:-4px;}
</style></head><body>
  <div class="phone"><div class="bar">Map of Us</div><div class="screen">
    <div class="head">
      <div class="kicker">OUR MAP</div>
      <div class="h1 display">Map of Us</div>
      <div class="hsub">我们的地图 \u00b7 一起走过的路</div>
      <div class="together">在一起 <span class="n">${days}</span> 天</div>
    </div>
    <div class="card stats">
      <div class="stat"><div class="num display">${stats.province}</div><div class="lab">省份</div></div><div class="vline"></div>
      <div class="stat"><div class="num display">${stats.city}</div><div class="lab">城市</div></div><div class="vline"></div>
      <div class="stat"><div class="num display">${stats.trip}</div><div class="lab">回忆</div></div>
    </div>
    <div class="block"><div class="blocktitle"><span class="sdot"></span>足迹地图
      <span class="legend"><span class="lg"><span class="sw p"></span>省份</span><span class="lg"><span class="sw c"></span>城市</span></span></div>
      <div class="card map-card">${mapSvg}</div>
    </div>
    <div class="block"><div class="blocktitle"><span class="sdot"></span>最近的回忆<span style="margin-left:auto;font-size:11px;color:var(--muted);font-weight:500">时间线 ›</span></div>
      <div class="recent">${recentHtml}</div>
    </div>
    <div style="height:24px"></div>
  </div></div>

  <div class="phone"><div class="bar">时间线</div><div class="screen"><div class="tl">
    <div class="head" style="padding:6px 6px 0"><div class="kicker">TIMELINE</div><div class="h1 display" style="font-size:34px">我们走过的日子</div><div class="hsub">${stats.trip} 段旅程 · 按时间回看</div></div>
    <div class="sec-title"><span class="sdot"></span>纪念日</div>
    <div class="anni-scroll">${anniCards}</div>
    <div class="sec-title"><span class="sdot"></span>旅程</div>
    ${tlHtml}
    <div class="footer">这张地图会跟着我们之后的<br>每一次出发，一点一点长大</div>
  </div></div></div>

  <div class="phone"><div class="bar">${d0.city}</div><div class="screen">
    ${detailHtml}
  </div></div>
</body></html>`

const out = path.join(__dirname, '..', 'preview.html')
fs.writeFileSync(out, html)
console.log('preview written to', out)
