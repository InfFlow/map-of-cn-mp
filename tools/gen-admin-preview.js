// 生成「管理后台」三屏静态预览（菜品 / 分类 / 订单）——黑白杂志极简 Kinfolk。
// 菜品/分类用真实菜单数据渲染；订单用示例数据演示状态流转。仅用于给用户看视觉效果。
const fs = require('fs')
const path = require('path')

const menu = require('./menu-live.json')
const cats = menu.categories || []
const spicyLabel = ['', '微辣', '中辣', '重辣']
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))

const badges = (d, available = true) => {
  let h = ''
  if (d.recommended) h += '<span class="bdg rec">推荐</span>'
  if (d.spicy) h += `<span class="bdg">${spicyLabel[d.spicy] || '辣'}</span>`
  if (d.portion) h += `<span class="bdg">${esc(d.portion)}</span>`
  if (!available) h += '<span class="bdg muted">已下架</span>'
  return h ? `<div class="d-badges">${h}</div>` : ''
}

const ops = (extra) => `<div class="d-ops">
  <div class="op-move"><span class="mv">↑</span><span class="mv">↓</span></div>
  ${extra}
</div>`

// ---------- 菜品 tab（选中第一个分类）----------
const firstCat = cats[0] || { name: '', dishes: [] }
const dishCards = firstCat.dishes
  .map((d, i) => {
    const available = i !== firstCat.dishes.length - 1 // 演示：最后一道为下架态
    return `<div class="d-card ${available ? '' : 'off'}">
      <div class="d-thumb"><span class="d-thumb-ph serif">${esc(d.name[0])}</span></div>
      <div class="d-mid">
        <div class="d-name serif">${esc(d.name)}</div>
        ${badges(d, available)}
        ${d.description ? `<div class="d-desc">${esc(d.description)}</div>` : ''}
        <div class="d-price serif">${d.price > 0 ? '¥' + d.price : '随意'}</div>
      </div>
      ${ops(`<span class="op">${available ? '下架' : '上架'}</span><span class="op">编辑</span><span class="op del">删除</span>`)}
    </div>`
  })
  .join('')

const catBar = cats.map((c, i) => `<span class="catchip ${i === 0 ? 'on' : ''}">${esc(c.name)}</span>`).join('')

const dishesScreen = `
  <div class="pad">
    <div class="mast-row"><span class="mast-name">MAP OF INTL</span><span class="mast-vol">ADMIN</span></div>
    <div class="rule"></div>
    <div class="tabs"><span class="tab on">菜品</span><span class="tab">分类</span><span class="tab">订单</span></div>
    <div class="catbar2">${catBar}</div>
    ${dishCards}
    <div class="add-btn">＋ 新增菜品</div>
  </div>`

// ---------- 分类 tab ----------
const catRows = cats
  .map((c, i) => {
    const hidden = i === cats.length - 1 // 演示：最后一个为隐藏态
    return `<div class="c-row ${hidden ? 'off' : ''}">
      <div class="c-mid"><span class="c-name serif">${esc(c.name)}</span>${hidden ? '<span class="bdg muted">已隐藏</span>' : ''}</div>
      <div class="c-ops">
        <div class="op-move"><span class="mv">↑</span><span class="mv">↓</span></div>
        <span class="op">${hidden ? '显示' : '隐藏'}</span><span class="op">改名</span><span class="op del">删除</span>
      </div>
    </div>`
  })
  .join('')

const categoriesScreen = `
  <div class="pad">
    <div class="mast-row"><span class="mast-name">MAP OF INTL</span><span class="mast-vol">ADMIN</span></div>
    <div class="rule"></div>
    <div class="tabs"><span class="tab">菜品</span><span class="tab on">分类</span><span class="tab">订单</span></div>
    <div class="cat-list">${catRows}</div>
    <div class="add-btn">＋ 新增分类</div>
  </div>`

