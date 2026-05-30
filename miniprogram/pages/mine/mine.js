const app = getApp()
const api = require('../../utils/api')

const STATUS = {
  pending: '待处理',
  accepted: '已接单',
  done: '已完成',
  canceled: '已取消',
}

Page({
  data: {
    user: null,
    monogram: '',
    nickInput: '',
    orders: [],
    loading: false,
    loggingIn: false,
    savingName: false,
  },

  onShow() {
    const user = app.getUser()
    this.setData({ user, monogram: this.monogram(user), nickInput: (user && user.nickname) || '' })
    if (user && user.openid) this.loadOrders()
  },

  onPullDownRefresh() {
    if (this.data.user) this.loadOrders().then(() => wx.stopPullDownRefresh())
    else wx.stopPullDownRefresh()
  },

  monogram(user) {
    const n = (user && user.nickname) || ''
    return n ? n[0] : '我'
  },

  async login() {
    if (this.data.loggingIn) return
    this.setData({ loggingIn: true })
    wx.showLoading({ title: '登录中', mask: true })
    try {
      const user = await app.login()
      wx.hideLoading()
      wx.vibrateShort && wx.vibrateShort({ type: 'light' })
      this.setData({ user, monogram: this.monogram(user), nickInput: user.nickname || '', loggingIn: false })
      this.loadOrders()
    } catch (e) {
      wx.hideLoading()
      this.setData({ loggingIn: false })
      wx.showToast({ title: '登录失败，请重试', icon: 'none' })
    }
  },

  onNickInput(e) {
    this.setData({ nickInput: e.detail.value })
  },

  async saveName() {
    const name = (this.data.nickInput || '').trim()
    if (!name || this.data.savingName) return
    this.setData({ savingName: true })
    try {
      const user = await app.login({ nickname: name })
      this.setData({ user, monogram: this.monogram(user), savingName: false })
      wx.showToast({ title: '已保存', icon: 'success' })
    } catch (e) {
      this.setData({ savingName: false })
      wx.showToast({ title: '保存失败', icon: 'none' })
    }
  },

  async loadOrders() {
    const user = this.data.user
    if (!user || !user.openid) return
    this.setData({ loading: true })
    try {
      const data = await api.getMyOrders(user.openid)
      const orders = (data.orders || []).map((o) => ({
        ...o,
        statusText: STATUS[o.status] || o.status,
        dateShort: this.fmtDate(o.createdAt),
        summary: o.items.map((it) => `${it.name}×${it.qty}`).join('、'),
      }))
      this.setData({ orders, loading: false })
    } catch (e) {
      this.setData({ loading: false })
    }
  },

  fmtDate(s) {
    if (!s) return ''
    const m = String(s).match(/(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})/)
    return m ? `${m[2]}.${m[3]} ${m[4]}:${m[5]}` : s
  },

  goMenu() {
    wx.switchTab({ url: '/pages/menu/menu' })
  },
})
