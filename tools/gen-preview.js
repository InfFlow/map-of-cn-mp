// 生成静态 HTML 预览（给用户看小程序三屏的视觉效果，不是小程序本体）
// 风格：黑白杂志极简（Kinfolk）——纸白底 + 墨黑字 + 衬线大标题 + 发丝线 + 编号列表
const fs = require('fs')
const path = require('path')
const { toneGradient, prettyDate } = require('../miniprogram/utils/util')

const data = require('C:/Users/Administrator/repos/journeys-live.json')
const polys = require('C:/Users/Administrator/repos/provinces-live.json')
const journeys = [...data.journeys].sort((a, b) => String(b.date).localeCompare(String(a.date)))

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

// ---- SVG 单色地图 ----
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
const H = 600
const pad = 46
const px = (lng) => pad + ((lng - minLng) / (maxLng - minLng)) * (W - 2 * pad)
const py = (lat) => pad + ((maxLat - lat) / (maxLat - minLat)) * (H - 2 * pad)
const polyPaths = polys
  .map((p) => {
    const d =
      p.points
        .map((pt, i) => `${i ? 'L' : 'M'}${px(pt.longitude).toFixed(1)},${py(pt.latitude).toFixed(1)}`)
        .join(' ') + ' Z'
    return `<path d="${d}" fill="#1b171214" stroke="#1b1712" stroke-width="1" stroke-opacity=".7"/>`
  })
  .join('\n')
function pinSvg(x, y) {
  const r = 9
  const tipY = y + 25
  return `<g><path d="M ${x - r} ${y} A ${r} ${r} 0 1 1 ${x + r} ${y} L ${x} ${tipY} Z" fill="#1b1712"/><circle cx="${x}" cy="${y}" r="3.6" fill="#f4f1ea"/></g>`
}
const markerEls = journeys
  .map((j) => {
    const x = px(j.longitude)
    const y = py(j.latitude) - 14
    return `${pinSvg(x, y)}<text x="${x.toFixed(1)}" y="${(y + 40).toFixed(1)}" font-size="13" fill="#1b1712" text-anchor="middle" font-weight="700">${j.city}</text>`
  })
  .join('\n')
const mapSvg = `<svg viewBox="0 0 ${W} ${H}" width="100%" xmlns="http://www.w3.org/2000/svg" style="display:block;background:#faf8f3">${polyPaths}${markerEls}</svg>`

const stats = {
  province: new Set(journeys.map((j) => j.province)).size,
  city: new Set(journeys.map((j) => j.city)).size,
  trip: journeys.length,
}
const days = daysTogether(data.anniversaries)

// ---- 首页 ----
const idxRows = journeys
  .slice(0, 6)
  .map(
    (j, i) => `<div class="idx-row">
      <div class="idx-no serif">${String(i + 1).padStart(2, '0')}</div>
      <div class="idx-mid"><div class="idx-city">${j.city}<span class="idx-season">${j.season}</span></div><div class="idx-title">${j.title}</div></div>
      <div class="idx-date">${j.date}</div>
    </div>`,
  )
  .join('')

const indexScreen = `
  <div class="pad">
    <div class="mast-row"><span class="mast-name">MAP OF US</span><span class="mast-vol">VOL.01</span></div>
    <div class="rule"></div>
    <div class="hero">
      <div class="kicker">我们走过的中国</div>
      <div class="h1 display">我们的<br>地图</div>
      <div class="lede">两个人，一座座点亮的城。在一起的第 <span class="em serif">${days}</span> 天。</div>
    </div>
    <div class="stats">
      <div class="stat"><div class="n display">${stats.province}</div><div class="l">省份</div></div>
      <div class="stat vr"><div class="n display">${stats.city}</div><div class="l">城市</div></div>
      <div class="stat vr"><div class="n display">${stats.trip}</div><div class="l">回忆</div></div>
    </div>
    <div class="sec"><span class="sec-zh">足迹地图</span><span class="sec-en">The Map</span></div>
    <div class="map-frame">${mapSvg}</div>
    <div class="sec mt"><span class="sec-zh">最近的回忆</span><span class="sec-en">Timeline ›</span></div>
    <div class="index-list">${idxRows}</div>
    <div class="hair mt2"></div>
    <div class="foot-txt">这张地图，跟着我们之后的每一次出发慢慢长大</div>
  </div>`

