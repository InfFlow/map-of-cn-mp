const app = getApp()
const api = require('../../utils/api')

function fmtTime(s) {
  if (!s) return ''
  const m = String(s).match(/(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})/)
  if (!m) return s
  const now = new Date()
  const y = Number(m[1])
  const mo = Number(m[2])
  const d = Number(m[3])
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  const day = `${m[1]}-${m[2]}-${m[3]}`
  if (day === today) return `${m[4]}:${m[5]}`
  if (y === now.getFullYear()) return `${mo}.${d} ${m[4]}:${m[5]}`
  return `${y}.${mo}.${d}`
}

function monogram(name, fallback) {
  const n = String(name || fallback || '').trim()
  return n ? n[0] : '我'
}

Page({
  data: {
    ready: false,
    loading: false,
    saving: false,
    openid: '',
    user: null,
    messages: [],
    content: '',
    maxLen: 300,
  },

  onLoad() {
    this.applyUser(true)
  },

  onShow() {
    this.applyUser(false)
  },

  applyUser(firstLoad) {
    const user = app.getUser()
    const openid = (user && user.openid) || ''
    if (!openid) {
      this.setData({ ready: true, user: null, openid: '', messages: [] })
      return
    }
    const changed = openid !== this.data.openid
    this.setData({ user, openid })
    if (firstLoad || changed || !this.data.ready) {
      this.load()
    }
  },

  onPullDownRefresh() {
    if (!this.data.openid) {
      wx.stopPullDownRefresh()
      return
    }
    this.load().then(
      () => wx.stopPullDownRefresh(),
      () => wx.stopPullDownRefresh()
    )
  },

  async load() {
    if (!this.data.openid) return
    this.setData({ loading: true })
    try {
      const data = await api.admin({ action: 'board_messages', openid: this.data.openid, limit: 80 })
      const messages = (data.messages || []).map((m) => ({
        ...m,
        timeText: fmtTime(m.createdAt),
        authorName: m.mine ? '我' : (m.nickname || 'TA'),
        avatarText: monogram(m.nickname, m.authorLabel),
      }))
      this.setData({ messages, loading: false, ready: true })
    } catch (e) {
      this.setData({ loading: false, ready: true })
      wx.showToast({ title: (e && e.data && e.data.message) || '留言暂时没取到', icon: 'none' })
    }
  },

  goLogin() {
    wx.switchTab({ url: '/pages/mine/mine' })
  },

  onInput(e) {
    this.setData({ content: e.detail.value })
  },

  async send() {
    if (this.data.saving) return
    const content = (this.data.content || '').trim()
    if (!content) {
      wx.showToast({ title: '先写一点内容', icon: 'none' })
      return
    }
    this.setData({ saving: true })
    wx.showLoading({ title: '保存中', mask: true })
    try {
      await api.admin({ action: 'add_board_message', openid: this.data.openid, content })
      wx.hideLoading()
      wx.vibrateShort && wx.vibrateShort({ type: 'light' })
      this.setData({ saving: false, content: '' })
      await this.load()
      wx.pageScrollTo({ scrollTop: 0, duration: 220 })
    } catch (e) {
      wx.hideLoading()
      this.setData({ saving: false })
      wx.showToast({ title: (e && e.data && e.data.message) || '留言暂时没保存好', icon: 'none' })
    }
  },

  del(e) {
    const id = e.currentTarget.dataset.id
    if (!id) return
    wx.showModal({
      title: '删除留言',
      content: '确定删掉这条留言吗？',
      confirmText: '删除',
      success: async (r) => {
        if (!r.confirm) return
        try {
          await api.admin({ action: 'del_board_message', openid: this.data.openid, id })
          this.load()
        } catch (err) {
          wx.showToast({ title: (err && err.data && err.data.message) || '暂时没删掉', icon: 'none' })
        }
      },
    })
  },
})