// ---------- 订单 tab（示例数据）----------
const orders = [
  { date: '05.30 18:33', who: '念念', status: 'pending', label: '待处理', sum: '番茄炒蛋×2、红烧排骨×1、米饭×2', remark: '今晚七点左右吃，想喝点汤～', count: 5, total: 66 },
  { date: '05.28 12:10', who: '念念', status: 'accepted', label: '已接单', sum: '青椒土豆丝×1、紫菜蛋花汤×1', remark: '', count: 2, total: 18 },
  { date: '05.20 19:02', who: '念念', status: 'done', label: '已完成', sum: '红烧排骨×1、米饭×2', remark: '少放盐', count: 3, total: 42 },
]
const orderCards = orders
  .map(
    (o) => `<div class="o-card">
      <div class="o-top"><span class="o-date serif">${o.date}</span><span class="o-status s-${o.status}">${o.label} ▾</span></div>
      <div class="o-who">${esc(o.who)}</div>
      <div class="o-sum">${esc(o.sum)}</div>
      ${o.remark ? `<div class="o-note">「${esc(o.remark)}」</div>` : ''}
      <div class="o-foot"><span class="o-count">${o.count} 份</span><span class="o-total serif">¥${o.total}</span></div>
    </div>`,
  )
  .join('')

const ordersScreen = `
  <div class="pad">
    <div class="mast-row"><span class="mast-name">MAP OF INTL</span><span class="mast-vol">ADMIN</span></div>
    <div class="rule"></div>
    <div class="tabs"><span class="tab">菜品</span><span class="tab">分类</span><span class="tab on">订单</span></div>
    <div class="order-list">${orderCards}</div>
  </div>`

