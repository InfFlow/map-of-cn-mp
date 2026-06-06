const app = getApp()
const api = require('../../utils/api')
const { REGIONS, PROVINCES } = require('../../utils/regions')

// 城市名归一（去后缀），用于分组与计数
function cityKey(c) {
  return String(c || '').replace(/市|地区|自治州|自治县|盟$/g, '') || '其他'
}

function validCoord(lat, lng) {
  const latitude = Number(lat)
  const longitude = Number(lng)
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null
  return { latitude, longitude }
}

function seasonFromDate(date) {
  const month = Number(String(date || '').slice(5, 7)) || new Date().getMonth() + 1
  if (month >= 3 && month <= 5) return '春'
  if (month >= 6 && month <= 8) return '夏'
  if (month >= 9 && month <= 11) return '秋'
  return '冬'
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
    activeCity: '',
    showTop: false,
    showHeat: false,
    heatMapData: [],
    showRoute: false,
    polyline: [],
    PROVINCES: PROVINCES,
    checkin: { show: false, locating: false, saving: false, lat: 0, lng: 0, city: '', province: '', title: '', weather: '', season: '', photos: [], provinceIndex: 0, cityIndex: 0, cityOptions: [] },
    compare: null,
    compareLoading: false,
    showCompare: false,
  },

  onLoad() {
    this.loadAll()
  },

  onShareAppMessage() {
    return {
      title: '我们的足迹地图',
      path: '/pages/footprints/footprints',
    }
  },

  onShareTimeline() {
    return { title: '我们的足迹地图' }
  },

  retry() {
    wx.vibrateShort && wx.vibrateShort({ type: 'light' })
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
      const journeys = (data.journeys || [])
        .map((j) => ({ item: j, coord: validCoord(j.latitude, j.longitude) }))
        .filter((x) => x.coord)
        .map((x) => ({ ...x.item, latitude: x.coord.latitude, longitude: x.coord.longitude }))
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

      const heatMapData = journeys.map(j => ({ latitude: j.latitude, longitude: j.longitude, intensity: 1 }))

      this.setData({
        loading: false,
        markers,
        includePoints,
        center,
        cityGroups,
        activeCity: '',
        heatMapData,
        polyline: [],
        stats: { cityCount: cityGroups.length, provinceCount, journeyCount: journeys.length },
      })
    } catch (e) {
      this.setData({ loading: false, error: '这次没翻到足迹地图，请稍后再试' })
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
      .map((j) => validCoord(j.latitude, j.longitude))
      .filter(Boolean)
    if (!pts.length) return
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

  // ===== 定位打卡 =====
  async startCheckin() {
    const user = app.getUser()
    if (!user || !user.openid) { wx.showToast({ title: '请先登录', icon: 'none' }); return }
    this.setData({ checkin: { show: true, locating: true, saving: false, lat: 0, lng: 0, city: '', province: '', title: '', weather: '', season: seasonFromDate(new Date().toISOString().slice(0, 10)), photos: [], provinceIndex: 0, cityIndex: 0, cityOptions: REGIONS[PROVINCES[0]] || [] } })
    wx.getLocation({
      type: 'gcj02',
      success: async (res) => {
        try {
          const r = await api.admin({ action: 'regeo', openid: user.openid, latitude: res.latitude, longitude: res.longitude })
          const prov = r.province || ''
          const cityName = r.city || ''
          let pIdx = PROVINCES.findIndex(p => prov.indexOf(p) >= 0 || p.indexOf(prov.replace(/省|市|自治区|特别行政区/g, '')) >= 0)
          if (pIdx < 0) pIdx = 0
          const cityOpts = REGIONS[PROVINCES[pIdx]] || []
          let cIdx = cityOpts.findIndex(c => cityName.indexOf(c) >= 0)
          if (cIdx < 0) cIdx = 0
          let weather = ''
          try {
            const w = await api.admin({ action: 'weather', openid: user.openid, latitude: res.latitude, longitude: res.longitude })
            weather = ((w.casts || [])[0] || {}).dayWeather || ''
          } catch {}
          this.setData({
            'checkin.locating': false,
            'checkin.lat': res.latitude, 'checkin.lng': res.longitude,
            'checkin.province': PROVINCES[pIdx],
            'checkin.provinceIndex': pIdx,
            'checkin.cityOptions': cityOpts,
            'checkin.cityIndex': cIdx,
            'checkin.city': cityOpts[cIdx] || cityName,
            'checkin.weather': weather,
          })
        } catch {
          this.setData({ 'checkin.locating': false, 'checkin.lat': res.latitude, 'checkin.lng': res.longitude })
        }
      },
      fail: () => {
        this.setData({ 'checkin.show': false })
        wx.showToast({ title: '暂时没定位到，请检查权限', icon: 'none' })
      },
    })
  },

  closeCheckin() { this.setData({ checkin: { show: false, locating: false, saving: false, lat: 0, lng: 0, city: '', province: '', title: '', weather: '', season: '', photos: [], provinceIndex: 0, cityIndex: 0, cityOptions: [] } }) },

  onProvincePick(e) {
    const pIdx = Number(e.detail.value) || 0
    const province = PROVINCES[pIdx]
    const cityOpts = REGIONS[province] || []
    this.setData({
      'checkin.provinceIndex': pIdx,
      'checkin.province': province,
      'checkin.cityOptions': cityOpts,
      'checkin.cityIndex': 0,
      'checkin.city': cityOpts[0] || '',
    })
  },

  onCityPick(e) {
    const cIdx = Number(e.detail.value) || 0
    const cityOpts = this.data.checkin.cityOptions || []
    this.setData({ 'checkin.cityIndex': cIdx, 'checkin.city': cityOpts[cIdx] || '' })
  },

  onCheckinTitle(e) { this.setData({ 'checkin.title': e.detail.value }) },

  choosePhoto() {
    wx.chooseMedia({
      count: 4, mediaType: ['image'], sourceType: ['album', 'camera'],
      success: (res) => {
        const existing = this.data.checkin.photos || []
        const newFiles = res.tempFiles.map(f => f.tempFilePath)
        this.setData({ 'checkin.photos': [...existing, ...newFiles].slice(0, 4) })
        wx.showToast({ title: `已放入 ${newFiles.length} 张照片`, icon: 'none' })
      },
    })
  },

  removePhoto(e) {
    const idx = e.currentTarget.dataset.idx
    const photos = [...this.data.checkin.photos]
    photos.splice(idx, 1)
    this.setData({ 'checkin.photos': photos })
  },

  async saveCheckin() {
    const { lat, lng, city, province, title, photos } = this.data.checkin
    if (!city) { wx.showToast({ title: '请填写城市', icon: 'none' }); return }
    const user = app.getUser()
    if (!user || !user.openid) return
    const coord = validCoord(lat, lng)
    this.setData({ 'checkin.saving': true })
    wx.showLoading({ title: '正在收藏这段路…', mask: true })
    try {
      // 1. 创建足迹
      const today = new Date().toISOString().slice(0, 10)
      const res = await api.admin({
        action: 'add_journey',
        openid: user.openid,
        city,
        province,
        date: today,
        latitude: coord ? coord.latitude : '',
        longitude: coord ? coord.longitude : '',
        coverTone: 'tone-slate',
        season: this.data.checkin.season || '',
        weather: this.data.checkin.weather || '',
        title: title || '',
        intro: '',
      })
      const journeyId = res.id
      // 2. 依次上传照片并关联
      let done = 0
      for (const filePath of photos) {
        try {
          const up = await api.uploadImage(filePath, user.openid)
          if (up.imageUrl) await api.admin({ action: 'add_journey_photo', openid: user.openid, journeyId, imageUrl: up.imageUrl, tone: 'tone-ink' })
        } catch { /* 单张失败继续 */ }
        done += 1
        if (photos.length) wx.showLoading({ title: `收藏照片 ${done}/${photos.length}`, mask: true })
      }
      wx.hideLoading()
      this.setData({ 'checkin.saving': false })
      wx.showToast({ title: '这段路收好了', icon: 'success' })
      this.closeCheckin()
      this.loadAll()
    } catch (e) {
      wx.hideLoading()
      this.setData({ 'checkin.saving': false })
      wx.showToast({ title: (e && e.data && e.data.message) || '这次打卡没保存成功', icon: 'none' })
    }
  },

  toggleHeat() {
    this.setData({ showHeat: !this.data.showHeat })
  },

  toggleRoute() {
    const show = !this.data.showRoute
    wx.vibrateShort && wx.vibrateShort({ type: 'light' })
    if (show) {
      // 按日期排序的连线
      const pts = (this._all || [])
        .map(j => ({ ...j, coord: validCoord(j.latitude, j.longitude) }))
        .filter(j => j.coord)
        .sort((a, b) => String(a.date).localeCompare(String(b.date)))
        .map(j => j.coord)
      if (pts.length < 2) { wx.showToast({ title: '至少需要2个有坐标的足迹', icon: 'none' }); return }
      const polyline = [{
        points: pts,
        color: '#1b1712',
        width: 2,
        dottedLine: false,
      }]
      this.setData({ showRoute: true, polyline })
    } else {
      this.setData({ showRoute: false, polyline: [] })
    }
  },

  async loadCompare() {
    if (this.data.compareLoading) return
    const user = app.getUser()
    if (!user || !user.openid) { wx.showToast({ title: '请先登录', icon: 'none' }); return }
    this.setData({ compareLoading: true })
    try {
      const r = await api.admin({ action: 'journey_compare', openid: user.openid })
      this.setData({ compare: r, compareLoading: false, showCompare: true })
    } catch {
      this.setData({ compareLoading: false })
      wx.showToast({ title: '足迹对比暂时没取到', icon: 'none' })
    }
  },

  closeCompare() { this.setData({ showCompare: false }) },

  noop() {},
})
