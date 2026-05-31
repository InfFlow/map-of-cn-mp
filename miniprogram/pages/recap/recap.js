const api = require('../../utils/api')
const { buildRecapPoster } = require('../../utils/poster')

function haversine(a, b) {
  const R = 6371
  const toRad = (d) => (d * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(s))
}

function seasonOf(dotted) {
  const m = Number(String(dotted).split('.')[1])
  if (m >= 3 && m <= 5) return '春'
  if (m >= 6 && m <= 8) return '夏'
  if (m >= 9 && m <= 11) return '秋'
  return '冬'
}

function cityKey(c) {
  return String(c || '').replace(/市|地区|自治州|自治县|盟$/g, '') || '其他'
}

function yearOf(dotted) {
  return String(dotted || '').split('.')[0] || ''
}

// 终身成就（不分年）
const BADGE_DEFS = [
  { need: 3, type: 'province', name: '三省通行' },
  { need: 5, type: 'province', name: '五省点亮' },
  { need: 10, type: 'province', name: '十省纵横' },
  { need: 5, type: 'city', name: '五城打卡' },
  { need: 10, type: 'city', name: '十城足迹' },
  { need: 20, type: 'city', name: '廿城漫游' },
]

Page({
  data: {
    loading: true,
    error: '',
    years: [],          // [{ value:'2024', label:'2024' }] + 全部
    selectedYear: '',   // '' = 全部
    headline: '',
    nums: { cityCount: 0, spotCount: 0, provinceCount: 0, totalKm: 0 },
    topCities: [],
    seasonBars: [],
    stamps: [],         // 城市集章
    badges: [],         // 终身成就
    unlocked: 0,
    hasPhotos: false,
    // 回忆放映
    showShow: false,
    slides: [],
    // 海报
    posterMaking: false,
    posterW: 300,
    posterH: 100,
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
      const journeys = data.journeys || []
      this._all = journeys

      const years = [...new Set(journeys.map((j) => yearOf(j.date)).filter(Boolean))]
        .sort((a, b) => b.localeCompare(a))
        .map((y) => ({ value: y, label: y }))

      // 终身成就（用全量数据）
      const provAll = new Set(journeys.map((j) => j.province).filter(Boolean)).size
      const cityAll = new Set(journeys.map((j) => cityKey(j.city)).filter(Boolean)).size
      const badges = BADGE_DEFS.map((b) => ({
        name: b.name,
        need: b.need,
        unit: b.type === 'province' ? '省' : '城',
        on: (b.type === 'province' ? provAll : cityAll) >= b.need,
      }))
      this._badges = badges

      this.setData({ years, selectedYear: '', loading: false }, () => this.recompute())
    } catch (e) {
      this.setData({ loading: false, error: '加载失败，请检查网络' })
    }
  },

  selectYear(e) {
    const y = e.currentTarget.dataset.year || ''
    if (y === this.data.selectedYear) return
    wx.vibrateShort && wx.vibrateShort({ type: 'light' })
    this.setData({ selectedYear: y }, () => this.recompute())
  },

  recompute() {
    const all = this._all || []
    const y = this.data.selectedYear
    const list = y ? all.filter((j) => yearOf(j.date) === y) : all

    const cityCount = new Set(list.map((j) => cityKey(j.city)).filter(Boolean)).size
    const provinceCount = new Set(list.map((j) => j.province).filter(Boolean)).size
    const spotCount = list.length

    // 里程：按日期连点求大圆距离
    const pts = list
      .filter((j) => j.latitude != null && j.longitude != null)
      .sort((a, b) => String(a.date).localeCompare(String(b.date)))
      .map((j) => ({ lat: j.latitude, lng: j.longitude }))
    let totalKm = 0
    for (let i = 1; i < pts.length; i++) totalKm += haversine(pts[i - 1], pts[i])
    totalKm = Math.round(totalKm)

    // 城市频次
    const cityMap = {}
    list.forEach((j) => {
      const k = cityKey(j.city)
      if (!cityMap[k]) cityMap[k] = { city: j.city || '其他', count: 0 }
      cityMap[k].count += 1
    })
    const cityArr = Object.values(cityMap).sort((a, b) => b.count - a.count)
    const maxCity = Math.max(1, ...cityArr.map((c) => c.count))
    const topCities = cityArr.slice(0, 6).map((c) => ({
      city: c.city, count: c.count, pct: Math.round((c.count / maxCity) * 100),
    }))
    const stamps = cityArr.map((c) => ({ city: c.city, count: c.count }))

    // 季节
    const seasonMap = { 春: 0, 夏: 0, 秋: 0, 冬: 0 }
    list.forEach((j) => { seasonMap[seasonOf(j.date)] += 1 })
    const maxS = Math.max(1, ...Object.values(seasonMap))
    const seasonBars = ['春', '夏', '秋', '冬']
      .map((k) => ({ label: k, value: seasonMap[k], pct: Math.round((seasonMap[k] / maxS) * 100) }))
      .filter((b) => b.value > 0)

    const scopeText = y ? y + ' 年' : '这些年'
    const headline = `${scopeText}一起去了 ${cityCount} 城 · ${spotCount} 个地方 · 走了 ${totalKm} 公里`

    const hasPhotos = list.some((j) => (j.photos || []).some((p) => p.imageUrl))

    this.setData({
      headline,
      nums: { cityCount, spotCount, provinceCount, totalKm },
      topCities,
      seasonBars,
      stamps,
      badges: this._badges || [],
      unlocked: (this._badges || []).filter((b) => b.on).length,
      hasPhotos,
    })
  },

  // 回忆放映：把当前范围照片按时间顺序做成自动播放幻灯
  playMemories() {
    const all = this._all || []
    const y = this.data.selectedYear
    const list = (y ? all.filter((j) => yearOf(j.date) === y) : all)
      .slice()
      .sort((a, b) => String(a.date).localeCompare(String(b.date)))
    const slides = []
    list.forEach((j) => {
      ;(j.photos || []).forEach((p) => {
        if (p.imageUrl) slides.push({ url: p.imageUrl, city: j.city || '', date: String(j.date || '') })
      })
    })
    if (!slides.length) {
      wx.showToast({ title: '这段时间还没有照片', icon: 'none' })
      return
    }
    wx.vibrateShort && wx.vibrateShort({ type: 'light' })
    this.setData({ slides, showShow: true })
  },

  closeShow() {
    this.setData({ showShow: false })
  },

  noop() {},

  // 生成回顾海报
  exportRecap() {
    if (this.data.posterMaking) return
    const d = this.data
    const data = {
      title: (d.selectedYear ? d.selectedYear + ' 旅行回顾' : '旅行回顾'),
      headline: d.headline,
      nums: d.nums,
      topCities: d.topCities,
      stamps: d.stamps,
    }
    wx.showLoading({ title: '生成中…', mask: true })
    this.setData({ posterMaking: true })
    wx.createSelectorQuery().in(this)
      .select('#recapPoster')
      .fields({ node: true, size: true })
      .exec(async (res) => {
        try {
          const node = res && res[0] && res[0].node
          if (!node) throw new Error('no canvas')
          const tempFilePath = await buildRecapPoster(node, data)
          wx.hideLoading(); this.setData({ posterMaking: false })
          this.previewPoster(tempFilePath)
        } catch (e) {
          wx.hideLoading(); this.setData({ posterMaking: false })
          wx.showToast({ title: '生成失败，请重试', icon: 'none' })
        }
      })
  },

  previewPoster(path) {
    wx.previewImage({
      urls: [path],
      current: path,
      // 长按可保存/转发
    })
  },
})
