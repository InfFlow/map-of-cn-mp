const app = getApp()
const api = require('../../utils/api')

Page({
  data: {
    openid: '',
    wishes: [],
    ready: false,
    doneCount: 0,
    editor: { show: false, id: '', placeName: '', province: '', city: '', memo: '' },
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

  onPullDownRefresh() {
    this.load().then(
      () => wx.stopPullDownRefresh(),
      () => wx.stopPullDownRefresh()
    )
  },

  async load() {
    try {
      const data = await api.admin({ action: 'wishes', openid: this.data.openid })
      const wishes = data.wishes || []
      this.setData({ wishes, ready: true, doneCount: wishes.filter((w) => w.done).length })
    } catch (e) {
      this.setData({ ready: true })
      wx.showToast({ title: '加载失败', icon: 'none' })
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
      wx.showToast({ title: (e && e.data && e.data.message) || '保存失败', icon: 'none' })
    }
  },

  async toggle(e) {
    const id = e.currentTarget.dataset.id
    wx.vibrateShort && wx.vibrateShort({ type: 'light' })
    try {
      await api.admin({ action: 'toggle_wish', openid: this.data.openid, id })
      this.load()
    } catch (err) {
      wx.showToast({ title: '操作失败', icon: 'none' })
    }
  },

  del(e) {
    const id = e.currentTarget.dataset.id
    wx.showModal({
      title: '删除心愿',
      content: '确定删除这个想去的地方吗？',
      success: async (r) => {
        if (!r.confirm) return
        try {
          await api.admin({ action: 'del_wish', openid: this.data.openid, id })
          this.load()
        } catch (err) {
          wx.showToast({ title: '删除失败', icon: 'none' })
        }
      },
    })
  },
})
