const api = require('../../utils/api')
const { prettyDate, toneGradient } = require('../../utils/util')

Page({
  data: {
    trips: [],
    anniversaries: [],
    loading: true,
    showTop: false,
    error: '',
  },

  onLoad() {
    this.load()
  },

  onPageScroll(e) {
    const show = e.scrollTop > 480
    if (show !== this.data.showTop) this.setData({ showTop: show })
  },

  backToTop() {
    wx.pageScrollTo({ scrollTop: 0, duration: 300 })
  },

  async load() {
    try {
      const data = await api.getJourneys()
      const sorted = [...(data.journeys || [])].sort((a, b) =>
        String(b.date).localeCompare(String(a.date)),
      )
      let lastYear = ''
      const trips = sorted.map((j, i) => {
        const year = String(j.date).split('.')[0]
        const yearHead = year !== lastYear ? year : ''
        lastYear = year
        return {
          ...j,
          no: String(i + 1).padStart(2, '0'),
          yearHead,
          dateText: prettyDate(j.date),
          dateShort: String(j.date),
          coverGrad: toneGradient(j.coverTone),
          cover: j.photos && j.photos[0] && j.photos[0].imageUrl,
        }
      })
      const anniversaries = (data.anniversaries || []).map((a) => ({
        ...a,
        dateText: prettyDate(a.date),
        dateShort: String(a.date),
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
    wx.vibrateShort && wx.vibrateShort({ type: 'light' })
    wx.navigateTo({ url: `/pages/detail/detail?id=${id}` })
  },
})
