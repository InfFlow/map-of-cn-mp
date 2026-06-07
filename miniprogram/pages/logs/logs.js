const app = getApp()
const api = require('../../utils/api')

const CATS = [
  { key: 'all', name: '全部', icon: '◎' },
  { key: 'movie', name: '电影', icon: '🎬' },
  { key: 'food', name: '美食', icon: '🍜' },
  { key: 'travel', name: '旅行', icon: '✈️' },
  { key: 'book', name: '读书', icon: '📚' },
  { key: 'music', name: '音乐', icon: '🎵' },
  { key: 'show', name: '演出', icon: '🎭' },
  { key: 'game', name: '游戏', icon: '🎮' },
  { key: 'other', name: '其他', icon: '✦' },
]

const TITLE_PLACEHOLDER = {
  movie: '电影名 / 影院 / 一起看的片子…',
  food: '餐厅名 / 菜名 / 这顿饭…',
  travel: '目的地 / 这次出发 / 景点名…',
  book: '书名 / 作者 / 这一页…',
  music: '歌名 / 专辑 / 一起听的现场…',
  show: '演出名 / 剧场 / 这一场…',
  game: '游戏名 / 一起通关的瞬间…',
  other: '这件小事的名字…',
}

Page({
  data: {
    cats: CATS,
    activecat: 'all',
    logs: [],
    counts: {},
    loading: true,
    editor: { show: false, category: 'movie', catName: '电影', titlePh: TITLE_PLACEHOLDER.movie, title: '', date: '', note: '', coverImage: '', rating: 0, saving: false },
    editCats: CATS.filter(c => c.key !== 'all'),
  },

  onLoad() { this.loadLogs() },
  onShow() { app.syncAiEnabled && app.syncAiEnabled(this) },
  onPullDownRefresh() { this.loadLogs().finally(() => wx.stopPullDownRefresh()) },

  async loadLogs() {
    const user = app.getUser()
    if (!user || !user.openid) { this.setData({ loading: false }); return }
    this.setData({ loading: true })
    try {
      const r = await api.admin({ action: 'list_logs', openid: user.openid, category: this.data.activecat })
      this.setData({ logs: r.logs || [], counts: r.counts || {}, loading: false })
    } catch { this.setData({ loading: false }) }
  },

  switchCat(e) {
    const key = e.currentTarget.dataset.key
    if (key === this.data.activecat) return
    wx.vibrateShort && wx.vibrateShort({ type: 'light' })
    this.setData({ activecat: key }, () => this.loadLogs())
  },

  openEditor() {
    const today = new Date().toISOString().slice(0, 10)
    const active = this.data.activecat === 'all' ? 'movie' : this.data.activecat
    const cat = this.data.editCats.find((c) => c.key === active) || this.data.editCats[0]
    this.setData({
      editor: {
        show: true,
        category: cat.key,
        catName: cat.name,
        titlePh: TITLE_PLACEHOLDER[cat.key] || TITLE_PLACEHOLDER.other,
        title: '',
        date: today,
        note: '',
        coverImage: '',
        rating: 0,
        saving: false,
      },
    })
  },
  closeEditor() { this.setData({ 'editor.show': false }) },
  onTitle(e) { this.setData({ 'editor.title': e.detail.value }) },
  onDate(e) { this.setData({ 'editor.date': e.detail.value }) },
  onNote(e) { this.setData({ 'editor.note': e.detail.value }) },
  onCatChange(e) {
    const cat = this.data.editCats[e.detail.value]
    this.setData({
      'editor.category': cat.key,
      'editor.catName': cat.name,
      'editor.titlePh': TITLE_PLACEHOLDER[cat.key] || TITLE_PLACEHOLDER.other,
    })
  },
  setRating(e) { this.setData({ 'editor.rating': e.currentTarget.dataset.r }) },

  async chooseCover() {
    const user = app.getUser()
    if (!user || !user.openid) return
    wx.chooseMedia({ count: 1, mediaType: ['image'], sourceType: ['album', 'camera'], success: async res => {
      const f = res.tempFiles[0].tempFilePath
      try {
        const up = await api.uploadImage(f, user.openid)
        this.setData({ 'editor.coverImage': up.imageUrl })
      } catch { wx.showToast({ title: '封面暂时没传好', icon: 'none' }) }
    }})
  },

  async saveLog() {
    const e = this.data.editor
    if (!e.title.trim()) { wx.showToast({ title: '填个标题', icon: 'none' }); return }
    const user = app.getUser()
    if (!user || !user.openid) return
    this.setData({ 'editor.saving': true })
    try {
      await api.admin({ action: 'add_log', openid: user.openid, category: e.category, title: e.title, date: e.date, note: e.note, coverImage: e.coverImage, rating: e.rating })
      wx.vibrateShort && wx.vibrateShort({ type: 'light' })
      this.closeEditor()
      this.loadLogs()
    } catch { wx.showToast({ title: '这条记录暂时没保存好', icon: 'none' }) }
    this.setData({ 'editor.saving': false })
  },

  async delLog(e) {
    const id = e.currentTarget.dataset.id
    const user = app.getUser()
    if (!user || !user.openid) return
    wx.showModal({ title: '拿掉这条记录？', content: '这条记录会先从列表里拿掉。', confirmText: '拿掉', success: async r => {
      if (!r.confirm) return
      await api.admin({ action: 'del_log', openid: user.openid, id }).catch(() => {})
      this.setData({ logs: this.data.logs.filter(l => l.id !== id) })
    }})
  },

  noop() {},
})
