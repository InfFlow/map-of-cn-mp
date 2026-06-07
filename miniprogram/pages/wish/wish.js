const app = getApp()
const api = require('../../utils/api')

Page({
  data: {
    openid: '',
    wishes: [],
    ready: false,
    doneCount: 0,
    yearDone: 0,
    yearLabel: '',
    editor: { show: false, id: '', placeName: '', province: '', city: '', memo: '' },
    aiEnabled: false,
    planSheet: { show: false, loading: false, place: '', data: null },
    nextDests: [],
    showNextDest: false,
  },

  fmtDoneDate(s) {
    if (!s) return ''
    const m = String(s).match(/(\d{4})-(\d{2})-(\d{2})/)
    return m ? `${m[1]}.${m[2]}.${m[3]}` : ''
  },

  onLoad() {
    const user = app.getUser()
    if (!user || !user.openid) {
      this.setData({ ready: true })
      return
    }
    this.setData({ openid: user.openid })
    this.load()
  },

  onShow() { app.syncAiEnabled(this) },

  onPullDownRefresh() {
    this.load().then(
      () => wx.stopPullDownRefresh(),
      () => wx.stopPullDownRefresh()
    )
  },

  async load() {
    try {
      const data = await api.admin({ action: 'wishes', openid: this.data.openid })
      const year = new Date().getFullYear()
      const wishes = (data.wishes || []).map((w) => ({
        ...w,
        doneDate: this.fmtDoneDate(w.completedDate),
      }))
      const yearDone = wishes.filter((w) => w.done && String(w.completedDate || '').slice(0, 4) === String(year)).length
      this.setData({
        wishes,
        ready: true,
        doneCount: wishes.filter((w) => w.done).length,
        yearDone,
        yearLabel: String(year),
      })
    } catch (e) {
      this.setData({ ready: true })
      wx.showToast({ title: '这次没翻到心愿', icon: 'none' })
    }
  },

  goLogin() {
    wx.switchTab({ url: '/pages/mine/mine' })
  },

  openEditor(e) {
    const id = e.currentTarget.dataset.id
    if (id) {
      const w = this.data.wishes.find((x) => x.id === id)
      if (!w) return
      this.setData({ editor: { show: true, id, placeName: w.placeName, province: w.province, city: w.city, memo: w.memo } })
    } else {
      this.setData({ editor: { show: true, id: '', placeName: '', province: '', city: '', memo: '' } })
    }
  },

  closeEditor() {
    this.setData({ 'editor.show': false })
  },

  onField(e) {
    const key = e.currentTarget.dataset.key
    this.setData({ [`editor.${key}`]: e.detail.value })
  },

  async save() {
    const ed = this.data.editor
    const placeName = (ed.placeName || '').trim()
    if (!placeName) {
      wx.showToast({ title: '请填写地点', icon: 'none' })
      return
    }
    const action = ed.id ? 'update_wish' : 'add_wish'
    wx.showLoading({ title: '保存中', mask: true })
    try {
      await api.admin({
        action,
        openid: this.data.openid,
        id: ed.id,
        placeName,
        province: (ed.province || '').trim(),
        city: (ed.city || '').trim(),
        memo: (ed.memo || '').trim(),
      })
      wx.hideLoading()
      this.setData({ 'editor.show': false })
      this.load()
    } catch (e) {
      wx.hideLoading()
      wx.showToast({ title: (e && e.data && e.data.message) || '心愿暂时没保存成功', icon: 'none' })
    }
  },

  async toggle(e) {
    const id = e.currentTarget.dataset.id
    wx.vibrateShort && wx.vibrateShort({ type: 'light' })
    try {
      await api.admin({ action: 'toggle_wish', openid: this.data.openid, id })
      this.load()
    } catch (err) {
      wx.showToast({ title: '暂时没处理成功', icon: 'none' })
    }
  },

  async genPlan(e) {
    const place = e.currentTarget.dataset.place
    if (!place) return
    const user = app.getUser()
    if (!user || !user.openid) { wx.showToast({ title: '请先登录', icon: 'none' }); return }
    this.setData({ planSheet: { show: true, loading: true, place, data: null } })
    try {
      const data = await api.admin({ action: 'ai_place', openid: user.openid, place })
      this.setData({ 'planSheet.loading': false, 'planSheet.data': data.detail || null })
    } catch {
      this.setData({ 'planSheet.show': false })
      wx.showToast({ title: '这站暂时没想好，再试一次', icon: 'none' })
    }
  },
  closePlanSheet() { this.setData({ planSheet: { show: false, loading: false, place: '', data: null } }) },

  del(e) {
    const id = e.currentTarget.dataset.id
    wx.showModal({
      title: '拿掉这个心愿',
      content: '把这个想去的地方先拿掉吗？',
      confirmText: '拿掉',
      success: async (r) => {
        if (!r.confirm) return
        try {
          await api.admin({ action: 'del_wish', openid: this.data.openid, id })
          this.load()
        } catch (err) {
          wx.showToast({ title: '暂时没拿掉', icon: 'none' })
        }
      },
    })
  },

  async getNextDest() {
    const user = app.getUser()
    if (!user || !user.openid) { wx.showToast({ title: '请先登录', icon: 'none' }); return }
    wx.showLoading({ title: '正在帮我们挑下一站…', mask: true })
    try {
      const r = await api.admin({ action: 'ai_next_dest', openid: user.openid })
      wx.hideLoading()
      const dests = r.destinations || []
      if (!dests.length) { wx.showToast({ title: '暂时没想到合适的一站', icon: 'none' }); return }
      this.setData({ nextDests: dests, showNextDest: true })
    } catch (e) {
      wx.hideLoading()
      wx.showToast({ title: (e && e.data && e.data.message) || '暂时没想到合适的一站', icon: 'none' })
    }
  },
  closeNextDest() { this.setData({ showNextDest: false }) },
  async addDestToWish(e) {
    const city = e.currentTarget.dataset.city
    if (!city) return
    const user = app.getUser()
    if (!user || !user.openid) return
    await api.admin({ action: 'add_wish', openid: user.openid, placeName: city, province: '', city: '', memo: '灵感推荐' }).catch(() => {})
    wx.showToast({ title: '已加入心愿', icon: 'success' })
    this.load()
  },
})
