// 生成「菜单 / 确认点单 / 我的」三屏静态预览（黑白杂志极简 Kinfolk）
// 用真实菜单数据渲染，仅用于给用户看视觉效果，不是小程序本体。
const fs = require('fs')
const path = require('path')

const menu = require('./menu-live.json')
const cats = menu.categories || []

// 模拟一份已选购物车与一条历史订单，用于演示
const cart = [
  { name: '番茄炒蛋', price: 12, qty: 2, remark: '多番茄' },
  { name: '红烧排骨', price: 38, qty: 1, remark: '' },
  { name: '米饭', price: 2, qty: 2, remark: '' },
]
const cartCount = cart.reduce((s, i) => s + i.qty, 0)
const cartTotal = cart.reduce((s, i) => s + i.qty * i.price, 0)

const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))

// ---- 菜单页 ----
const catBar = cats
  .map((c, i) => `<span class="catchip ${i === 0 ? 'on' : ''}">${esc(c.name)}</span>`)
  .join('')

const catSections = cats
  .map((c) => {
    const rows = c.dishes
      .map((d) => {
        const qty = cart.find((x) => x.name === d.name)
        const stepper = qty
          ? `<span class="step minus">−</span><span class="step-qty serif">${qty.qty}</span><span class="step plus">＋</span>`
          : `<span class="step plus">＋</span>`
        return `<div class="dish">
          <div class="dish-thumb ph"><span class="dish-thumb-ph serif">${esc(d.name[0])}</span></div>
          <div class="dish-mid">
            <div class="dish-name serif">${esc(d.name)}</div>
            ${d.description ? `<div class="dish-desc">${esc(d.description)}</div>` : ''}
            <div class="dish-price serif">${d.price > 0 ? '¥' + d.price : '随意'}</div>
          </div>
          <div class="stepper">${stepper}</div>
        </div>`
      })
      .join('')
    return `<div class="sec"><span class="sec-zh">${esc(c.name)}</span><span class="sec-en">${c.dishes.length} 道</span></div>${rows}`
  })
  .join('')

const menuScreen = `
  <div class="pad">
    <div class="mast-row"><span class="mast-name">MAP OF US</span><span class="mast-vol">MENU</span></div>
    <div class="rule"></div>
    <div class="hero">
      <div class="kicker">为你下厨</div>
      <div class="h1 display">今天<br>想吃什么</div>
      <div class="lede">挑几道想吃的，写上备注，交给我来做。</div>
    </div>
    <div class="catbar">${catBar}</div>
    ${catSections}
    <div class="hair" style="margin-top:24px"></div>
    <div class="foot-txt">想吃的都点上 · 不必客气</div>
  </div>
  <div class="cartbar"><div class="cart-info"><span class="cart-count">已选 ${cartCount} 份</span><span class="cart-total serif">合计 ¥${cartTotal}</span></div><span class="cart-go">去点单 ›</span></div>`

// ---- 确认点单页 ----
const orderItems = cart
  .map(
    (i) => `<div class="oitem">
      <div class="oitem-top"><span class="oitem-name serif">${esc(i.name)}</span><span class="stepper"><span class="step minus">−</span><span class="step-qty serif">${i.qty}</span><span class="step plus">＋</span></span></div>
      <div class="oitem-sub"><span class="oitem-price serif">${i.price > 0 ? '¥' + i.price : '随意'}</span><span class="oitem-remark ${i.remark ? '' : 'empty'}">${i.remark ? esc(i.remark) : '备注，如：少辣 / 多放糖'}</span></div>
    </div>`,
  )
  .join('')

const orderScreen = `
  <div class="pad">
    <div class="mast-row"><span class="mast-name">MAP OF US</span><span class="mast-vol">ORDER</span></div>
    <div class="rule"></div>
    <div class="hero"><div class="kicker">确认这一桌</div><div class="h1 display">点单</div></div>
    <div class="sec"><span class="sec-zh">已选菜品</span><span class="sec-en">${cart.length} 项</span></div>
    ${orderItems}
    <div class="sec mt"><span class="sec-zh">给大厨的话</span><span class="sec-en">NOTE</span></div>
    <div class="note">今晚七点左右吃，想喝点汤～</div>
  </div>
  <div class="submitbar"><span class="sb-total serif">合计 ¥${cartTotal}</span><span class="sb-btn">提交点单</span></div>`

