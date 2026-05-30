const api = require('../../utils/api')

const app = getApp()

function daysTogether(anniversaries) {
  // 从形如「第 100 天」的纪念日反推在一起的起点
  for (const a of anniversaries || []) {
    const m = /第\s*(\d+)\s*天/.exec(a.label || '')
    if (m && a.date) {
      const n = Number(m[1])
      const [y, mo, d] = a.date.split('.').map(Number)
      const start = new Date(y, mo - 1, d)
      start.setDate(start.getDate() - (n - 1))
      return Math.max(0, Math.floor((Date.now() - start.getTime()) / 86400000) + 1)
    }
  }
  return 0
}

Page({
  data: {
    title: app.globalData.title,
    subtitle: app.globalData.subtitle,
    days: 0,
    stats: { provinceCount: 0, cityCount: 0, journeyCount: 0 },
    center: { latitude: 31.5, longitude: 112 },
    scale: 4,
    markers: [],
    polygons: [],
    includePoints: [],
    recent: [],
    mapCaption: '',
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
      const [data, polys] = await Promise.all([
        api.getJourneys(),
        api.getProvincePolygons(),
      ])
      const journeys = data.journeys || []

      const markers = journeys.map((j, i) => ({
        id: i,
        journeyId: j.id,
        latitude: j.latitude,
        longitude: j.longitude,
        iconPath: '/assets/pin.png',
        width: 26,
        height: 32,
        anchor: { x: 0.5, y: 1 },
        callout: {
          content: `${j.city} · ${j.title}`,
          color: '#1f1d1b',
          fontSize: 12,
          borderRadius: 10,
          borderWidth: 1,
          borderColor: '#00000014',
          padding: 8,
          bgColor: '#ffffff',
          display: 'BYCLICK',
        },
      }))

      const polygons = polys.map((p) => ({
        points: p.points,
        strokeWidth: 1,
        strokeColor: '#1b1712B3',
        fillColor: '#1b171214',
      }))

      const includePoints = markers.map((m) => ({
        latitude: m.latitude,
        longitude: m.longitude,
      }))

      const recent = [...journeys]
        .sort((a, b) => String(b.date).localeCompare(String(a.date)))
        .slice(0, 6)
        .map((j, i) => ({
          id: j.id,
          no: String(i + 1).padStart(2, '0'),
          city: j.city,
          title: j.title,
          season: j.season,
          dateShort: String(j.date),
        }))

      const stats = {
        provinceCount: new Set(journeys.map((j) => j.province)).size,
        cityCount: new Set(journeys.map((j) => j.city)).size,
        journeyCount: journeys.length,
      }

      this._markers = markers
      this.setData({
        markers,
        polygons,
        includePoints,
        recent,
        days: daysTogether(data.anniversaries),
        stats,
        mapCaption: `FIG.01 — 已点亮 ${stats.provinceCount} 省 · ${stats.cityCount} 城`,
        loading: false,
        error: '',
      })
    } catch (e) {
      this.setData({ loading: false, error: '加载失败，请检查网络或后端地址' })
    }
  },

  onMarkerTap(e) {
    const marker = (this._markers || []).find((m) => m.id === e.detail.markerId)
    if (marker) {
      wx.vibrateShort && wx.vibrateShort({ type: 'light' })
      wx.navigateTo({ url: `/pages/detail/detail?id=${marker.journeyId}` })
    }
  },

  openDetail(e) {
    const id = e.currentTarget.dataset.id
    wx.vibrateShort && wx.vibrateShort({ type: 'light' })
    wx.navigateTo({ url: `/pages/detail/detail?id=${id}` })
  },

  goTimeline() {
    wx.switchTab({ url: '/pages/timeline/timeline' })
  },
})
