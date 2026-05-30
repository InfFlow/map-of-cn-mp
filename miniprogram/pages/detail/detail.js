const api = require('../../utils/api')
const { prettyDate, toneGradient } = require('../../utils/util')

Page({
  data: {
    trip: null,
    loading: true,
    showTop: false,
    error: '',
  },

  onLoad(options) {
    this.load(options.id)
  },

  onPageScroll(e) {
    const show = e.scrollTop > 520
    if (show !== this.data.showTop) this.setData({ showTop: show })
  },

  backToTop() {
    wx.pageScrollTo({ scrollTop: 0, duration: 300 })
  },

  async load(id) {
    try {
      const data = await api.getJourneys()
      const j = (data.journeys || []).find((x) => String(x.id) === String(id))
      if (!j) {
        this.setData({ loading: false, error: '没有找到这段回忆' })
        return
      }
      const photos = (j.photos || []).map((p, i) => ({
        ...p,
        grad: toneGradient(p.tone),
        fig: 'FIG.' + String(i + 1).padStart(2, '0'),
      }))
      const notes = j.notes || []
      const trip = {
        ...j,
        dateText: prettyDate(j.date),
        dateShort: String(j.date),
        coverGrad: toneGradient(j.coverTone),
        cover: (photos.find((p) => p.imageUrl) || {}).imageUrl || '',
        photos,
        pullquote: notes[0] || j.intro || '',
        restNotes: notes.length > 1 ? notes.slice(1) : notes,
      }
      wx.setNavigationBarTitle({ title: j.city })
      this.setData({ trip, loading: false })
    } catch (e) {
      this.setData({ loading: false, error: '加载失败，请检查网络' })
    }
  },

  preview(e) {
    const url = e.currentTarget.dataset.url
    if (!url) return
    const urls = (this.data.trip.photos || []).map((p) => p.imageUrl).filter(Boolean)
    wx.vibrateShort && wx.vibrateShort({ type: 'light' })
    wx.previewImage({ current: url, urls })
  },

  askAi() {
    const city = (this.data.trip && this.data.trip.city) || ''
    wx.vibrateShort && wx.vibrateShort({ type: 'light' })
    wx.navigateTo({ url: `/pages/ai/ai?mode=scene&city=${encodeURIComponent(city)}` })
  },
})
