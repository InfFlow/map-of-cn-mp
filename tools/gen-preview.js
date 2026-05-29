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
const pad = 48
function px(lng) {
  return pad + ((lng - minLng) / (maxLng - minLng)) * (W - 2 * pad)
}
function py(lat) {
  return pad + ((maxLat - lat) / (maxLat - minLat)) * (H - 2 * pad)
}
const polyPaths = polys
  .map((p) => {
    const d = p.points.map((pt, i) => `${i ? 'L' : 'M'}${px(pt.longitude).toFixed(1)},${py(pt.latitude).toFixed(1)}`).join(' ') + ' Z'
    return `<path d="${d}" fill="#ff5c8a26" stroke="#e85f81" stroke-width="1.2"/>`
  })
  .join('\n')
const markerEls = journeys
  .map((j) => {
    const x = px(j.longitude)
    const y = py(j.latitude)
    return `<g transform="translate(${x.toFixed(1)},${y.toFixed(1)})">
      <text x="0" y="0" font-size="20" text-anchor="middle" dominant-baseline="middle">\u2764\uFE0F</text>
      <text x="0" y="19" font-size="12.5" fill="#4a3640" text-anchor="middle" font-weight="700">${j.city}</text>
    </g>`
  })
  .join('\n')
const mapSvg = `<svg viewBox="0 0 ${W} ${H}" width="100%" xmlns="http://www.w3.org/2000/svg" style="display:block;background:linear-gradient(160deg,#fff7f3,#fdeef0)">${polyPaths}${markerEls}</svg>`

// ---- 时间线 ----
const anniCards = data.anniversaries
  .map(
    (a) => `<div class="anni-card">
      <div class="anni-mark">\u2661</div>
      <div class="anni-label">${a.label}</div>
      <div class="anni-date">${prettyDate(a.date)}</div>
      <div class="anni-city">${a.city}</div>
    </div>`,
  )
  .join('')
