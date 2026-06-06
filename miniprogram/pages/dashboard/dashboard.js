const api = require('../../utils/api')

// 大圆距离（公里）
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

function validCoord(lat, lng) {
  const latitude = Number(lat)
  const longitude = Number(lng)
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null
  return { lat: latitude, lng: longitude }
}

// 由月份推季节（date 形如 "2024.05.01"）
function seasonOf(dotted) {
  const m = Number(String(dotted).split('.')[1])
  if (m >= 3 && m <= 5) return '春'
  if (m >= 6 && m <= 8) return '夏'
  if (m >= 9 && m <= 11) return '秋'
  return '冬'
}

// 点分日期 -> Date（无效返回 null）
function parseDot(dotted) {
  const parts = String(dotted || '').split('.').map(Number)
  if (parts.length < 3 || !parts[0]) return null
  const d = new Date(parts[0], (parts[1] || 1) - 1, parts[2] || 1)
  return isNaN(d.getTime()) ? null : d
}

// 从纪念日推算「在一起天数」：优先 repeatYearly / repeat_yearly，否则取最早纪念日
function daysFromAnniversaries(anniversaries) {
  const list = (anniversaries || []).filter((a) => a && a.date)
  if (!list.length) return null
  const base =
    list.find((a) => a.repeatYearly || a.repeat_yearly) ||
    list.slice().sort((x, y) => String(x.date).localeCompare(String(y.date)))[0]
  const start = parseDot(base.date)
  if (!start) return null
  return Math.max(0, Math.floor((Date.now() - start.getTime()) / 86400000) + 1)
}

// 计数对象 -> 带百分比宽度的条形数据
function toBars(map, keys) {
  const ks = keys || Object.keys(map)
  const max = Math.max(1, ...ks.map((k) => map[k] || 0))
  return ks.map((k) => ({
    label: k,
    count: map[k] || 0,
    pct: Math.round(((map[k] || 0) / max) * 100),
  }))
}

