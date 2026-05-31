const api = require('../../utils/api')

// 城市名归一（去后缀），用于分组与计数
function cityKey(c) {
  return String(c || '').replace(/市|地区|自治州|自治县|盟$/g, '') || '其他'
}

// 一组足迹的地图标记
function buildMarker(j, i) {
  return {
    id: i,
    journeyId: j.id,
    latitude: j.latitude,
    longitude: j.longitude,
    iconPath: '/assets/pin.png',
    width: 26, height: 32, anchor: { x: 0.5, y: 1 },
    label: {
      content: String(i + 1).padStart(2, '0'),
      color: '#1b1712', fontSize: 10, anchorX: -8, anchorY: -34,
      bgColor: '#faf8f3', borderColor: '#1b1712', borderWidth: 1, borderRadius: 8, padding: 3,
    },
    callout: {
      content: `${j.city} · ${j.title}`,
      color: '#1f1d1b', fontSize: 12, borderRadius: 10, borderWidth: 1,
      borderColor: '#00000014', padding: 8, bgColor: '#ffffff', display: 'BYCLICK',
    },
  }
}

Page({
  data: {
    loading: true,
    error: '',
    stats: { cityCount: 0, provinceCount: 0, journeyCount: 0 },
    cityGroups: [],
    markers: [],
    includePoints: [],
    center: { latitude: 31.5, longitude: 112 },
    scale: 4,
    activeCity: '', // '' = 全部
    showTop: false,
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
    this.setData({ loading: true, error: '' })
    try {
      const data = await api.getJourneys()
      const journeys = (data.journeys || []).filter((j) => j.latitude != null && j.longitude != null)
      this._all = journeys

      const markers = journeys.map(buildMarker)
      const includePoints = markers.map((m) => ({ latitude: m.latitude, longitude: m.longitude }))

      // 按城市分组
      const map = {}
      journeys.forEach((j, i) => {
        const key = cityKey(j.city)
        if (!map[key]) map[key] = { key, city: j.city || '其他', province: j.province || '', items: [], latSum: 0, lngSum: 0 }
        const g = map[key]
        g.items.push({
          id: j.id,
          no: String(i + 1).padStart(2, '0'),
          title: j.title || '未命名',
          date: String(j.date || ''),
          season: j.season || '',
        })
        g.latSum += j.latitude
        g.lngSum += j.longitude
        if (j.province && !g.province) g.province = j.province
      })
      const cityGroups = Object.values(map)
        .map((g) => ({
          key: g.key,
          city: g.city,
          province: (g.province || '').replace(/省|市|自治区|特别行政区|壮族|回族|维吾尔/g, ''),
          count: g.items.length,
          lat: g.latSum / g.items.length,
          lng: g.lngSum / g.items.length,
          items: g.items.sort((a, b) => b.date.localeCompare(a.date)),
        }))
        .sort((a, b) => b.count - a.count || b.items[0].date.localeCompare(a.items[0].date))

      const provinceCount = new Set(journeys.map((j) => j.province).filter(Boolean)).size
      const center = includePoints.length ? { latitude: includePoints[0].latitude, longitude: includePoints[0].longitude } : this.data.center

      this.setData({
        loading: false,
        markers,
        includePoints,
        center,
        cityGroups,
        activeCity: '',
        stats: { cityCount: cityGroups.length, provinceCount, journeyCount: journeys.length },
      })
    } catch (e) {
      this.setData({ loading: false, error: '加载失败，请检查网络' })
    }
  },

  // 点城市卡 → 地图聚焦该城市的足迹点
  focusCity(e) {
    const key = e.currentTarget.dataset.key
    const g = (this.data.cityGroups || []).find((x) => x.key === key)
    if (!g) return
    wx.vibrateShort && wx.vibrateShort({ type: 'light' })
    const pts = (this._all || [])
      .filter((j) => cityKey(j.city) === key)
      .map((j) => ({ latitude: j.latitude, longitude: j.longitude }))
    this.setData({
      activeCity: this.data.activeCity === key ? '' : key,
      includePoints: this.data.activeCity === key ? (this.data.markers || []).map((m) => ({ latitude: m.latitude, longitude: m.longitude })) : pts,
      center: { latitude: g.lat, longitude: g.lng },
      scale: this.data.activeCity === key ? 4 : 11,
    })
    wx.pageScrollTo({ scrollTop: 0, duration: 250 })
  },

  // 点地图标记 → 进入对应回忆详情
  onMarkerTap(e) {
    const m = (this.data.markers || []).find((x) => x.id === e.detail.markerId)
    if (m && m.journeyId != null) wx.navigateTo({ url: `/pages/detail/detail?id=${m.journeyId}` })
  },

  openDetail(e) {
    const id = e.currentTarget.dataset.id
    if (id != null) wx.navigateTo({ url: `/pages/detail/detail?id=${id}` })
  },
})