// ---- 我的页（已登录 + 一条历史订单）----
const mineScreen = `
  <div class="pad">
    <div class="mast-row"><span class="mast-name">MAP OF US</span><span class="mast-vol">MINE</span></div>
    <div class="rule"></div>
    <div class="profile"><div class="avatar serif">念</div><div class="profile-mid"><div class="profile-name serif">念念</div><div class="profile-id">已用微信登录</div></div></div>
    <div class="sec mt"><span class="sec-zh">昵称</span><span class="sec-en">NAME</span></div>
    <div class="name-row"><span class="name-input">念念</span><span class="name-save">保存</span></div>
    <div class="sec mt"><span class="sec-zh">我的点菜</span><span class="sec-en">ORDERS</span></div>
    <div class="ocard">
      <div class="ocard-top"><span class="ocard-date serif">05.30 18:33</span><span class="ocard-status">待处理</span></div>
      <div class="ocard-sum">番茄炒蛋×2、红烧排骨×1、米饭×2</div>
      <div class="ocard-note">「今晚七点左右吃，想喝点汤～」</div>
      <div class="ocard-foot"><span class="ocard-count">5 份</span><span class="ocard-total serif">¥66</span></div>
    </div>
    <div class="ocard">
      <div class="ocard-top"><span class="ocard-date serif">05.20 12:10</span><span class="ocard-status on">已完成</span></div>
      <div class="ocard-sum">青椒土豆丝×1、西红柿鸡蛋汤×1</div>
      <div class="ocard-foot"><span class="ocard-count">2 份</span><span class="ocard-total serif">¥18</span></div>
    </div>
  </div>`

