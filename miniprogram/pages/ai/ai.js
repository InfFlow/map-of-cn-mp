const app = getApp()
const api = require('../../utils/api')

const PRESETS = {
  dish: ['想吃清淡的', '重口味下饭', '不知道吃什么', '适合两个人的家常菜', '减脂餐'],
  scene: ['有什么必去的地方', '适合情侣的小众去处', '当地特色美食', '三天怎么安排', '拍照好看的地方'],
}

Page({
  data: {
    mode: 'dish', // dish | scene
    city: '',
    query: '',
    presets: PRESETS.dish,
    answer: '',
    loading: false,
    error: '',
  },

  onLoad(options) {
    const mode = options.mode === 'scene' ? 'scene' : 'dish'
    const city = options.city ? decodeURIComponent(options.city) : ''
    wx.setNavigationBarTitle({ title: mode === 'scene' ? '问问 AI · 景区' : 'AI 点菜' })
    this.setData({ mode, city, presets: PRESETS[mode] })
  },

  switchMode(e) {
    const mode = e.currentTarget.dataset.mode
    if (mode === this.data.mode) return
    wx.vibrateShort && wx.vibrateShort({ type: 'light' })
    this.setData({ mode, presets: PRESETS[mode], answer: '', error: '' })
    wx.setNavigationBarTitle({ title: mode === 'scene' ? '问问 AI · 景区' : 'AI 点菜' })
  },

  onInput(e) {
    this.setData({ query: e.detail.value })
  },

  onCity(e) {
    this.setData({ city: e.detail.value })
  },

  usePreset(e) {
    const text = e.currentTarget.dataset.text
    this.setData({ query: text }, () => this.ask())
  },

  async ask() {
    const query = (this.data.query || '').trim()
    if (!query) {
      wx.showToast({ title: '说说你的想法', icon: 'none' })
      return
    }
    const user = app.getUser()
    if (!user || !user.openid) {
      wx.showModal({
        title: '需要登录',
        content: '请先在「我的」页用微信登录后再使用 AI 推荐。',
        showCancel: false,
        success: () => wx.switchTab({ url: '/pages/mine/mine' }),
      })
      return
    }
    this.setData({ loading: true, answer: '', error: '' })
    try {
      const data = await api.admin({
        action: 'ai_recommend',
        openid: user.openid,
        mode: this.data.mode,
        city: this.data.city,
        query,
      })
      this.setData({ answer: data.answer || '', loading: false })
    } catch (e) {
      this.setData({
        loading: false,
        error: (e && e.data && e.data.message) || 'AI 暂时不可用，请稍后再试',
      })
    }
  },

  copyAnswer() {
    if (!this.data.answer) return
    wx.setClipboardData({ data: this.data.answer })
  },
})
