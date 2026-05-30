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
    polyline: [],
    includePoints: [],
    ledger: [],
    recent: [],
    badges: [],
    unlocked: 0,
    mapCaption: '',
    loading: true,
    showTop: false,
    error: '',
  },

  onLoad() {
    this.loadAll()
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 0 })
    }
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
        label: {
          content: String(i + 1).padStart(2, '0'),
          color: '#1b1712',
          fontSize: 10,
          anchorX: -8,
          anchorY: -34,
          bgColor: '#faf8f3',
          borderColor: '#1b1712',
          borderWidth: 1,
          borderRadius: 8,
          padding: 3,
        },
        callout: {
          content: `${String(i + 1).padStart(2, '0')} · ${j.city} · ${j.title}`,
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
        strokeColor: '#1b1712',
        fillColor: '#1b17121A',
      }))

      const ledger = journeys.map((j, i) => ({
        no: String(i + 1).padStart(2, '0'),
        city: j.city,
      }))

      const includePoints = markers.map((m) => ({
        latitude: m.latitude,
        longitude: m.longitude,
      }))

      // 足迹连线：按日期顺序把走过的城市连成一条墨色虚线路径
      const routePoints = [...journeys]
        .filter((j) => j.latitude && j.longitude)
        .sort((a, b) => String(a.date).localeCompare(String(b.date)))
        .map((j) => ({ latitude: j.latitude, longitude: j.longitude }))
      const polyline =
        routePoints.length > 1
          ? [
              {
                points: routePoints,
                color: '#1b1712B3',
                width: 2,
                dottedLine: true,
                arrowLine: true,
              },
            ]
          : []

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

      const provinceCount = new Set(journeys.map((j) => j.province).filter(Boolean)).size
      const cityCount = new Set(journeys.map((j) => j.city).filter(Boolean)).size
      const stats = {
        provinceCount,
        cityCount,
        journeyCount: journeys.length,
      }

      const badgeDefs = [
        { need: 3, type: 'province', name: '三省通行' },
        { need: 5, type: 'province', name: '五省点亮' },
        { need: 10, type: 'province', name: '十省纵横' },
        { need: 5, type: 'city', name: '五城打卡' },
        { need: 10, type: 'city', name: '十城足迹' },
        { need: 20, type: 'city', name: '廿城漫游' },
      ]
      const badges = badgeDefs.map((b) => ({
        name: b.name,
        on: (b.type === 'province' ? provinceCount : cityCount) >= b.need,
      }))
      const unlocked = badges.filter((b) => b.on).length

      this._markers = markers
      this.setData({
        markers,
        polygons,
        polyline,
        includePoints,
        ledger,
        recent,
        badges,
        unlocked,
        days: daysTogether(data.anniversaries),
        stats,
        mapCaption: `FIG.01 — 已点亮 ${stats.provinceCount} / 34 省 · ${stats.cityCount} 城${routePoints.length > 1 ? ' · 足迹连线' : ''}`,
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