const css = `
  :root{--bg:#f4f1ea;--paper:#faf8f3;--surface:#fff;--ink:#1b1712;--ink2:#5b5447;--muted:#8c8475;--faint:#b1a892;--line:rgba(27,23,18,.13);--line-soft:rgba(27,23,18,.07);}
  *{box-sizing:border-box;margin:0;padding:0;font-family:-apple-system,"SF Pro Text","PingFang SC","Microsoft YaHei",sans-serif;-webkit-font-smoothing:antialiased;}
  .serif,.display{font-family:Georgia,"Times New Roman","Songti SC","STSong",serif;}
  .display{font-weight:700;letter-spacing:-.3px;}
  body{background:#e7e1d6;padding:34px;display:flex;gap:30px;justify-content:center;flex-wrap:wrap;align-items:flex-start;}
  .col{display:flex;flex-direction:column;align-items:center;}
  .label{color:#6f6657;font-weight:700;margin-bottom:12px;font-size:12px;letter-spacing:2px;}
  .phone{position:relative;width:344px;background:var(--bg);border-radius:42px;box-shadow:0 30px 70px rgba(27,23,18,.22);overflow:hidden;border:10px solid #fff;}
  .bar{background:var(--bg);color:var(--ink);text-align:center;padding:13px;font-weight:600;font-size:14px;}
  .screen{height:706px;overflow:auto;background:var(--bg);position:relative;}
  .pad{padding:14px 20px 90px;}
  .rule{height:1.5px;background:var(--ink);margin-top:6px;position:relative;}
  .rule::after{content:"";position:absolute;left:0;right:0;top:5px;height:1px;background:var(--line);}
  .hair{height:1px;background:var(--line);}
  .mt{margin-top:24px;}
  .mast-row{display:flex;justify-content:space-between;align-items:baseline;}
  .mast-name{font-size:11px;font-weight:700;letter-spacing:3px;}
  .mast-vol{font-size:10px;font-weight:700;letter-spacing:1.5px;color:var(--muted);}
  .kicker{font-size:10px;font-weight:700;letter-spacing:3px;color:var(--muted);text-transform:uppercase;}
  .sec{display:flex;align-items:baseline;justify-content:space-between;border-bottom:1.5px solid var(--ink);padding-bottom:7px;margin:25px 0 8px;}
  .sec-zh{font-family:Georgia,"Songti SC",serif;font-size:17px;font-weight:700;}
  .sec-en{font-size:10px;font-weight:700;letter-spacing:1.5px;color:var(--muted);text-transform:uppercase;}
  .hero{padding:22px 0 2px;}
  .h1{font-size:52px;line-height:.98;margin-top:10px;}
  .lede{font-size:14px;line-height:1.8;color:var(--ink2);margin-top:14px;max-width:250px;}
  /* 分类导航 */
  .catbar{margin:20px -20px 0;padding:8px 20px;border-bottom:1px solid var(--line);white-space:nowrap;overflow:auto;}
  .catchip{display:inline-block;font-size:12.5px;color:var(--muted);margin-right:18px;position:relative;padding:4px 3px;}
  .catchip.on{color:var(--ink);font-weight:700;}
  .catchip.on::after{content:"";position:absolute;left:3px;right:3px;bottom:-9px;height:1.5px;background:var(--ink);}
  /* 菜品行 */
  .dish{display:flex;align-items:center;padding:13px 0;border-bottom:1px solid var(--line-soft);}
  .dish-thumb{width:66px;height:66px;flex:0 0 auto;border:1px solid var(--line);margin-right:13px;display:flex;align-items:center;justify-content:center;background:var(--paper);}
  .dish-thumb-ph{font-size:28px;color:var(--faint);}
  .dish-mid{flex:1;min-width:0;}
  .dish-name{font-size:16px;font-weight:700;letter-spacing:-.3px;}
  .dish-desc{font-size:12px;color:var(--muted);margin-top:3px;}
  .dish-price{font-size:13.5px;color:var(--ink2);margin-top:6px;}
  .stepper{display:flex;align-items:center;flex:0 0 auto;margin-left:9px;}
  .step{width:28px;height:28px;display:flex;align-items:center;justify-content:center;border:1px solid var(--ink);font-size:18px;line-height:1;color:var(--ink);background:var(--surface);}
  .step.plus{background:var(--ink);color:var(--bg);}
  .step-qty{min-width:26px;text-align:center;font-size:15px;font-weight:700;}
  .foot-txt{margin-top:12px;text-align:center;font-size:11px;color:var(--faint);letter-spacing:.5px;}
  /* 购物车条 */
  .cartbar{position:absolute;left:14px;right:14px;bottom:16px;display:flex;align-items:center;justify-content:space-between;padding:11px 14px;background:var(--ink);color:var(--bg);}
  .cart-info{display:flex;align-items:baseline;gap:11px;}
  .cart-count{font-size:13px;}
  .cart-total{font-size:15px;font-weight:700;}
  .cart-go{font-size:13.5px;font-weight:700;letter-spacing:1px;border:1px solid var(--bg);padding:6px 13px;}
  /* 确认点单 */
  .oitem{padding:13px 0;border-bottom:1px solid var(--line-soft);}
  .oitem-top{display:flex;align-items:center;justify-content:space-between;}
  .oitem-name{font-size:16px;font-weight:700;letter-spacing:-.3px;}
  .oitem-sub{display:flex;align-items:center;margin-top:8px;gap:11px;}
  .oitem-price{font-size:13px;color:var(--ink2);flex:0 0 auto;}
  .oitem-remark{flex:1;font-size:12.5px;color:var(--ink);padding:6px 9px;background:var(--paper);border:1px solid var(--line-soft);}
  .oitem-remark.empty{color:var(--faint);}
  .note{font-size:14px;line-height:1.7;color:var(--ink2);padding:11px;background:var(--paper);border:1px solid var(--line);margin-top:6px;min-height:60px;}
  .submitbar{position:absolute;left:14px;right:14px;bottom:16px;display:flex;align-items:center;justify-content:space-between;padding:10px 11px 10px 15px;background:var(--surface);border:1px solid var(--ink);}
  .sb-total{font-size:16px;font-weight:700;}
  .sb-btn{background:var(--ink);color:var(--bg);font-size:14px;font-weight:700;letter-spacing:1.5px;padding:9px 21px;}
  /* 我的 */
  .profile{display:flex;align-items:center;padding:24px 0 4px;}
  .avatar{width:62px;height:62px;flex:0 0 auto;display:flex;align-items:center;justify-content:center;background:var(--ink);color:var(--bg);font-size:30px;font-weight:700;margin-right:15px;}
  .profile-name{font-size:23px;font-weight:700;letter-spacing:-.3px;}
  .profile-id{margin-top:4px;font-size:11px;color:var(--muted);letter-spacing:.5px;}
  .name-row{display:flex;align-items:center;gap:9px;margin-top:6px;}
  .name-input{flex:1;font-size:14px;color:var(--ink);padding:9px 10px;background:var(--paper);border:1px solid var(--line);}
  .name-save{flex:0 0 auto;background:var(--ink);color:var(--bg);font-size:13px;letter-spacing:1px;padding:9px 16px;}
  .ocard{border:1px solid var(--line);padding:14px 13px;margin-top:11px;background:var(--surface);}
  .ocard-top{display:flex;align-items:center;justify-content:space-between;}
  .ocard-date{font-size:14px;font-weight:700;}
  .ocard-status{font-size:10.5px;letter-spacing:1px;color:var(--muted);border:1px solid var(--line);padding:2px 7px;}
  .ocard-status.on{background:var(--ink);color:var(--bg);border-color:var(--ink);}
  .ocard-sum{margin-top:8px;font-size:13.5px;color:var(--ink2);line-height:1.6;}
  .ocard-note{margin-top:6px;font-size:12.5px;color:var(--muted);font-style:italic;}
  .ocard-foot{display:flex;align-items:baseline;justify-content:space-between;margin-top:10px;padding-top:9px;border-top:1px solid var(--line-soft);}
  .ocard-count{font-size:11.5px;color:var(--muted);letter-spacing:.5px;}
  .ocard-total{font-size:16px;font-weight:700;}
`

const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>Map of Us · 菜单功能预览</title><style>${css}</style></head><body>
  <div class="col"><div class="label">菜单 · 点菜</div><div class="phone"><div class="bar">菜单</div><div class="screen">${menuScreen}</div></div></div>
  <div class="col"><div class="label">确认点单</div><div class="phone"><div class="bar">确认点单</div><div class="screen">${orderScreen}</div></div></div>
  <div class="col"><div class="label">我的 · 订单</div><div class="phone"><div class="bar">我的</div><div class="screen">${mineScreen}</div></div></div>
</body></html>`

const out = path.join(__dirname, '..', 'preview-menu.html')
fs.writeFileSync(out, html)
console.log('wrote', out)
