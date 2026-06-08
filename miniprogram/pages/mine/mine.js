const app = getApp()
const api = require('../../utils/api')

const STATUS = {
  pending: '待处理',
  accepted: '已接单',
  done: '已完成',
  canceled: '已取消',
}

// 从形如「第 100 天」的纪念日反推在一起的天数
function daysTogether(anniversaries) {
  for (const a of anniversaries || []) {
    const m = /第\s*(\d+)\s*天/.exec(a.label || '')
    if (m && a.date) {
      const n = Number(m[1])
      const [y, mo, d] = String(a.date).split('.').map(Number)
      const start = new Date(y, mo - 1, d)
      start.setDate(start.getDate() - (n - 1))
      return Math.max(0, Math.floor((Date.now() - start.getTime()) / 86400000) + 1)
    }
  }
  return 0
}

function nextAnniversary(anniversaries) {
  const now = new Date()
  let best = null
  ;(anniversaries || []).forEach((a) => {
    if (!a.repeatYearly && !a.repeat_yearly) return
    const raw = String(a.date || a.event_date || '')
    const m = raw.match(/(\d{4})[.-](\d{1,2})[.-](\d{1,2})/)
    if (!m) return
    const month = Number(m[2])
    const day = Number(m[3])
    if (!month || !day) return
    let target = new Date(now.getFullYear(), month - 1, day)
    if (target < new Date(now.getFullYear(), now.getMonth(), now.getDate())) {
      target = new Date(now.getFullYear() + 1, month - 1, day)
    }
    const days = Math.ceil((target.getTime() - now.getTime()) / 86400000)
    if (!best || days < best.days) {
      best = { label: a.label || a.name || '纪念日', days }
    }
  })
  return best
}

