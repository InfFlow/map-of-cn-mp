const app = getApp()
const api = require('../../utils/api')

Page({
  data: {
    loading: true,
    error: '',
    categories: [],
    cartCount: 0,
    cartTotal: 0,
    activeCat: 0,
    showTop: false,
  },

  onLoad() {
    this.loadMenu()
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 3 })
    }
    // 从下单页返回后，购物车可能被清空，刷新数量显示
    if (this.data.categories.length) this.applyCart()
  },

  onPullDownRefresh() {
    this.loadMenu().then(() => wx.stopPullDownRefresh())
  },

  onPageScroll(e) {
    const show = e.scrollTop > 460
    if (show !== this.data.showTop) this.setData({ showTop: show })
  },

  backToTop() {
    wx.pageScrollTo({ scrollTop: 0, duration: 300 })
  },

  async loadMenu() {
    try {
      const data = await api.getMenu()
      const categories = (data.categories || []).filter((c) => c.dishes && c.dishes.length)
      this._categories = categories
      this.setData({
        categories,
        loading: false,
        error: '',
        activeCat: categories.length ? categories[0].id : 0,
      })
      this.applyCart()
    } catch (e) {
      this.setData({ loading: false, error: '菜单加载失败，请检查网络' })
    }
  },

  // 把购物车数量合并进分类菜品，计算合计
  applyCart() {
    const cart = app.globalData.cart || {}
    let count = 0
    let total = 0
    const categories = (this._categories || []).map((c) => ({
      ...c,
      dishes: c.dishes.map((d) => {
        const qty = cart[d.id] ? cart[d.id].qty : 0
        count += qty
        total += qty * d.price
        return { ...d, qty, badges: this.buildBadges(d) }
      }),
    }))
    this.setData({ categories, cartCount: count, cartTotal: this.fmt(total) })
  },

  fmt(n) {
    return Number.isInteger(n) ? String(n) : n.toFixed(2)
  },

  buildBadges(d) {
    const spicyLabel = ['', '微辣', '中辣', '重辣']
    const badges = []
    if (d.recommended) badges.push({ text: '推荐', rec: true })
    const sp = Number(d.spicy) || 0
    if (sp > 0) badges.push({ text: spicyLabel[sp] || '辣', rec: false })
    if (d.portion) badges.push({ text: d.portion, rec: false })
    return badges
  },

  changeQty(e) {
    const { id, delta } = e.currentTarget.dataset
    const cart = app.globalData.cart || {}
    let dish = null
    for (const c of this._categories) {
      const f = c.dishes.find((d) => d.id === id)
      if (f) { dish = f; break }
    }
    if (!dish) return
    const cur = cart[id] ? cart[id].qty : 0
    const next = Math.max(0, Math.min(99, cur + delta))
    if (next === 0) delete cart[id]
    else cart[id] = { id: dish.id, name: dish.name, price: dish.price, qty: next, remark: (cart[id] && cart[id].remark) || '' }
    app.globalData.cart = cart
    wx.vibrateShort && wx.vibrateShort({ type: 'light' })
    this.applyCart()
  },

  jumpTo(e) {
    const id = e.currentTarget.dataset.cat
    this.setData({ activeCat: id })
    wx.pageScrollTo({ selector: `#cat-${id}`, duration: 280 })
  },

  openAi() {
    wx.vibrateShort && wx.vibrateShort({ type: 'light' })
    wx.navigateTo({ url: '/pages/ai/ai?mode=dish' })
  },

  goOrder() {
    if (this.data.cartCount === 0) {
      wx.showToast({ title: '先选几道菜吧', icon: 'none' })
      return
    }
    wx.vibrateShort && wx.vibrateShort({ type: 'medium' })
    wx.navigateTo({ url: '/pages/order/order' })
  },
})
