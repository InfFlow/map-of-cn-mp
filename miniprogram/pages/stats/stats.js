const app = getApp()
const api = require('../../utils/api')

const ALL_PROVINCES = [
  '北京','天津','河北','山西','内蒙古','辽宁','吉林','黑龙江',
  '上海','江苏','浙江','安徽','福建','江西','山东','河南',
  '湖北','湖南','广东','广西','海南','重庆','四川','贵州',
  '云南','西藏','陕西','甘肃','青海','宁夏','新疆','香港','澳门','台湾'
]

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

function validCoord(lat, lng) {
  const latitude = Number(lat)
  const longitude = Number(lng)
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null
  return { lat: latitude, lng: longitude }
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
    provinceStats: { visited: [], unvisited: [], count: 0, total: 34 },
    provinceCells: [],
    // 消费
    needLogin: false,
    expLoading: false,
    expTotal: 0,
    expBars: [],
    expCount: 0,
    showTop: false,
    // 年历
    calendar: [],
    calYear: '',
    calYears: [],
  },

  onLoad() {
    this.loadStats()
  },

  onPullDownRefresh() {
    this.loadStats().then(() => wx.stopPullDownRefresh())
  },

  retry() {
    wx.vibrateShort && wx.vibrateShort({ type: 'light' })
    this.loadStats()
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
        .map((j) => ({ ...j, coord: validCoord(j.latitude, j.longitude) }))
        .filter((j) => j.coord)
        .sort((a, b) => String(a.date).localeCompare(String(b.date)))
        .map((j) => j.coord)
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

      // 34省打卡进度：把数据库省名归一到标准简称再精确匹配
      const normProv = (raw) => {
        let p = String(raw || '').trim()
        if (!p) return ''
        // 去掉常见后缀
        p = p.replace(/(省|市|特别行政区|壮族自治区|回族自治区|维吾尔自治区|自治区)$/g, '')
        // 标准简称兜底映射
        const alias = {
          '内蒙': '内蒙古', '广西壮族': '广西', '宁夏回族': '宁夏',
          '新疆维吾尔': '新疆', '西藏': '西藏',
        }
        if (alias[p]) return alias[p]
        // 与标准表精确比对：标准名以归一名开头（如"黑龙江"含"黑龙江"）
        const hit = ALL_PROVINCES.find((s) => s === p || s.startsWith(p) || p.startsWith(s))
        return hit || p
      }
      const visitedSet = new Set(
        journeys.map((j) => normProv(j.province)).filter(Boolean)
      )
      const visitedList = ALL_PROVINCES.filter((p) => visitedSet.has(p))
      const unvisitedList = ALL_PROVINCES.filter((p) => !visitedSet.has(p))
      // 每个省带 on 状态，wxml 直接渲染，避免两个列表不一致
      const provinceCells = ALL_PROVINCES.map((p) => ({ name: p, on: visitedSet.has(p) }))

      this.setData({
        stats: { provinceCount, cityCount, journeyCount },
        totalKm,
        provBars,
        seasonBars,
        yearBars,
        provinceStats: { visited: visitedList, unvisited: unvisitedList, count: visitedList.length, total: 34 },
        provinceCells,
        loading: false,
        error: '',
      })

      // 年历数据
      const years = [...new Set((journeys || []).map(j => String(j.date || '').slice(0, 4)).filter(Boolean))].sort().reverse()
      const calYear = years[0] || String(new Date().getFullYear())
      this._journeys = journeys
      this.setData({ calYears: years, calYear }, () => this.buildCalendar())

      this.loadExpenses()
    } catch (e) {
      this.setData({ loading: false, error: '先给你看上次保存的回忆，网络恢复后再更新' })
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

  buildCalendar() {
    const year = parseInt(this.data.calYear)
    const journeys = this._journeys || []
    // 建立日期到旅行记录的映射
    const dateMap = {}
    journeys.forEach(j => {
      const d = String(j.date || '').slice(0, 10).replace(/\./g, '-')
      if (d.startsWith(String(year))) {
        if (!dateMap[d]) dateMap[d] = []
        dateMap[d].push(j)
      }
    })
    // 生成12个月的日历
    const months = []
    for (let m = 1; m <= 12; m++) {
      const firstDay = new Date(year, m - 1, 1).getDay() // 0=周日
      const daysInMonth = new Date(year, m, 0).getDate()
      const cells = []
      for (let i = 0; i < firstDay; i++) cells.push({ empty: true })
      for (let d = 1; d <= daysInMonth; d++) {
        const key = `${year}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`
        cells.push({ day: d, key, has: !!dateMap[key], city: dateMap[key] ? dateMap[key][0].city : '' })
      }
      months.push({ month: m, cells })
    }
    this.setData({ calendar: months })
  },

  switchCalYear(e) {
    this.setData({ calYear: e.currentTarget.dataset.y }, () => this.buildCalendar())
  },

  goLogin() {
    wx.vibrateShort && wx.vibrateShort({ type: 'light' })
    wx.switchTab({ url: '/pages/mine/mine' })
  },
})
