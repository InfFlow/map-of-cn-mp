const api = require('../../utils/api')
const { prettyDate, toneGradient } = require('../../utils/util')

Page({
  data: {
    trips: [],
    anniversaries: [],
    loading: true,
    error: '',
  },

  onLoad() {
    this.load()
  },

  async load() {
    try {
      const data = await api.getJourneys()
      const trips = (data.journeys || []).map((j) => ({
        ...j,
        dateText: prettyDate(j.date),
        coverGrad: toneGradient(j.coverTone),
        cover: j.photos && j.photos[0] && j.photos[0].imageUrl,
      }))
      const anniversaries = (data.anniversaries || []).map((a) => ({
        ...a,
        dateText: prettyDate(a.date),
      }))
      this.setData({ trips, anniversaries, loading: false })
    } catch (e) {
      this.setData({ loading: false, error: '加载失败，请检查网络' })
    }
  },

  async onPullDownRefresh() {
    await this.load()
    wx.stopPullDownRefresh()
  },

  openDetail(e) {
    const id = e.currentTarget.dataset.id
    wx.navigateTo({ url: `/pages/detail/detail?id=${id}` })
  },
})
