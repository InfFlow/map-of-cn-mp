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
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 4 })
    }
    const user = app.getUser()
    this.setData({ user, monogram: this.monogram(user), nickInput: (user && user.nickname) || '' })
    if (user && user.openid) {
      this.loadOrders()
      this.refreshAdmin()
    }
  },

  // 刷新管理员状态（老登录态可能没有 isAdmin 字段）
  async refreshAdmin() {
    const user = this.data.user
    if (!user || !user.openid) return
    try {
      const { isAdmin } = await api.admin({ action: 'check_admin', openid: user.openid })
      if (!!isAdmin !== !!user.isAdmin) {
        const next = { ...user, isAdmin: !!isAdmin }
        app.globalData.user = next
        wx.setStorageSync('user', next)
        this.setData({ user: next })
      }
    } catch (e) {}
  },

  openAdmin() {
    wx.vibrateShort && wx.vibrateShort({ type: 'light' })
    wx.navigateTo({ url: '/pages/admin/admin' })
  },

  openWish() {
    wx.vibrateShort && wx.vibrateShort({ type: 'light' })
    wx.navigateTo({ url: '/pages/wish/wish' })
  },

  openAlbum() {
    wx.vibrateShort && wx.vibrateShort({ type: 'light' })
    wx.navigateTo({ url: '/pages/album/album' })
  },

  openStats() {
    wx.vibrateShort && wx.vibrateShort({ type: 'light' })
    wx.navigateTo({ url: '/pages/stats/stats' })
  },

  claimAdmin() {
    const user = this.data.user
    if (!user || !user.openid) return
    wx.showModal({
      title: '管理员认领',
      editable: true,
      placeholderText: '输入管理员口令',
      success: async (r) => {
        if (!r.confirm) return
        const passcode = (r.content || '').trim()
        if (!passcode) return
        wx.showLoading({ title: '校验中', mask: true })
        try {
          await api.admin({ action: 'claim_admin', openid: user.openid, passcode })
          const next = { ...user, isAdmin: true }
          app.globalData.user = next
          wx.setStorageSync('user', next)
          this.setData({ user: next })
          wx.hideLoading()
          wx.showToast({ title: '已认领', icon: 'success' })
          setTimeout(() => wx.navigateTo({ url: '/pages/admin/admin' }), 500)
        } catch (e) {
          wx.hideLoading()
          wx.showToast({ title: (e && e.data && e.data.message) || '口令不正确', icon: 'none' })
        }
      },
    })
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
      const msg = (e && e.data && e.data.message) || (e && e.errMsg) || '登录失败，请重试'
      wx.showToast({ title: msg, icon: 'none', duration: 3000 })
    }
  },

  onNickInput(e) {
    this.setData({ nickInput: e.detail.value })
  },

  // 微信「头像昵称填写」：选好头像后上传到服务器换永久 URL，再写入登录态
  async onChooseAvatar(e) {
    const tempUrl = e.detail && e.detail.avatarUrl
    const user = this.data.user
    if (!tempUrl || !user || !user.openid) return
    wx.showLoading({ title: '上传中', mask: true })
    try {
      const { imageUrl } = await api.uploadImage(tempUrl, user.openid)
      const next = await app.login({ avatarUrl: imageUrl })
      this.setData({ user: next, monogram: this.monogram(next) })
      wx.hideLoading()
      wx.vibrateShort && wx.vibrateShort({ type: 'light' })
      wx.showToast({ title: '已更新头像', icon: 'success' })
    } catch (err) {
      wx.hideLoading()
      wx.showToast({ title: '头像更新失败', icon: 'none' })
    }
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
