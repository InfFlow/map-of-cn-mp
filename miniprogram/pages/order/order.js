const app = getApp()
const api = require('../../utils/api')

Page({
  data: {
    items: [],
    remark: '',
    total: 0,
    submitting: false,
  },

  onLoad() {
    this.buildItems()
  },

  buildItems() {
    const cart = app.globalData.cart || {}
    const items = Object.keys(cart).map((k) => ({ ...cart[k] }))
    let total = 0
    items.forEach((i) => (total += i.price * i.qty))
    this.setData({ items, total: this.fmt(total) })
  },

  fmt(n) {
    return Number.isInteger(n) ? String(n) : n.toFixed(2)
  },

  syncCart() {
    const cart = {}
    this.data.items.forEach((i) => {
      cart[i.id] = { id: i.id, name: i.name, price: i.price, qty: i.qty, remark: i.remark || '' }
    })
    app.globalData.cart = cart
  },

  changeQty(e) {
    const { id, delta } = e.currentTarget.dataset
    const items = this.data.items
      .map((i) => (i.id === id ? { ...i, qty: Math.max(0, Math.min(99, i.qty + delta)) } : i))
      .filter((i) => i.qty > 0)
    let total = 0
    items.forEach((i) => (total += i.price * i.qty))
    wx.vibrateShort && wx.vibrateShort({ type: 'light' })
    this.setData({ items, total: this.fmt(total) }, () => this.syncCart())
  },

  onItemRemark(e) {
    const id = e.currentTarget.dataset.id
    const val = e.detail.value
    const items = this.data.items.map((i) => (i.id === id ? { ...i, remark: val } : i))
    this.setData({ items }, () => this.syncCart())
  },

  onRemark(e) {
    this.setData({ remark: e.detail.value })
  },

  async submit() {
    if (this.data.submitting) return
    if (!this.data.items.length) {
      wx.showToast({ title: '还没有选菜', icon: 'none' })
      return
    }
    this.setData({ submitting: true })
    wx.showLoading({ title: '提交中', mask: true })
    try {
      let user = app.getUser()
      if (!user || !user.openid) {
        user = await app.login()
      }
      const items = this.data.items.map((i) => ({ id: i.id, qty: i.qty, remark: i.remark || '' }))
      await api.createOrder({
        openid: user.openid,
        nickname: user.nickname || '',
        remark: this.data.remark,
        items,
      })
      app.globalData.cart = {}
      wx.hideLoading()
      wx.vibrateShort && wx.vibrateShort({ type: 'medium' })
      wx.showToast({ title: '点单成功', icon: 'success' })
      setTimeout(() => wx.switchTab({ url: '/pages/mine/mine' }), 700)
    } catch (e) {
      wx.hideLoading()
      this.setData({ submitting: false })
      const msg = (e && e.data && e.data.message) || '提交失败，请重试'
      wx.showToast({ title: msg, icon: 'none' })
    }
  },
})