// ---- 时间线 ----
const anniCards = data.anniversaries
  .map(
    (a) => `<div class="anni">
      <div class="anni-date serif">${a.date}</div>
      <div class="anni-hair"></div>
      <div class="anni-label">${a.label}</div>
      <div class="anni-city">${a.city}</div>
    </div>`,
  )
  .join('')
const tlItems = journeys
  .map(
    (j, i) => `<div class="tl-item">
    <div class="tl-rail"><span class="tl-no serif">${String(i + 1).padStart(2, '0')}</span><div class="tl-line"></div></div>
    <div class="tl-body">
      <div class="tl-cover" style="background:${toneGradient(j.coverTone)}"></div>
      <div class="tl-meta"><span>${j.season}</span><span class="tl-dot">·</span><span>${j.date}</span></div>
      <div class="tl-city display">${j.city}</div>
      <div class="tl-title">${j.title}</div>
      <div class="tl-intro">${j.intro}</div>
      <div class="tl-tags">${j.tags.map((t) => `<span class="chip">${t}</span>`).join('')}</div>
    </div>
  </div>`,
  )
  .join('')
const timelineScreen = `
  <div class="pad">
    <div class="mast-row"><span class="mast-name">TIMELINE</span><span class="mast-vol">${journeys.length} TRIPS</span></div>
    <div class="rule"></div>
    <div class="hero"><div class="kicker">按时间回看</div><div class="h1 h1-sm display">我们走过<br>的日子</div></div>
    <div class="sec"><span class="sec-zh">纪念日</span><span class="sec-en">Milestones</span></div>
    <div class="anni-scroll">${anniCards}</div>
    <div class="sec mt"><span class="sec-zh">旅程</span><span class="sec-en">The Journeys</span></div>
    <div class="tl">${tlItems}</div>
    <div class="hair"></div>
    <div class="foot-txt">每一次出发，都会被这张地图记住</div>
  </div>`

