const api = require('../../utils/api')
const { prettyDate, toneGradient } = require('../../utils/util')

Page({
  data: {
    trip: null,
    loading: true,
    error: '',
  },

  onLoad(options) {
    this.load(options.id)
  },

  async load(id) {
    try {
      const data = await api.getJourneys()
      const j = (data.journeys || []).find((x) => String(x.id) === String(id))
      if (!j) {
        this.setData({ loading: false, error: '没有找到这段回忆' })
        return
      }
      const trip = {
        ...j,
        dateText: prettyDate(j.date),
        photos: (j.photos || []).map((p) => ({
          ...p,
          grad: toneGradient(p.tone),
        })),
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
    wx.previewImage({ current: url, urls })
  },
})