Page({
  data: {
    loading: true,
    error: '',
    nums: { cities: 0, provinces: 0, memories: 0, photos: 0, km: 0, days: 0 },
    yearBars: [],
    seasonBars: [],
    topCities: [],
    latest: null,
    tags: [],
    showTop: false,
  },

  onLoad() {
    this.loadData()
  },

  onShareAppMessage() {
    return {
      title: '我们旅途的全部数字',
      path: '/pages/dashboard/dashboard',
    }
  },

  onShareTimeline() {
    return { title: '我们旅途的全部数字' }
  },

  onPullDownRefresh() {
    this.loadData().then(() => wx.stopPullDownRefresh())
  },

  retry() {
    wx.vibrateShort && wx.vibrateShort({ type: 'light' })
    this.loadData()
  },

  onPageScroll(e) {
    const show = e.scrollTop > 480
    if (show !== this.data.showTop) this.setData({ showTop: show })
  },

  backToTop() {
    wx.pageScrollTo({ scrollTop: 0, duration: 300 })
  },

  // 数字从0缓动到目标值，key 支持 'nums.cities' 这种路径
  animateNumber(key, target, duration) {
    target = Number(target) || 0
    if (target <= 0) { this.setData({ [key]: 0 }); return }
    const start = Date.now()
    const d = duration || 700
    const ease = (t) => 1 - Math.pow(1 - t, 3) // easeOutCubic
    const tick = () => {
      const p = Math.min(1, (Date.now() - start) / d)
      const val = Math.round(target * ease(p))
      this.setData({ [key]: val })
      if (p < 1) setTimeout(tick, 32)
    }
    tick()
  },

  async loadData() {
    this.setData({ loading: true, error: '' })
    try {
      const data = await api.getJourneys()
      const journeys = data.journeys || []
      const anniversaries = data.anniversaries || []

      // 顶部大数字
      const cities = new Set(journeys.map((j) => j.city).filter(Boolean)).size
      const provinces = new Set(journeys.map((j) => j.province).filter(Boolean)).size
      const memories = journeys.length
      let photos = 0
      journeys.forEach((j) => { photos += (j.photos || []).length })

      // 总里程：按日期连点求大圆距离
      const pts = journeys
        .map((j) => ({ ...j, coord: validCoord(j.latitude, j.longitude) }))
        .filter((j) => j.coord)
        .slice()
        .sort((a, b) => String(a.date).localeCompare(String(b.date)))
        .map((j) => j.coord)
      let km = 0
      for (let i = 1; i < pts.length; i++) km += haversine(pts[i - 1], pts[i])
      km = Math.round(km)

      // 在一起天数：先用纪念日，否则用最早 journey 日期
      let days = daysFromAnniversaries(anniversaries)
      if (days == null) {
        const earliest = journeys
          .map((j) => parseDot(j.date))
          .filter(Boolean)
          .sort((a, b) => a - b)[0]
        days = earliest
          ? Math.max(0, Math.floor((Date.now() - earliest.getTime()) / 86400000) + 1)
          : 0
      }

      // 年度趋势
      const yearMap = {}
      journeys.forEach((j) => {
        const y = String(j.date || '').split('.')[0]
        if (y) yearMap[y] = (yearMap[y] || 0) + 1
      })
      const yearBars = toBars(yearMap, Object.keys(yearMap).sort())
        .filter((b) => b.count > 0)
        .map((b) => ({ year: b.label, count: b.count, pct: b.pct }))

      // 季节分布（带字符图标，一眼区分）
      const seasonMap = { 春: 0, 夏: 0, 秋: 0, 冬: 0 }
      journeys.forEach((j) => { seasonMap[seasonOf(j.date)] += 1 })
      const seasonIcons = { 春: '🌱', 夏: '☀', 秋: '🍂', 冬: '❄' }
      const seasonBars = toBars(seasonMap, ['春', '夏', '秋', '冬']).map((b) => ({
        label: b.label,
        count: b.count,
        pct: b.pct,
        icon: seasonIcons[b.label] || '',
      }))

      // Top 城市
      const cityMap = {}
      journeys.forEach((j) => {
        if (j.city) cityMap[j.city] = (cityMap[j.city] || 0) + 1
      })
      const cityKeys = Object.keys(cityMap)
        .sort((a, b) => cityMap[b] - cityMap[a])
        .slice(0, 5)
      const topCities = toBars(cityMap, cityKeys)
        .map((b) => ({ city: b.label, count: b.count, pct: b.pct }))
        .filter((b) => b.count > 0)
        .map((b, i) => ({
          city: b.city,
          count: b.count,
          pct: b.pct,
          rank: i < 9 ? '0' + (i + 1) : String(i + 1),
          top: i === 0,
        }))

      // 最近一段回忆
      const sortedByDate = journeys
        .slice()
        .filter((j) => j.date)
        .sort((a, b) => String(b.date).localeCompare(String(a.date)))
      const last = sortedByDate[0]
      let latest = null
      if (last) {
        const cover = (last.photos || []).map((p) => p && p.imageUrl).filter(Boolean)[0] || ''
        latest = {
          city: last.city || '',
          title: last.title || '',
          cover,
          date: String(last.date || ''),
        }
      }

      // 标签频次 Top10
      const tagMap = {}
      journeys.forEach((j) => {
        ;(j.tags || []).forEach((t) => {
          const name = typeof t === 'string' ? t : (t && (t.name || t.label)) || ''
          if (name) tagMap[name] = (tagMap[name] || 0) + 1
        })
      })
      const tags = Object.keys(tagMap)
        .sort((a, b) => tagMap[b] - tagMap[a])
        .slice(0, 10)
        .map((name) => ({ name, count: tagMap[name] }))

      this.setData({
        loading: false,
        error: '',
        nums: { cities, provinces, memories, photos, km, days },
        yearBars,
        seasonBars,
        topCities,
        latest,
        tags,
      })

      // 首次加载：大数字从0滚动到真实值，下拉刷新不再滚动
      if (!this._animated) {
        this._animated = true
        this.setData({ nums: { cities: 0, provinces: 0, memories: 0, photos: 0, km: 0, days: 0 } })
        this.animateNumber('nums.cities', cities, 600)
        this.animateNumber('nums.provinces', provinces, 700)
        this.animateNumber('nums.memories', memories, 750)
        this.animateNumber('nums.photos', photos, 800)
        this.animateNumber('nums.km', km, 900)
        this.animateNumber('nums.days', days, 850)
      }
    } catch (e) {
      this.setData({ loading: false, error: '先给你看上次保存的回忆，网络恢复后再更新' })
    }
  },
})