// ---- 详情（最新一段） ----
const d0 = journeys[0]
const detailScreen = `
  <div class="pad">
    <div class="mast-row"><span class="mast-name">${d0.province}</span><span class="mast-vol">${d0.date}</span></div>
    <div class="rule"></div>
    <div class="d-head"><div class="kicker">${d0.season}</div><div class="d-city display">${d0.city}</div><div class="d-title serif">${d0.title}</div></div>
    <div class="d-cover" style="background:${toneGradient(d0.coverTone)}"></div>
    <div class="d-lede">${d0.intro}</div>
    <div class="d-facts">
      <div class="fact"><span class="fk">天气 / WEATHER</span><span class="fv">${d0.weather}</span></div>
      <div class="fact"><span class="fk">地标 / LANDMARK</span><span class="fv">${d0.landmark}</span></div>
    </div>
    <div class="d-tags">${d0.tags.map((t) => `<span class="chip">#${t}</span>`).join('')}</div>
    <div class="sec mt"><span class="sec-zh">那天的画面</span><span class="sec-en">Frames</span></div>
    <div class="photos">${d0.photos
      .map(
        (p) => `<div class="photo-cell"><div class="photo" style="background:${toneGradient(p.tone)}"></div><div class="photo-cap">${p.title}</div><div class="photo-sub">${p.subtitle || ''}</div></div>`,
      )
      .join('')}</div>
    <div class="sec mt"><span class="sec-zh">手记</span><span class="sec-en">Notes</span></div>
    ${d0.notes.map((n) => `<div class="note serif">${n}</div>`).join('')}
    <div class="hair mt2"></div>
    <div class="foot-txt sp">Map of Us · 我们的地图</div>
  </div>`

const html = `<!doctype html><html lang="zh"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Map of Us 小程序预览 · 黑白杂志极简</title>
<style>
  :root{--bg:#f4f1ea;--paper:#faf8f3;--ink:#1b1712;--ink2:#5b5447;--muted:#8c8475;--faint:#b1a892;--line:rgba(27,23,18,.13);}
  *{box-sizing:border-box;margin:0;padding:0;font-family:-apple-system,"SF Pro Text","PingFang SC","Microsoft YaHei",sans-serif;-webkit-font-smoothing:antialiased;}
  .serif,.display{font-family:Georgia,"Times New Roman","Songti SC","STSong",serif;}
  .display{font-weight:700;letter-spacing:-.3px;}
  body{background:#e7e1d6;padding:34px;display:flex;gap:30px;justify-content:center;flex-wrap:wrap;align-items:flex-start;}
  .col{display:flex;flex-direction:column;align-items:center;}
  .label{color:#6f6657;font-weight:700;margin-bottom:12px;font-size:12px;letter-spacing:2px;}
  .phone{width:344px;background:var(--bg);border-radius:42px;box-shadow:0 30px 70px rgba(27,23,18,.22);overflow:hidden;border:10px solid #fff;}
  .bar{background:var(--bg);color:var(--ink);text-align:center;padding:13px;font-weight:600;font-size:14px;}
  .screen{height:706px;overflow:auto;background:var(--bg);}
  .pad{padding:14px 20px 30px;}
  .rule{height:1.5px;background:var(--ink);margin-top:6px;}
  .hair{height:1px;background:var(--line);}
  .mt{margin-top:26px;} .mt2{margin-top:30px;}
  .mast-row{display:flex;justify-content:space-between;align-items:baseline;}
  .mast-name{font-size:11px;font-weight:700;letter-spacing:3px;}
  .mast-vol{font-size:10px;font-weight:700;letter-spacing:1.5px;color:var(--muted);}
  .kicker{font-size:10px;font-weight:700;letter-spacing:3px;color:var(--muted);text-transform:uppercase;}
  /* 栏目标题 */
  .sec{display:flex;align-items:baseline;justify-content:space-between;border-bottom:1.5px solid var(--ink);padding-bottom:7px;margin:22px 0 14px;}
  .sec-zh{font-family:Georgia,"Songti SC",serif;font-size:17px;font-weight:700;}
  .sec-en{font-size:10px;font-weight:700;letter-spacing:1.5px;color:var(--muted);text-transform:uppercase;}
  .chip{display:inline-flex;align-items:center;color:var(--ink2);border:1px solid var(--line);padding:3px 9px;border-radius:3px;font-size:11px;margin:0 6px 6px 0;}
  /* 首页 */
  .hero{padding:22px 0 2px;}
  .h1{font-size:55px;line-height:.96;margin-top:10px;}
  .h1-sm{font-size:44px;}
  .lede{font-size:14px;line-height:1.8;color:var(--ink2);margin-top:14px;max-width:250px;}
  .lede .em{font-style:italic;font-weight:700;color:var(--ink);font-size:16px;}
  .stats{display:flex;border-top:1px solid var(--line);border-bottom:1px solid var(--line);margin-top:20px;}
  .stat{flex:1;text-align:center;padding:16px 0 14px;position:relative;}
  .stat.vr::before{content:"";position:absolute;left:0;top:16px;bottom:14px;width:1px;background:var(--line);}
  .stat .n{font-size:33px;line-height:1;}
  .stat .l{font-size:11px;letter-spacing:2px;color:var(--muted);margin-top:6px;}
  .map-frame{border:1px solid var(--line);padding:6px;background:var(--paper);}
  .index-list{}
  .idx-row{display:flex;align-items:center;gap:13px;padding:13px 0;border-bottom:1px solid var(--line);}
  .idx-row:last-child{border-bottom:0;}
  .idx-no{font-size:15px;font-weight:700;color:var(--faint);width:24px;}
  .idx-mid{flex:1;min-width:0;}
  .idx-city{font-size:15px;font-weight:700;display:flex;align-items:baseline;gap:7px;}
  .idx-season{font-size:10px;font-weight:500;color:var(--muted);letter-spacing:1px;}
  .idx-title{font-size:12px;color:var(--ink2);margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
  .idx-date{font-size:11px;color:var(--muted);}
  .foot-txt{margin-top:14px;text-align:center;font-size:12px;color:var(--muted);}
  .foot-txt.sp{letter-spacing:2px;}
  /* 时间线 */
  .anni-scroll{display:flex;gap:11px;overflow-x:auto;padding-bottom:4px;}
  .anni{min-width:150px;border:1px solid var(--line);background:var(--paper);padding:13px 14px 15px;}
  .anni-date{font-size:17px;font-weight:700;}
  .anni-hair{height:1px;background:var(--ink);width:24px;margin:8px 0;}
  .anni-label{font-size:13px;font-weight:700;}
  .anni-city{font-size:11px;color:var(--muted);margin-top:4px;letter-spacing:1px;}
  .tl-item{display:flex;gap:12px;padding-bottom:22px;}
  .tl-rail{flex:0 0 28px;display:flex;flex-direction:column;align-items:center;}
  .tl-no{font-size:15px;font-weight:700;color:var(--faint);}
  .tl-line{width:1px;flex:1;background:var(--line);margin-top:6px;}
  .tl-item:last-child .tl-line{background:transparent;}
  .tl-body{flex:1;min-width:0;border-bottom:1px solid var(--line);padding-bottom:18px;}
  .tl-cover{width:100%;height:165px;}
  .tl-meta{display:flex;align-items:center;gap:6px;margin-top:11px;font-size:10px;letter-spacing:1px;color:var(--muted);}
  .tl-dot{color:var(--faint);}
  .tl-city{font-size:24px;line-height:1.1;margin-top:4px;}
  .tl-title{font-size:14px;font-weight:700;margin-top:6px;}
  .tl-intro{font-size:12px;color:var(--ink2);line-height:1.7;margin-top:5px;}
  .tl-tags{margin-top:9px;}
  /* 详情 */
  .d-head{padding:18px 0 2px;}
  .d-city{font-size:46px;line-height:1;margin-top:7px;}
  .d-title{font-size:16px;font-weight:700;color:var(--ink2);margin-top:9px;}
  .d-cover{width:100%;height:240px;margin-top:15px;}
  .d-lede{font-size:14px;line-height:1.9;margin-top:17px;}
  .d-facts{margin-top:16px;border-top:1px solid var(--line);}
  .fact{display:flex;justify-content:space-between;align-items:baseline;padding:11px 0;border-bottom:1px solid var(--line);}
  .fk{font-size:10px;letter-spacing:1px;color:var(--muted);}
  .fv{font-size:13px;font-weight:700;}
  .d-tags{margin-top:14px;}
  .photos{display:flex;flex-wrap:wrap;gap:11px;}
  .photo-cell{width:calc((100% - 11px)/2);}
  .photo{width:100%;height:120px;border:1px solid var(--line);}
  .photo-cap{font-size:12px;font-weight:700;margin-top:7px;}
  .photo-sub{font-size:10px;color:var(--muted);margin-top:2px;}
  .note{font-size:14px;line-height:1.95;padding:12px 0 12px 15px;border-bottom:1px solid var(--line);position:relative;}
  .note::before{content:"\\201C";position:absolute;left:-2px;top:6px;font-size:28px;color:var(--faint);font-family:Georgia,serif;}
</style></head>
<body>
  <div class="col"><div class="label">首页 INDEX</div><div class="phone"><div class="bar">我们的地图</div><div class="screen">${indexScreen}</div></div></div>
  <div class="col"><div class="label">时间线 TIMELINE</div><div class="phone"><div class="bar">时间线</div><div class="screen">${timelineScreen}</div></div></div>
  <div class="col"><div class="label">详情 DETAIL</div><div class="phone"><div class="bar">${d0.city}</div><div class="screen">${detailScreen}</div></div></div>
</body></html>`

fs.writeFileSync(path.join(__dirname, '..', 'preview.html'), html)
console.log('preview.html written')
