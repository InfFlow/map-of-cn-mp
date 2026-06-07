const app = getApp()
const api = require('../../utils/api')

Page({
  data: {
    capsules: [],
    loading: false,
    editor: {
      show: false,
      title: '',
      message: '',
      openDate: '',
      photos: [],
    },
    saving: false,
  },

  onLoad() {
    const user = app.getUser()
    if (!user || !user.openid) {
      wx.showToast({ title: '请先登录', icon: 'none' })
      return
    }
    this.openid = user.openid
    this.loadCapsules()
  },

  onPullDownRefresh() {
    this.loadCapsules().finally(() => wx.stopPullDownRefresh())
  },

  async loadCapsules() {
    if (!this.openid) return
    this.setData({ loading: true })
    try {
      const data = await api.admin({ action: 'list_capsules', openid: this.openid })
      const today = this._today()
      const capsules = (data.capsules || []).map((c) => ({
        ...c,
        daysLeft: this._daysLeft(c.openDate, today),
        openDateFmt: this._fmtDate(c.openDate),
      }))
      this.setData({ capsules, loading: false })
    } catch (e) {
      this.setData({ loading: false })
      wx.showToast({ title: '这段回忆暂时没打开', icon: 'none' })
    }
  },

  _today() {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  },

  _daysLeft(openDate, today) {
    if (!openDate) return 0
    const t = today || this._today()
    const diff = new Date(openDate) - new Date(t)
    return Math.ceil(diff / 86400000)
  },

  _fmtDate(s) {
    if (!s) return ''
    const m = String(s).match(/(\d{4})-(\d{2})-(\d{2})/)
    return m ? `${m[1]}.${m[2]}.${m[3]}` : s
  },

  openEditor() {
    this.setData({
      editor: { show: true, title: '', message: '', openDate: '', photos: [] },
    })
  },

  closeEditor() {
    this.setData({ 'editor.show': false })
  },

  onInputTitle(e) { this.setData({ 'editor.title': e.detail.value }) },
  onInputMessage(e) { this.setData({ 'editor.message': e.detail.value }) },
  onInputDate(e) { this.setData({ 'editor.openDate': e.detail.value }) },

  async choosePhoto() {
    const photos = this.data.editor.photos || []
    if (photos.length >= 6) {
      wx.showToast({ title: '最多选 6 张', icon: 'none' })
      return
    }
    wx.chooseMedia({
      count: 6 - photos.length,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      success: async (res) => {
        const temps = (res.tempFiles || []).map((f) => f.tempFilePath)
        wx.showLoading({ title: '上传中', mask: true })
        const uploaded = []
        for (const path of temps) {
          try {
            const r = await api.uploadImage(path, this.openid)
            if (r && r.imageUrl) uploaded.push(r.imageUrl)
          } catch (e) {}
        }
        wx.hideLoading()
        this.setData({ 'editor.photos': [...photos, ...uploaded] })
      },
    })
  },

  removePhoto(e) {
    const idx = e.currentTarget.dataset.idx
    const photos = [...(this.data.editor.photos || [])]
    photos.splice(idx, 1)
    this.setData({ 'editor.photos': photos })
  },

  async saveNewCapsule() {
    if (this.data.saving) return
    const ed = this.data.editor
    const title = (ed.title || '').trim()
    const openDate = (ed.openDate || '').trim()
    if (!title) { wx.showToast({ title: '请填写标题', icon: 'none' }); return }
    if (!openDate || !/^\d{4}-\d{2}-\d{2}$/.test(openDate)) {
      wx.showToast({ title: '请填写正确的开启日期（如 2026-12-31）', icon: 'none' })
      return
    }
    this.setData({ saving: true })
    wx.showLoading({ title: '封存中', mask: true })
    try {
      await api.admin({
        action: 'add_capsule',
        openid: this.openid,
        title,
        message: (ed.message || '').trim(),
        openDate,
        photos: ed.photos || [],
      })
      wx.hideLoading()
      this.setData({ saving: false, 'editor.show': false })
      wx.showToast({ title: '胶囊已封存', icon: 'success' })
      this.loadCapsules()
    } catch (e) {
      wx.hideLoading()
      this.setData({ saving: false })
      const msg = (e && e.data && e.data.message) || '这颗胶囊暂时没收好'
      wx.showToast({ title: msg, icon: 'none', duration: 3000 })
    }
  },

  async openCapsule(e) {
    const c = e.currentTarget.dataset.capsule
    if (!c || !c.canOpen) return
    if (c.isOpened) {
      // 已开过，直接展示内容
      this._showContent(c)
      return
    }
    wx.showLoading({ title: '开启中', mask: true })
    try {
      const data = await api.admin({ action: 'open_capsule', openid: this.openid, id: c.id })
      wx.hideLoading()
      wx.vibrateShort && wx.vibrateShort({ type: 'medium' })
      this._showContent({ ...c, message: data.message, photos: data.photos || [] })
      this.loadCapsules()
    } catch (e) {
      wx.hideLoading()
      const msg = (e && e.data && e.data.message) || '这颗胶囊暂时打不开'
      wx.showToast({ title: msg, icon: 'none', duration: 3000 })
    }
  },

  _showContent(c) {
    const msg = c.message || '（没有留言）'
    wx.showModal({
      title: `「${c.title}」`,
      content: msg,
      showCancel: false,
      confirmText: '收好了',
    })
  },
})
