const api = require('../../utils/api')

Page({
  data: {
    photos: [],        // 当前筛选后展示的照片
    allPhotos: [],     // 全部照片（带 imageUrl）
    cities: [],        // 城市筛选项
    filterCity: '',    // '' = 全部
    mono: false,       // 黑白滤镜
    total: 0,
    loading: true,
    showTop: false,
    error: '',
  },

  onLoad() {
    this.loadAll()
  },

  onPullDownRefresh() {
    this.loadAll().then(() => wx.stopPullDownRefresh())
  },

  onPageScroll(e) {
    const show = e.scrollTop > 480
    if (show !== this.data.showTop) this.setData({ showTop: show })
  },

  backToTop() {
    wx.pageScrollTo({ scrollTop: 0, duration: 300 })
  },

  async loadAll() {
    try {
      const data = await api.getJourneys()
      const journeys = data.journeys || []
      const all = []
      journeys.forEach((j) => {
        ;(j.photos || []).forEach((p) => {
          if (p.imageUrl) {
            all.push({
              imageUrl: p.imageUrl,
              city: j.city || '',
              title: p.title || j.title || '',
              date: String(j.date || ''),
              journeyId: j.id,
            })
          }
        })
      })
      // 按日期倒序（最新的在前）
      all.sort((a, b) => b.date.localeCompare(a.date))
      const cities = [...new Set(all.map((p) => p.city).filter(Boolean))]
      this.setData({
        allPhotos: all,
        cities,
        total: all.length,
        loading: false,
        error: '',
      })
      this.applyFilter()
    } catch (e) {
      this.setData({ loading: false, error: '加载失败，请检查网络' })
    }
  },

  applyFilter() {
    const { allPhotos, filterCity } = this.data
    const list = filterCity
      ? allPhotos.filter((p) => p.city === filterCity)
      : allPhotos
    const photos = list.map((p, i) => ({
      ...p,
      no: String(i + 1).padStart(2, '0'),
    }))
    this.setData({ photos })
  },

  onFilter(e) {
    const city = e.currentTarget.dataset.city || ''
    if (city === this.data.filterCity) return
    wx.vibrateShort && wx.vibrateShort({ type: 'light' })
    this.setData({ filterCity: city }, () => this.applyFilter())
  },

  toggleMono() {
    wx.vibrateShort && wx.vibrateShort({ type: 'light' })
    this.setData({ mono: !this.data.mono })
  },

  preview(e) {
    const url = e.currentTarget.dataset.url
    if (!url) return
    const urls = this.data.photos.map((p) => p.imageUrl)
    wx.vibrateShort && wx.vibrateShort({ type: 'light' })
    wx.previewImage({ current: url, urls })
  },

  openDetail(e) {
    const id = e.currentTarget.dataset.id
    if (id === undefined || id === null || id === '') return
    wx.vibrateShort && wx.vibrateShort({ type: 'light' })
    wx.navigateTo({ url: `/pages/detail/detail?id=${id}` })
  },
})
