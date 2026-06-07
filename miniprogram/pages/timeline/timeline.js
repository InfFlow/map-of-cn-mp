const api = require('../../utils/api')
const { prettyDate, toneGradient, anniversaryCount, weatherGlyph, seasonGlyph } = require('../../utils/util')
const { REGIONS, PROVINCES } = require('../../utils/regions')
const app = getApp()

function validCoord(lat, lng) {
  const latitude = Number(lat)
  const longitude = Number(lng)
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null
  return { latitude, longitude }
}

Page({
  data: {
    trips: [],
    anniversaries: [],
    loading: true,
    showTop: false,
    error: '',
    filterYear: '',
    filterSeason: '',
    years: [],
    seasons: ['春', '夏', '秋', '冬'],
    filtered: [],
    aiEnabled: false,
    PROVINCES: PROVINCES,
    recorder: { show: false, saving: false, provinceIndex: 0, cityIndex: 0, cityOptions: [], province: '', city: '', date: '', title: '', intro: '', season: '', photos: [] },
  },

  onLoad() {
    this.load()
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 1, hidden: !!this.data.recorder.show })
    }
    app.syncAiEnabled && app.syncAiEnabled(this)
  },

  onShareAppMessage() {
    return {
      title: '我们走过的日子',
      path: '/pages/timeline/timeline',
    }
  },

  onShareTimeline() {
    return { title: '我们走过的日子' }
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
          seasonIcon: seasonGlyph(j.season),
          weatherIcon: weatherGlyph(j.weather),
          weather: j.weather || '',
        }
      })
      const anniversaries = (data.anniversaries || []).map((a) => {
        const c = anniversaryCount(a.date, a.repeatYearly)
        return {
          ...a,
          dateText: prettyDate(a.date),
          dateShort: String(a.date),
          countText: c.text,
          countKind: c.kind,
          countSub: c.sub || '',
        }
      })
      // 提取年份列表
      const years = [...new Set(trips.map(t => String(t.dateShort).slice(0, 4)).filter(Boolean))].sort().reverse()
      this._trips = trips
      this.setData({ anniversaries, loading: false, years, filterYear: '', filterSeason: '' }, () => this.applyFilter())
    } catch (e) {
      this.setData({ loading: false, error: '这次没翻到时间线，请稍后再试' })
    }
  },

  applyFilter() {
    const { filterYear, filterSeason } = this.data
    const all = this._trips || []
    let list = all
    if (filterYear) list = list.filter(t => String(t.dateShort).startsWith(filterYear))
    if (filterSeason) list = list.filter(t => t.season === filterSeason)
    // 重新计算 yearHead
    let lastYear = ''
    const filtered = list.map((t, i) => {
      const year = String(t.dateShort).slice(0, 4)
      const yearHead = year !== lastYear ? year : ''
      lastYear = year
      return { ...t, no: String(i + 1).padStart(2, '0'), yearHead }
    })
    this.setData({ filtered })
  },

  setYear(e) {
    const y = e.currentTarget.dataset.y === this.data.filterYear ? '' : e.currentTarget.dataset.y
    wx.vibrateShort && wx.vibrateShort({ type: 'light' })
    this.setData({ filterYear: y }, () => this.applyFilter())
  },

  setSeason(e) {
    const s = e.currentTarget.dataset.s === this.data.filterSeason ? '' : e.currentTarget.dataset.s
    wx.vibrateShort && wx.vibrateShort({ type: 'light' })
    this.setData({ filterSeason: s }, () => this.applyFilter())
  },

  async onPullDownRefresh() {
    await this.load()
    wx.stopPullDownRefresh()
  },

  retry() {
    wx.vibrateShort && wx.vibrateShort({ type: 'light' })
    this.load()
  },

  openDetail(e) {
    const id = e.currentTarget.dataset.id
    wx.vibrateShort && wx.vibrateShort({ type: 'light' })
    wx.navigateTo({ url: `/pages/detail/detail?id=${id}` })
  },

  // 长按某条足迹 → 收起这段（仅从时间线列表拿掉，后台可恢复）
  onTripHold(e) {
    const id = e.currentTarget.dataset.id
    const trip = (this._trips || []).find((t) => t.id === id)
    if (!trip) return
    const user = app.getUser && app.getUser()
    if (!user || !user.openid) {
      wx.showToast({ title: '登录后就能一起整理', icon: 'none' })
      return
    }
    wx.vibrateShort && wx.vibrateShort({ type: 'medium' })
    wx.showActionSheet({
      itemList: ['先收起这段回忆', '查看详情'],
      success: (res) => {
        if (res.tapIndex === 0) this.hideTrip(id, trip)
        if (res.tapIndex === 1) wx.navigateTo({ url: `/pages/detail/detail?id=${id}` })
      },
    })
  },

  async hideTrip(id, trip) {
    const user = app.getUser()
    if (!user || !user.openid) return
    wx.showModal({
      title: '先收起这段回忆？',
      content: `「${trip.city || ''}${trip.title ? ' · ' + trip.title : ''}」将不再显示在时间线，可在「编辑我们的回忆」里恢复。`,
      confirmText: '收起',
      success: async (r) => {
        if (!r.confirm) return
        try {
          await api.admin({ action: 'toggle_journey', openid: user.openid, id })
          // 从本地列表拿掉并刷新
          this._trips = (this._trips || []).filter((t) => t.id !== id)
          this.applyFilter()
          wx.showToast({ title: '已收起', icon: 'success' })
        } catch {
          wx.showToast({ title: '暂时没处理成功，请重试', icon: 'none' })
        }
      },
    })
  },

  // ===== 记录一段回忆 =====
  setTabBarHidden(hidden) {
    const tb = typeof this.getTabBar === 'function' ? this.getTabBar() : null
    if (tb) tb.setData({ hidden })
  },

  openRecorder() {
    const user = app.getUser && app.getUser()
    if (!user || !user.openid) { wx.showToast({ title: '请先登录', icon: 'none' }); return }
    wx.vibrateShort && wx.vibrateShort({ type: 'light' })
    const province = PROVINCES[0]
    const cityOptions = REGIONS[province] || []
    this.setData({
      recorder: {
        show: true,
        saving: false,
        provinceIndex: 0,
        cityIndex: 0,
        cityOptions,
        province,
        city: cityOptions[0] || '',
        date: new Date().toISOString().slice(0, 10),
        title: '',
        intro: '',
        season: '',
        photos: [],
      },
    })
    this.setTabBarHidden(true)
  },

  closeRecorder() {
    this.setData({ 'recorder.show': false })
    this.setTabBarHidden(false)
  },

  onRecProvince(e) {
    const pIdx = Number(e.detail.value) || 0
    const province = PROVINCES[pIdx]
    const cityOptions = REGIONS[province] || []
    this.setData({
      'recorder.provinceIndex': pIdx,
      'recorder.province': province,
      'recorder.cityOptions': cityOptions,
      'recorder.cityIndex': 0,
      'recorder.city': cityOptions[0] || '',
    })
  },

  onRecCity(e) {
    const cIdx = Number(e.detail.value) || 0
    const cityOptions = this.data.recorder.cityOptions || []
    this.setData({ 'recorder.cityIndex': cIdx, 'recorder.city': cityOptions[cIdx] || '' })
  },

  onRecDate(e) {
    this.setData({ 'recorder.date': e.detail.value })
  },

  onRecTitle(e) {
    this.setData({ 'recorder.title': e.detail.value })
  },

  onRecIntro(e) {
    this.setData({ 'recorder.intro': e.detail.value })
  },

  recSeason(e) {
    const s = e.currentTarget.dataset.s
    wx.vibrateShort && wx.vibrateShort({ type: 'light' })
    this.setData({ 'recorder.season': this.data.recorder.season === s ? '' : s })
  },

  recChoosePhoto() {
    wx.chooseMedia({
      count: 9, mediaType: ['image'], sourceType: ['album', 'camera'],
      success: (res) => {
        const existing = this.data.recorder.photos || []
        const newFiles = res.tempFiles.map(f => f.tempFilePath)
        this.setData({ 'recorder.photos': [...existing, ...newFiles].slice(0, 9) })
      },
    })
  },

  recRemovePhoto(e) {
    const idx = e.currentTarget.dataset.idx
    const photos = [...this.data.recorder.photos]
    photos.splice(idx, 1)
    this.setData({ 'recorder.photos': photos })
  },

  async saveRecord() {
    const r = this.data.recorder
    if (!r.city) { wx.showToast({ title: '请选择城市', icon: 'none' }); return }
    const user = app.getUser()
    if (!user || !user.openid) { wx.showToast({ title: '请先登录', icon: 'none' }); return }
    this.setData({ 'recorder.saving': true })
    wx.showLoading({ title: '保存中…', mask: true })
    try {
      // 用城市名查经纬度，让记录能落到地图上；失败时不写入假坐标。
      let lat = '', lng = ''
      try {
        const g = await api.admin({ action: 'geo', openid: user.openid, address: r.city, city: r.city })
        const coord = g ? validCoord(g.latitude, g.longitude) : null
        if (coord) { lat = coord.latitude; lng = coord.longitude }
      } catch (e) {}
      const res = await api.admin({ action: 'add_journey', openid: user.openid, city: r.city, province: r.province, date: r.date, season: r.season || '', weather: '', landmark: '', title: r.title || '', intro: r.intro || '', coverTone: 'tone-slate', latitude: lat, longitude: lng, tags: [], notes: r.intro ? [r.intro] : [] })
      const jid = res.id
      for (const fp of r.photos) {
        try { const up = await api.uploadImage(fp, user.openid); if (up.imageUrl) await api.admin({ action: 'add_journey_photo', openid: user.openid, journeyId: jid, imageUrl: up.imageUrl, tone: 'tone-ink' }) } catch (e) {}
      }
      wx.hideLoading(); this.setData({ 'recorder.saving': false })
      wx.showToast({ title: '已记录', icon: 'success' })
      this.closeRecorder()
      this.load()
    } catch (e) {
      wx.hideLoading(); this.setData({ 'recorder.saving': false })
      wx.showToast({ title: '这段回忆暂时没保存成功', icon: 'none' })
    }
  },

  noop() {},
})