Page({
  data: {
    user: null,
    monogram: '',
    nickInput: '',
    editingName: false,
    orders: [],
    loading: false,
    loggingIn: false,
    savingName: false,
    aiEnabled: false,
    headStats: { days: 0, cities: 0, provinces: 0, spots: 0, photos: 0 },
    showcase: { latest: '', nextAnniv: null },
  },

  onShareAppMessage() {
    return {
      title: 'Map of Us · 我们的地图',
      path: '/pages/index/index',
    }
  },

  onShareTimeline() {
    return { title: 'Map of Us · 我们的地图' }
  },

  onShow() {
    app.syncAiEnabled(this)
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 4 })
    }
    const user = app.getUser()
    this.setData({ user, monogram: this.monogram(user), nickInput: (user && user.nickname) || '' })
    if (user && user.openid) {
      this.loadOrders()
      this.refreshAdmin()
    }
    this.loadHeadStats()
  },

  // 头部统计：在一起天数 + 去过城市/省份/足迹
  async loadHeadStats() {
    try {
      const data = await api.getJourneys()
      const journeys = data.journeys || []
      const cities = new Set(journeys.map((j) => j.city).filter(Boolean)).size
      const provinces = new Set(journeys.map((j) => j.province).filter(Boolean)).size
      const days = daysTogether(data.anniversaries)
      const spots = journeys.length
      const photos = journeys.reduce((sum, j) => sum + ((j.photos || []).filter((p) => p.imageUrl).length), 0)
      const latest = [...journeys]
        .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))[0]
      const nextAnniv = nextAnniversary(data.anniversaries)
      this.setData({
        headStats: { days, cities, provinces, spots, photos },
        showcase: {
          latest: latest ? `${latest.city || '某一站'} · ${latest.title || latest.date || '最近一次回忆'}` : '',
          nextAnniv,
        },
      })
      // 首次进入：顶部数据卡从0滚动到真实值，onShow 重复进入不再滚动
      if (!this._animated) {
        this._animated = true
        this.setData({ headStats: { days: 0, cities: 0, provinces: 0, spots: 0, photos: 0 } })
        this.animateNumber('headStats.days', days, 850)
        this.animateNumber('headStats.cities', cities, 650)
        this.animateNumber('headStats.provinces', provinces, 700)
        this.animateNumber('headStats.spots', spots, 800)
        this.animateNumber('headStats.photos', photos, 800)
      }
    } catch (e) {}
  },

  // 数字从0缓动到目标值，key 支持 'headStats.cities' 这种路径
  animateNumber(key, target, duration) {
    target = Number(target) || 0
    if (target <= 0) { this.setData({ [key]: 0 }); return }
    const start = Date.now()
    const d = duration || 700
    const ease = (t) => 1 - Math.pow(1 - t, 3) // easeOutCubic
    const tick = () => {
      const p = Math.min(1, (Date.now() - start) / d)
      const val = Math.round(target * ease(p))
      this.setData({ [key]: val })
      if (p < 1) setTimeout(tick, 32)
    }
    tick()
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

  openBoard() {
    wx.vibrateShort && wx.vibrateShort({ type: 'light' })
    wx.navigateTo({ url: '/pages/board/board' })
  },

  openSearch() { wx.navigateTo({ url: '/pages/search/search' }) },

  openHub() { wx.navigateTo({ url: '/pages/hub/hub' }) },

  openDashboard() { wx.navigateTo({ url: '/pages/dashboard/dashboard' }) },

  openAlbum() {
    wx.vibrateShort && wx.vibrateShort({ type: 'light' })
    wx.navigateTo({ url: '/pages/album/album' })
  },

  openFootprints() {
    wx.vibrateShort && wx.vibrateShort({ type: 'light' })
    wx.navigateTo({ url: '/pages/footprints/footprints' })
  },

  openStats() {
    wx.vibrateShort && wx.vibrateShort({ type: 'light' })
    wx.navigateTo({ url: '/pages/stats/stats' })
  },

  openRecap() {
    wx.vibrateShort && wx.vibrateShort({ type: 'light' })
    wx.navigateTo({ url: '/pages/recap/recap' })
  },

  openMoments() {
    wx.navigateTo({ url: '/pages/moments/moments' })
  },

  openStory() {
    wx.navigateTo({ url: '/pages/story/story' })
  },

  openCapsule() {
    wx.navigateTo({ url: '/pages/capsule/capsule' })
  },

  openLogs() { wx.navigateTo({ url: '/pages/logs/logs' }) },

  claimAdmin() {
    const user = this.data.user
    if (!user || !user.openid) return
    wx.showModal({
      title: '整理权限',
      editable: true,
      placeholderText: '输入整理口令',
      success: async (r) => {
        if (!r.confirm) return
        const passcode = (r.content || '').trim()
        if (!passcode) return
        wx.showLoading({ title: '确认中', mask: true })
        try {
          await api.admin({ action: 'claim_admin', openid: user.openid, passcode })
          const next = { ...user, isAdmin: true }
          app.globalData.user = next
          wx.setStorageSync('user', next)
          this.setData({ user: next })
          wx.hideLoading()
          wx.showToast({ title: '已开启整理权限', icon: 'success' })
          setTimeout(() => wx.navigateTo({ url: '/pages/admin/admin' }), 500)
        } catch (e) {
          wx.hideLoading()
          wx.showToast({ title: (e && e.data && e.data.message) || '口令好像不对', icon: 'none' })
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
      const msg = (e && e.data && e.data.message) || (e && e.errMsg) || '暂时没登录上'
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
      wx.showToast({ title: '头像暂时没换好', icon: 'none' })
    }
  },

  startEditName() {
    this.setData({ editingName: true, nickInput: (this.data.user && this.data.user.nickname) || '' })
  },

  async saveName() {
    const name = (this.data.nickInput || '').trim()
    if (!name || this.data.savingName) return
    this.setData({ savingName: true })
    try {
      const user = await app.login({ nickname: name })
      this.setData({ user, monogram: this.monogram(user), savingName: false, editingName: false })
      wx.showToast({ title: '已保存', icon: 'success' })
    } catch (e) {
      this.setData({ savingName: false })
      wx.showToast({ title: '昵称暂时没保存好', icon: 'none' })
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
      this._ordersRaw = data.orders || []
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

  // 再来一单：把历史订单的菜品写回购物车，跳到下单页
  reorder(e) {
    const id = e.currentTarget.dataset.id
    const order = (this._ordersRaw || []).find((o) => String(o.id) === String(id))
    if (!order || !order.items || !order.items.length) {
      wx.showToast({ title: '订单为空', icon: 'none' })
      return
    }
    const cart = {}
    let skipped = 0
    order.items.forEach((it) => {
      const did = it.dishId
      if (!did) {
        skipped++
        return
      }
      if (cart[did]) {
        cart[did].qty = Math.min(99, cart[did].qty + it.qty)
      } else {
        cart[did] = { id: did, name: it.name, price: it.price, qty: Math.min(99, it.qty), remark: it.remark || '' }
      }
    })
    if (!Object.keys(cart).length) {
      wx.showToast({ title: '菜品已下架，无法再来一单', icon: 'none' })
      return
    }
    app.globalData.cart = cart
    wx.vibrateShort && wx.vibrateShort({ type: 'medium' })
    if (skipped > 0) {
      wx.showToast({ title: `有 ${skipped} 道已下架，已跳过`, icon: 'none' })
    }
    setTimeout(() => wx.navigateTo({ url: '/pages/order/order' }), skipped > 0 ? 700 : 0)
  },
})