const tlHtml = journeys
  .map(
    (j) => `<div class="tl-item">
    <div class="rail"><div class="node">\u2665</div><div class="line"></div></div>
    <div class="card trip">
      <div class="cover" style="background:${toneGradient(j.coverTone)}">
        <div class="cover-shade"></div>
        <div class="cover-top"><span class="season">${j.season}</span><span class="date">${prettyDate(j.date)}</span></div>
        <div class="cover-city serif">${j.city}</div>
      </div>
      <div class="content">
        <div class="title serif">${j.title}</div>
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
      <div class="d-city serif">${d0.city}</div>
      <div class="d-date">${prettyDate(d0.date)}</div>
    </div>
  </div>
  <div class="sheet">
    <div class="title big serif">${d0.title}</div>
    <div class="tags meta"><span class="chip">\u2601 ${d0.weather}</span><span class="chip">\ud83d\udccd ${d0.landmark}</span></div>
    <div class="intro big">${d0.intro}</div>
    <div class="tags">${d0.tags.map((t) => `<span class="chip soft">#${t}</span>`).join('')}</div>
    <div class="sec-title">那天的画面</div>
    <div class="photos">
      ${d0.photos.map((p) => `<div class="photo" style="background:${toneGradient(p.tone)}"><div class="photo-shade"></div><div class="ptext"><div class="pt">${p.title}</div><div class="ps">${p.subtitle}</div></div></div>`).join('')}
    </div>
    <div class="sec-title">手记</div>
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
  :root{--rose:#ff8aa6;--rose-deep:#e85f81;--rose-soft:#ffe6ec;--gold:#d8a25a;--ink:#4a3640;--ink-soft:#a08791;--line:rgba(74,54,64,.08);--bg:#fdf6f2;}
  *{box-sizing:border-box;margin:0;padding:0;font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;}
  .serif{font-family:"Songti SC","STSong","SimSun",Georgia,serif;letter-spacing:.5px;}
  body{background:#f4e6e6;padding:34px;display:flex;gap:30px;justify-content:center;flex-wrap:wrap;align-items:flex-start;}
  .phone{width:340px;background:var(--bg);border-radius:40px;box-shadow:0 30px 70px rgba(232,95,129,.22);overflow:hidden;border:10px solid #fff;}
  .bar{background:#fffdfb;color:var(--ink);text-align:center;padding:14px;font-weight:700;font-size:15px;border-bottom:1px solid var(--line);}
  .screen{height:720px;overflow:auto;background:radial-gradient(120% 60% at 50% 0,#fdeef0,rgba(253,246,242,0) 60%),var(--bg);}
  .label{text-align:center;color:#b98aa0;font-weight:700;margin:12px 0;font-size:13px;}
  .card{background:#fffdfb;border-radius:20px;border:1px solid var(--line);box-shadow:0 14px 30px rgba(232,95,129,.1);}
  .chip{display:inline-flex;align-items:center;background:var(--rose-soft);color:var(--rose-deep);padding:4px 12px;border-radius:999px;font-size:11px;margin:0 8px 8px 0;}
  .chip.soft{background:#fff3ea;color:var(--gold);}
  .sec-title{display:flex;align-items:center;gap:8px;font-size:15px;font-weight:700;color:var(--ink);margin:24px 0 14px;}
  .sec-title::before{content:'';width:22px;height:4px;border-radius:4px;background:linear-gradient(90deg,var(--rose),var(--gold));}

  /* 首页 */
  .hero{position:relative;padding:34px 26px 50px;overflow:hidden;}
  .hero-bg{position:absolute;inset:0;background:radial-gradient(90% 120% at 85% -10%,#ffd9c2,rgba(255,217,194,0) 55%),radial-gradient(80% 100% at 0 0,#ffd0dd,rgba(255,208,221,0) 60%),linear-gradient(160deg,#ff9bb3,#ff7d9e 45%,#f07193);}
  .hero-bg::after{content:'';position:absolute;left:-10%;right:-10%;bottom:-2px;height:34px;background:var(--bg);border-radius:50% 50% 0 0/100% 100% 0 0;}
  .hero-in{position:relative;color:#fff;}
  .kicker{font-size:11px;letter-spacing:4px;opacity:.85;margin-bottom:8px;}
  .brand{font-size:38px;font-weight:700;line-height:1.05;text-shadow:0 4px 14px rgba(176,60,90,.35);}
  .hsub{font-size:13px;opacity:.92;margin-top:8px;}
  .together{display:inline-flex;align-items:baseline;gap:6px;margin-top:18px;padding:8px 16px;background:rgba(255,255,255,.22);border:1px solid rgba(255,255,255,.45);border-radius:999px;}
  .together .n{font-size:24px;font-weight:700;}.together .t{font-size:12px;opacity:.92;}
  .stats{display:flex;align-items:center;margin:-26px 18px 0;padding:18px 8px;position:relative;z-index:2;}
  .stat{flex:1;text-align:center;}
  .stat .num{font-size:26px;font-weight:700;color:var(--rose-deep);}
  .stat .lab{font-size:11px;color:var(--ink-soft);margin-top:6px;}
  .vdiv{width:1px;height:28px;background:var(--line);}
  .map-wrap{margin:22px 18px 0;}
  .map{margin-top:0;padding:8px;overflow:hidden;}
  .map svg{border-radius:14px;}
  .legend{display:flex;gap:8px;margin-top:-34px;margin-left:14px;position:relative;}
  .lg{display:inline-flex;align-items:center;gap:5px;background:rgba(255,255,255,.92);border:1px solid var(--line);border-radius:999px;padding:4px 10px;font-size:10px;color:var(--ink-soft);}
  .sw{width:11px;height:11px;border-radius:3px;display:inline-block;}
  .sw.p{background:rgba(255,92,138,.3);border:1px solid var(--rose-deep);}
  .sw.c{color:var(--rose-deep);font-size:11px;}
  .hint{text-align:center;font-size:11px;color:var(--ink-soft);margin-top:16px;}

  /* 时间线 */
  .tl{padding:0 18px 18px;}
  .anni-scroll{display:flex;gap:10px;overflow-x:auto;padding-bottom:6px;}
  .anni-card{min-width:140px;background:radial-gradient(120% 80% at 100% 0,#fff4e6,rgba(255,244,230,0) 60%),#fffdfb;border:1px solid var(--line);border-radius:18px;box-shadow:0 10px 24px rgba(232,95,129,.08);padding:14px 16px;}
  .anni-mark{color:var(--rose);font-size:16px;margin-bottom:6px;}
  .anni-label{font-size:15px;font-weight:700;color:var(--ink);}
  .anni-date{font-size:12px;color:var(--gold);margin-top:6px;}
  .anni-city{font-size:11px;color:var(--ink-soft);margin-top:2px;}
  .tl-item{display:flex;gap:11px;}
  .rail{flex:0 0 22px;display:flex;flex-direction:column;align-items:center;}
  .node{width:24px;height:24px;border-radius:50%;background:#fff;border:1.5px solid var(--rose);color:var(--rose-deep);font-size:12px;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 10px rgba(232,95,129,.2);}
  .line{flex:1;width:2px;background:linear-gradient(var(--rose-soft),rgba(255,230,236,.2));margin:4px 0;}
  .tl-item:last-child .line{display:none;}
  .trip{flex:1;margin-bottom:18px;overflow:hidden;}
  .cover{position:relative;height:130px;}
  .cover-shade{position:absolute;inset:0;background:linear-gradient(180deg,rgba(0,0,0,.05),rgba(0,0,0,0) 35%,rgba(0,0,0,.35));}
  .cover-top{position:absolute;top:12px;left:14px;right:14px;display:flex;justify-content:space-between;align-items:center;}
  .season{background:rgba(255,255,255,.9);color:var(--rose-deep);font-size:10px;padding:3px 10px;border-radius:999px;}
  .date{color:#fff;font-size:12px;text-shadow:0 1px 5px rgba(0,0,0,.4);}
  .cover-city{position:absolute;left:14px;bottom:9px;color:#fff;font-size:26px;font-weight:700;text-shadow:0 2px 8px rgba(0,0,0,.4);}
  .content{padding:13px 16px;}
  .title{font-size:17px;font-weight:700;color:var(--ink);}.title.big{font-size:22px;}
  .intro{font-size:13px;color:var(--ink-soft);line-height:1.7;margin-top:6px;}.intro.big{color:#6b5660;font-size:14px;margin:14px 0;}
  .tags{margin-top:10px;}.tags.meta{margin-top:14px;}

  /* 详情 */
  .d-hero{position:relative;height:240px;}
  .d-hero-shade{position:absolute;inset:0;background:linear-gradient(180deg,rgba(0,0,0,.1),rgba(0,0,0,0) 40%,rgba(0,0,0,.5));}
  .d-hero-text{position:absolute;left:22px;right:22px;bottom:40px;color:#fff;}
  .d-prov{font-size:12px;letter-spacing:1px;opacity:.92;margin-bottom:6px;}
  .d-city{font-size:42px;font-weight:700;line-height:1;text-shadow:0 4px 12px rgba(0,0,0,.45);}
  .d-date{font-size:13px;opacity:.92;margin-top:8px;}
  .sheet{position:relative;margin:-28px 14px 0;padding:24px 20px 26px;background:#fffdfb;border:1px solid var(--line);border-radius:22px;box-shadow:0 -6px 24px rgba(232,95,129,.08);}
  .photos{display:flex;flex-wrap:wrap;gap:9px;}
  .photo{position:relative;width:calc(50% - 4.5px);height:120px;border-radius:14px;overflow:hidden;}
  .photo-shade{position:absolute;inset:0;background:linear-gradient(180deg,rgba(0,0,0,0) 45%,rgba(0,0,0,.45));}
  .ptext{position:absolute;left:10px;right:10px;bottom:9px;color:#fff;text-shadow:0 1px 6px rgba(0,0,0,.4);}
  .pt{font-size:13px;font-weight:600;}.ps{font-size:10px;opacity:.9;margin-top:2px;}
  .note{position:relative;background:radial-gradient(120% 100% at 0 0,#fff4ec,rgba(255,244,236,0) 55%),#fffaf6;border:1px solid var(--line);border-left:3px solid var(--rose);border-radius:14px;padding:13px 15px 13px 17px;font-size:13px;line-height:1.8;color:#5f4b54;margin-bottom:10px;}
  .quote{color:var(--rose);font-size:22px;font-weight:700;margin-right:3px;vertical-align:-4px;}
</style></head><body>
  <div class="phone"><div class="bar">Map of Us</div><div class="screen">
    <div class="hero"><div class="hero-bg"></div><div class="hero-in">
      <div class="kicker">OUR JOURNEY</div>
      <div class="brand serif">Map of Us</div>
      <div class="hsub">我们的地图 \u00b7 一起走过的路</div>
      <div class="together"><span>\u2661</span><span class="t">在一起</span><span class="n serif">${days}</span><span class="t">天</span></div>
    </div></div>
    <div class="card stats">
      <div class="stat"><div class="num serif">${stats.province}</div><div class="lab">点亮省份</div></div><div class="vdiv"></div>
      <div class="stat"><div class="num serif">${stats.city}</div><div class="lab">点亮城市</div></div><div class="vdiv"></div>
      <div class="stat"><div class="num serif">${stats.trip}</div><div class="lab">段回忆</div></div>
    </div>
    <div class="map-wrap"><div class="sec-title">我们的足迹</div><div class="card map">${mapSvg}</div>
      <div class="legend"><span class="lg"><span class="sw p"></span>点亮省份</span><span class="lg"><span class="sw c">\u2665</span>城市回忆</span></div>
      <div class="hint">轻点地图上的爱心，回到那一天 \u203a</div>
    </div>
  </div></div>

  <div class="phone"><div class="bar">时间线</div><div class="screen"><div class="tl">
    <div class="sec-title" style="margin-top:18px">我们的纪念日</div>
    <div class="anni-scroll">${anniCards}</div>
    <div class="sec-title">旅程时间线</div>
    ${tlHtml}
  </div></div></div>

  <div class="phone"><div class="bar">${d0.city}</div><div class="screen">
    ${detailHtml}
  </div></div>
</body></html>`

const out = path.join(__dirname, '..', 'preview.html')
fs.writeFileSync(out, html)
console.log('preview written to', out)
