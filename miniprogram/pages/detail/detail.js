const app = getApp()
const api = require('../../utils/api')
const { prettyDate, toneGradient } = require('../../utils/util')
const { buildJourneyPoster } = require('../../utils/poster')

Page({
  data: {
    trip: null,
    loading: true,
    showTop: false,
    error: '',
    viewerShow: false,
    viewerUrls: [],
    viewerCurrent: 0,
    posterW: 300,
    posterH: 100,
    making: false,
    aiEnabled: app.globalData.aiEnabled,
  },

  onLoad(options) {
    this._id = options.id
    this.load(options.id)
  },

  retry() {
    wx.vibrateShort && wx.vibrateShort({ type: 'light' })
    this.setData({ loading: true, error: '' })
    this.load(this._id)
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
    const current = Math.max(0, urls.indexOf(url))
    wx.vibrateShort && wx.vibrateShort({ type: 'light' })
    this.setData({ viewerUrls: urls, viewerCurrent: current, viewerShow: true })
  },

  closeViewer() {
    this.setData({ viewerShow: false })
  },

  // 生成分享长图：绘制 -> 预览（可长按转发 / 保存到相册）
  makePoster() {
    if (this.data.making || !this.data.trip) return
    this.setData({ making: true })
    wx.vibrateShort && wx.vibrateShort({ type: 'light' })
    wx.showLoading({ title: '生成中…', mask: true })
    wx.createSelectorQuery()
      .select('#poster')
      .fields({ node: true, size: true })
      .exec(async (res) => {
        const node = res && res[0] && res[0].node
        if (!node) {
          wx.hideLoading()
          this.setData({ making: false })
          wx.showToast({ title: '生成失败', icon: 'none' })
          return
        }
        try {
          const tempFilePath = await buildJourneyPoster(node, this.data.trip)
          wx.hideLoading()
          this.setData({ making: false })
          this.setData({ viewerUrls: [tempFilePath], viewerCurrent: 0, viewerShow: true })
        } catch (e) {
          wx.hideLoading()
          this.setData({ making: false })
          wx.showToast({ title: '生成失败，请重试', icon: 'none' })
        }
      })
  },

  askAi() {
    const city = (this.data.trip && this.data.trip.city) || ''
    wx.vibrateShort && wx.vibrateShort({ type: 'light' })
    wx.navigateTo({ url: `/pages/ai/ai?mode=scene&city=${encodeURIComponent(city)}` })
  },
})
