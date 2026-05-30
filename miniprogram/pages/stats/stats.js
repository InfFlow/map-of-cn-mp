const app = getApp()
const api = require('../../utils/api')

const EXP_CAT_LABEL = {
  food: '吃',
  hotel: '住',
  transport: '行',
  ticket: '门票',
  shopping: '购物',
  other: '其他',
}
const CAT_ORDER = ['food', 'hotel', 'transport', 'ticket', 'shopping', 'other']

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

// 把计数对象转成带百分比宽度的条形数据
function toBars(map, order) {
  const keys = order || Object.keys(map)
  const max = Math.max(1, ...keys.map((k) => map[k] || 0))
  return keys
    .map((k) => ({ label: k, value: map[k] || 0, pct: Math.round(((map[k] || 0) / max) * 100) }))
    .filter((b) => b.value > 0)
}

Page({
  data: {
    loading: true,
    error: '',
    stats: { provinceCount: 0, cityCount: 0, journeyCount: 0 },
    totalKm: 0,
    provBars: [],
    seasonBars: [],
    yearBars: [],
    // 消费
    needLogin: false,
    expLoading: false,
    expTotal: 0,
    expBars: [],
    expCount: 0,
    showTop: false,
  },

  onLoad() {
    this.loadStats()
  },

  onPullDownRefresh() {
    this.loadStats().then(() => wx.stopPullDownRefresh())
  },

  onPageScroll(e) {
    const show = e.scrollTop > 480
    if (show !== this.data.showTop) this.setData({ showTop: show })
  },

  backToTop() {
    wx.pageScrollTo({ scrollTop: 0, duration: 300 })
  },

  async loadStats() {
    try {
      const data = await api.getJourneys()
      const journeys = data.journeys || []

      const provinceCount = new Set(journeys.map((j) => j.province).filter(Boolean)).size
      const cityCount = new Set(journeys.map((j) => j.city).filter(Boolean)).size
      const journeyCount = journeys.length

      // 总里程：按日期排序连点求大圆距离
      const pts = [...journeys]
        .filter((j) => j.latitude && j.longitude)
        .sort((a, b) => String(a.date).localeCompare(String(b.date)))
        .map((j) => ({ lat: j.latitude, lng: j.longitude }))
      let totalKm = 0
      for (let i = 1; i < pts.length; i++) totalKm += haversine(pts[i - 1], pts[i])
      totalKm = Math.round(totalKm)

      // 省份分布（按段数）
      const provMap = {}
      journeys.forEach((j) => {
        if (j.province) provMap[j.province] = (provMap[j.province] || 0) + 1
      })
      const provBars = toBars(provMap)
        .sort((a, b) => b.value - a.value)
        .slice(0, 8)

      // 季节分布（按月份推季节）
      const seasonMap = { 春: 0, 夏: 0, 秋: 0, 冬: 0 }
      journeys.forEach((j) => {
        seasonMap[seasonOf(j.date)] += 1
      })
      const seasonBars = toBars(seasonMap, ['春', '夏', '秋', '冬'])

      // 年度足迹
      const yearMap = {}
      journeys.forEach((j) => {
        const y = String(j.date).split('.')[0]
        if (y) yearMap[y] = (yearMap[y] || 0) + 1
      })
      const yearBars = toBars(
        yearMap,
        Object.keys(yearMap).sort()
      )

      this.setData({
        stats: { provinceCount, cityCount, journeyCount },
        totalKm,
        provBars,
        seasonBars,
        yearBars,
        loading: false,
        error: '',
      })

      this.loadExpenses()
    } catch (e) {
      this.setData({ loading: false, error: '加载失败，请检查网络' })
    }
  },

  async loadExpenses() {
    const user = app.globalData.user || wx.getStorageSync('user')
    const openid = user && user.openid ? user.openid : ''
    if (!openid) {
      this.setData({ needLogin: true })
      return
    }
    this.setData({ needLogin: false, expLoading: true })
    try {
      const { plans } = await api.getPlans()
      const catSum = {}
      let total = 0
      let count = 0
      for (const p of plans || []) {
        try {
          const r = await api.admin({ action: 'expenses', openid, planId: p.id })
          ;(r.expenses || []).forEach((e) => {
            const amt = Number(e.amount) || 0
            catSum[e.category] = (catSum[e.category] || 0) + amt
            total += amt
            count += 1
          })
        } catch (err) {
          // 单个行程读失败不影响整体
        }
      }
      const max = Math.max(1, ...CAT_ORDER.map((k) => catSum[k] || 0))
      const expBars = CAT_ORDER.map((k) => ({
        label: EXP_CAT_LABEL[k],
        value: Math.round(catSum[k] || 0),
        pct: Math.round(((catSum[k] || 0) / max) * 100),
      })).filter((b) => b.value > 0)
      this.setData({
        expLoading: false,
        expTotal: Math.round(total),
        expBars,
        expCount: count,
      })
    } catch (e) {
      this.setData({ expLoading: false })
    }
  },

  goLogin() {
    wx.vibrateShort && wx.vibrateShort({ type: 'light' })
    wx.switchTab({ url: '/pages/mine/mine' })
  },
})
