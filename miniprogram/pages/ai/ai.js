const app = getApp()
const api = require('../../utils/api')

const PRESETS = {
  dish: ['想吃清淡的', '重口味下饭', '不知道吃什么', '适合两个人的家常菜', '减脂餐'],
  scene: ['有什么必去的地方', '适合情侣的小众去处', '当地特色美食', '三天怎么安排', '拍照好看的地方'],
  place: ['西湖', '故宫', '鼓浪屿', '宽窄巷子', '洪崖洞'],
  trip: ['杭州', '成都', '厦门', '重庆', '大理'],
}

const TITLES = {
  dish: 'AI 点菜',
  scene: '问问 AI · 景区',
  place: 'AI 地点介绍',
  trip: 'AI 行程攻略',
}

Page({
  data: {
    mode: 'dish', // dish | scene | place | trip
    city: '',
    place: '',
    days: 2,
    prefs: '',
    query: '',
    presets: PRESETS.dish,
    answer: '',
    placeDetail: null,
    tripPlan: null,
    loading: false,
    importing: false,
    error: '',
  },

  onLoad(options) {
    const valid = ['dish', 'scene', 'place', 'trip']
    const mode = valid.includes(options.mode) ? options.mode : 'dish'
    const city = options.city ? decodeURIComponent(options.city) : ''
    wx.setNavigationBarTitle({ title: TITLES[mode] })
    this.setData({ mode, city, place: city, presets: PRESETS[mode] })
  },

  switchMode(e) {
    const mode = e.currentTarget.dataset.mode
    if (mode === this.data.mode) return
    wx.vibrateShort && wx.vibrateShort({ type: 'light' })
    this.setData({ mode, presets: PRESETS[mode], answer: '', placeDetail: null, tripPlan: null, error: '' })
    wx.setNavigationBarTitle({ title: TITLES[mode] })
  },

  onInput(e) {
    this.setData({ query: e.detail.value })
  },
  onCity(e) {
    this.setData({ city: e.detail.value })
  },
  onPlace(e) {
    this.setData({ place: e.detail.value })
  },
  onPrefs(e) {
    this.setData({ prefs: e.detail.value })
  },
  changeDays(e) {
    const delta = Number(e.currentTarget.dataset.d) || 0
    const days = Math.max(1, Math.min(10, this.data.days + delta))
    this.setData({ days })
  },

  usePreset(e) {
    const text = e.currentTarget.dataset.text
    const mode = this.data.mode
    if (mode === 'place') {
      this.setData({ place: text }, () => this.ask())
    } else if (mode === 'trip') {
      this.setData({ city: text }, () => this.ask())
    } else {
      this.setData({ query: text }, () => this.ask())
    }
  },

  _requireLogin() {
    const user = app.getUser()
    if (!user || !user.openid) {
      wx.showModal({
        title: '需要登录',
        content: '请先在「我的」页用微信登录后再使用 AI。',
        showCancel: false,
        success: () => wx.switchTab({ url: '/pages/mine/mine' }),
      })
      return null
    }
    return user
  },

  async ask() {
    const mode = this.data.mode
    const user = this._requireLogin()
    if (!user) return

    if (mode === 'place') return this.askPlace(user)
    if (mode === 'trip') return this.askTrip(user)

    const query = (this.data.query || '').trim()
    if (!query) {
      wx.showToast({ title: '说说你的想法', icon: 'none' })
      return
    }
    this.setData({ loading: true, answer: '', error: '' })
    try {
      const data = await api.admin({
        action: 'ai_recommend',
        openid: user.openid,
        mode,
        city: this.data.city,
        query,
      })
      this.setData({ answer: data.answer || '', loading: false })
    } catch (e) {
      this.setData({ loading: false, error: (e && e.data && e.data.message) || 'AI 暂时不可用，请稍后再试' })
    }
  },

  async askPlace(user) {
    const place = (this.data.place || '').trim()
    if (!place) {
      wx.showToast({ title: '填个地点', icon: 'none' })
      return
    }
    this.setData({ loading: true, placeDetail: null, error: '' })
    try {
      const data = await api.admin({ action: 'ai_place', openid: user.openid, place })
      this.setData({ placeDetail: data.detail || null, loading: false })
    } catch (e) {
      this.setData({ loading: false, error: (e && e.data && e.data.message) || 'AI 暂时不可用，请稍后再试' })
    }
  },

  async askTrip(user) {
    const city = (this.data.city || '').trim()
    if (!city) {
      wx.showToast({ title: '填个目的地', icon: 'none' })
      return
    }
    this.setData({ loading: true, tripPlan: null, error: '' })
    try {
      const data = await api.admin({
        action: 'ai_plan',
        openid: user.openid,
        city,
        days: this.data.days,
        prefs: this.data.prefs,
      })
      this.setData({ tripPlan: data.plan || null, loading: false })
    } catch (e) {
      this.setData({ loading: false, error: (e && e.data && e.data.message) || 'AI 暂时不可用，请稍后再试' })
    }
  },

  async importPlan() {
    const plan = this.data.tripPlan
    if (!plan || !plan.days) return
    const user = this._requireLogin()
    if (!user) return
    this.setData({ importing: true })
    wx.showLoading({ title: '导入中', mask: true })
    try {
      const res = await api.admin({
        action: 'import_plan',
        openid: user.openid,
        title: plan.title || (this.data.city + ' 行程'),
        note: plan.intro || '',
        days: plan.days,
      })
      wx.hideLoading()
      this.setData({ importing: false })
      wx.showModal({
        title: '已导入',
        content: `已生成计划，含 ${res.stops || 0} 个地点。去「行程」查看？`,
        confirmText: '去看看',
        success: (r) => {
          if (r.confirm) wx.switchTab({ url: '/pages/plans/plans' })
        },
      })
    } catch (e) {
      wx.hideLoading()
      this.setData({ importing: false })
      wx.showToast({ title: (e && e.data && e.data.message) || '导入失败', icon: 'none' })
    }
  },

  copyAnswer() {
    if (!this.data.answer) return
    wx.setClipboardData({ data: this.data.answer })
  },

  copyTrip() {
    const p = this.data.tripPlan
    if (!p) return
    let txt = (p.title || '') + '\n' + (p.intro || '') + '\n\n'
    ;(p.days || []).forEach((d) => {
      txt += `Day ${d.day}${d.theme ? ' · ' + d.theme : ''}\n`
      ;(d.stops || []).forEach((s) => {
        txt += `  ${s.time ? s.time + ' ' : ''}${s.name}${s.desc ? ' — ' + s.desc : ''}\n`
      })
      txt += '\n'
    })
    if (p.foods && p.foods.length) txt += '美食：\n' + p.foods.map((f) => '  ' + f).join('\n') + '\n'
    if (p.tips && p.tips.length) txt += '贴士：\n' + p.tips.map((t) => '  ' + t).join('\n') + '\n'
    wx.setClipboardData({ data: txt })
  },
})