const css = `
  :root{--bg:#f4f1ea;--paper:#faf8f3;--surface:#fff;--ink:#1b1712;--ink2:#5b5447;--muted:#8c8475;--faint:#b1a892;--line:rgba(27,23,18,.13);--line-soft:rgba(27,23,18,.07);}
  *{box-sizing:border-box;margin:0;padding:0;font-family:-apple-system,"SF Pro Text","PingFang SC","Microsoft YaHei",sans-serif;-webkit-font-smoothing:antialiased;}
  .serif{font-family:Georgia,"Times New Roman","Songti SC","STSong",serif;}
  body{background:#e7e1d6;padding:34px;display:flex;gap:30px;justify-content:center;flex-wrap:wrap;align-items:flex-start;}
  .col{display:flex;flex-direction:column;align-items:center;}
  .label{color:#6f6657;font-weight:700;margin-bottom:12px;font-size:12px;letter-spacing:2px;}
  .phone{position:relative;width:344px;background:var(--bg);border-radius:42px;box-shadow:0 30px 70px rgba(27,23,18,.22);overflow:hidden;border:10px solid #fff;}
  .bar{background:var(--bg);color:var(--ink);text-align:center;padding:13px;font-weight:600;font-size:14px;}
  .screen{height:706px;overflow:auto;background:var(--bg);}
  .pad{padding:14px 20px 30px;}
  .rule{height:1.5px;background:var(--ink);margin-top:6px;position:relative;}
  .rule::after{content:"";position:absolute;left:0;right:0;top:5px;height:1px;background:var(--line);}
  .mast-row{display:flex;justify-content:space-between;align-items:baseline;}
  .mast-name{font-size:11px;font-weight:700;letter-spacing:3px;}
  .mast-vol{font-size:10px;font-weight:700;letter-spacing:1.5px;color:var(--muted);}
  /* tabs */
  .tabs{display:flex;gap:8px;margin:18px 0 16px;}
  .tab{flex:1;text-align:center;padding:9px 0;font-size:13px;letter-spacing:1px;border:1px solid var(--line);background:var(--surface);color:var(--ink2);}
  .tab.on{background:var(--ink);border-color:var(--ink);color:var(--bg);font-weight:700;}
  /* badges */
  .bdg{display:inline-block;font-size:9.5px;letter-spacing:.5px;padding:1px 7px;margin-right:5px;border:1px solid var(--line);color:var(--ink2);}
  .bdg.rec{background:var(--ink);color:var(--bg);border-color:var(--ink);font-weight:700;}
  .bdg.muted{color:var(--faint);border-style:dashed;}
  /* 分类筛选 */
  .catbar2{white-space:nowrap;overflow:auto;margin-bottom:14px;}
  .catchip{display:inline-block;padding:6px 14px;margin-right:7px;font-size:12px;border:1px solid var(--line);color:var(--ink2);background:var(--surface);}
  .catchip.on{background:var(--ink);color:var(--bg);border-color:var(--ink);}
  /* 菜品卡 */
  .d-card{display:flex;gap:12px;background:var(--surface);border:1px solid var(--line);padding:12px;margin-bottom:12px;}
  .d-card.off{opacity:.55;}
  .d-thumb{width:60px;height:60px;flex:0 0 auto;border:1px solid var(--line);background:var(--paper);display:flex;align-items:center;justify-content:center;}
  .d-thumb-ph{font-size:26px;color:var(--faint);}
  .d-mid{flex:1;min-width:0;}
  .d-name{font-size:15.5px;font-weight:700;}
  .d-badges{margin:5px 0 3px;}
  .d-desc{font-size:11.5px;color:var(--muted);margin-top:2px;}
  .d-price{font-size:14px;font-weight:700;margin-top:5px;}
  .d-ops{display:flex;flex-direction:column;align-items:flex-end;gap:6px;flex:0 0 auto;}
  .c-ops{display:flex;align-items:center;gap:6px;flex:0 0 auto;}
  .op-move{display:flex;gap:5px;}
  .mv{width:24px;height:24px;line-height:22px;text-align:center;border:1px solid var(--line);font-size:13px;color:var(--ink2);}
  .op{font-size:11.5px;color:var(--ink2);border:1px solid var(--line);padding:3px 10px;}
  .op.del{color:#9a2e2e;border-color:rgba(154,46,46,.3);}
  /* 分类行 */
  .c-row{display:flex;align-items:center;justify-content:space-between;background:var(--surface);border:1px solid var(--line);padding:14px 12px;margin-bottom:10px;}
  .c-row.off{opacity:.55;}
  .c-mid{display:flex;align-items:center;gap:9px;min-width:0;flex:1;}
  .c-name{font-size:16px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
  .c-ops .op{padding:3px 8px;}
  .c-ops .mv{width:22px;}
  /* add btn */
  .add-btn{margin-top:18px;text-align:center;border:1.5px dashed var(--line);padding:14px;font-size:13.5px;color:var(--ink2);letter-spacing:1px;}
  /* 订单 */
  .o-card{background:var(--surface);border:1px solid var(--line);padding:14px;margin-bottom:12px;}
  .o-top{display:flex;align-items:center;justify-content:space-between;}
  .o-date{font-size:15px;font-weight:700;}
  .o-status{font-size:11px;padding:3px 10px;border:1px solid var(--line);color:var(--ink2);}
  .o-status.s-done{background:var(--ink);color:var(--bg);border-color:var(--ink);}
  .o-who{font-size:11px;color:var(--muted);margin-top:7px;}
  .o-sum{font-size:13.5px;margin-top:5px;color:var(--ink2);}
  .o-note{font-size:12px;color:var(--muted);font-style:italic;margin-top:4px;}
  .o-foot{display:flex;align-items:baseline;justify-content:space-between;margin-top:10px;padding-top:8px;border-top:1px solid var(--line-soft);}
  .o-count{font-size:11px;color:var(--muted);}
  .o-total{font-size:16px;font-weight:700;}
`

const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>Map of intl · 管理后台预览</title><style>${css}</style></head><body>
  <div class="col"><div class="label">管理 · 菜品</div><div class="phone"><div class="bar">后台管理</div><div class="screen">${dishesScreen}</div></div></div>
  <div class="col"><div class="label">管理 · 分类</div><div class="phone"><div class="bar">后台管理</div><div class="screen">${categoriesScreen}</div></div></div>
  <div class="col"><div class="label">管理 · 订单</div><div class="phone"><div class="bar">后台管理</div><div class="screen">${ordersScreen}</div></div></div>
</body></html>`

const out = path.join(__dirname, '..', 'preview-admin.html')
fs.writeFileSync(out, html)
console.log('wrote', out)
