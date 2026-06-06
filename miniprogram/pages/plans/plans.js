const app = getApp()
const api = require('../../utils/api')
const { toneGradient, TONE_LIST, TONE_NAMES } = require('../../utils/util')
const { buildItineraryPoster } = require('../../utils/poster')
const { markdownToHtml } = require('../../utils/markdown')

const ROW_RPX = 252
const DAY_HEAD_RPX = 178
const RECO_LABEL = { walking: '步行', transit: '公交 / 地铁', driving: '驾车' }
// 每天一种颜色，地图上区分不同天的路线
const DAY_COLORS = ['#1b1712', '#b4423a', '#2f6f4f', '#3a5ba0', '#9a6b2f', '#7a4fa0', '#2f8a8a', '#a03f6b']
function dayColor(day) { return DAY_COLORS[((Number(day) || 1) - 1) % DAY_COLORS.length] }
function validCoord(lat, lng) {
  const latitude = Number(lat)
  const longitude = Number(lng)
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null
  return { latitude, longitude }
}
function weatherLine(w) {
  if (!w) return ''
  const desc = w.dayWeather || w.weather || ''
  const dayTemp = w.dayTemp != null && w.dayTemp !== '' ? w.dayTemp : null
  const nightTemp = w.nightTemp != null && w.nightTemp !== '' ? w.nightTemp : null
  const temp = dayTemp != null && nightTemp != null
    ? `${nightTemp}~${dayTemp}°`
    : (w.temperature != null && w.temperature !== '' ? `${w.temperature}°` : '')
  return [desc, temp].filter(Boolean).join(' ')
}
const EXP_CATS = [
  { key: 'food', name: '吃' },
  { key: 'hotel', name: '住' },
  { key: 'transport', name: '行' },
  { key: 'ticket', name: '门票' },
  { key: 'shopping', name: '购物' },
  { key: 'other', name: '其他' },
]
const EXP_CAT_LABEL = EXP_CATS.reduce((m, c) => ((m[c.key] = c.name), m), {})

function toDotted(d) {
  if (!d) return ''
  return String(d).slice(0, 10).replace(/-/g, '.')
}
function toISO(d) {
  if (!d) return ''
  return String(d).slice(0, 10).replace(/\./g, '-')
}
const WEEK_CN = ['日', '一', '二', '三', '四', '五', '六']
// ISO 日期 + n 天 → 'YYYY-MM-DD'
function addDaysISO(iso, n) {
  if (!iso) return ''
  const t = new Date(iso + 'T00:00:00').getTime()
  if (isNaN(t)) return ''
  const d = new Date(t + n * 86400000)
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return d.getFullYear() + '-' + mm + '-' + dd
}
// 'YYYY-MM-DD' → '6.2 周三'
function dateLabel(iso) {
  if (!iso) return ''
  const d = new Date(iso + 'T00:00:00')
  if (isNaN(d.getTime())) return ''
  return (d.getMonth() + 1) + '.' + d.getDate() + ' 周' + WEEK_CN[d.getDay()]
}
// 起止日期 → 行程天数（含首尾），无效或缺失返回 0
function dayCount(start, end) {
  const s = toISO(start)
  const e = toISO(end)
  if (!s || !e) return 0
  const ms = new Date(e + 'T00:00:00').getTime() - new Date(s + 'T00:00:00').getTime()
  if (isNaN(ms)) return 0
  const days = Math.round(ms / 86400000) + 1
  return days > 0 ? days : 0
}
function stopCompleteness(s) {
  const missing = []
  if (!s.address) missing.push('地址')
  if (!s.openHours) missing.push('营业')
  if (!s.ticket) missing.push('门票')
  if (s.latitude == null || s.longitude == null) missing.push('定位')
  return missing.length ? '待补 ' + missing.join(' / ') : ''
}
function needsStopCompletion(s) {
  return !s.address || !s.openHours || !s.ticket || s.latitude == null || s.longitude == null
}
function planCompleteness(stops) {
  const rows = stops || []
  const total = rows.length * 4
  let done = 0
  rows.forEach((s) => {
    if (s.address) done += 1
    if (s.openHours) done += 1
    if (s.ticket) done += 1
    if (s.latitude != null && s.longitude != null) done += 1
  })
  const missing = Math.max(0, total - done)
  return {
    done,
    total,
    missing,
    text: total ? `${done}/${total}` : '0/0',
    percent: total ? Math.round((done / total) * 100) : 0,
    complete: total > 0 && done === total,
  }
}
function aiGuideCacheKey(name, context = {}) {
  const raw = [
    name || '',
    context.address || '',
    context.openHours || '',
    context.ticket || '',
    context.bookingUrl || '',
    context.note || '',
  ].join('|')
  let h = 0
  for (let i = 0; i < raw.length; i++) h = ((h << 5) - h + raw.charCodeAt(i)) | 0
  return 'ai_guide_' + Math.abs(h)
}
// 两坐标球面距离（米）
function haversineM(aLat, aLng, bLat, bLng) {
  if (aLat == null || aLng == null || bLat == null || bLng == null) return null
  const R = 6371000
  const toRad = (x) => (x * Math.PI) / 180
  const dLat = toRad(bLat - aLat)
  const dLng = toRad(bLng - aLng)
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2
  return Math.round(2 * R * Math.asin(Math.sqrt(s)))
}
// 直线距离估算「通勤分钟」：近距离按步行，远距离按城市公交/驾车均速 + 固定开销
function estimateCommuteMin(distM) {
  if (distM == null) return 0
  if (distM <= 250) return 0
  if (distM <= 1500) return Math.max(3, Math.round((distM / 1000 / 5) * 60)) // 步行 5km/h
  return Math.round((distM / 1000 / 22) * 60) + 5 // 公交/驾车均速 22km/h + 5min 开销
}
// 'HH:MM' → 分钟；非法返回 null
function hmToMin(s) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || '').trim())
  if (!m) return null
  const h = +m[1]; const mi = +m[2]
  if (h > 23 || mi > 59) return null
  return h * 60 + mi
}
// 分钟 → 'HH:MM'（跨天取模）
function minToHm(t) {
  t = ((Math.round(t) % 1440) + 1440) % 1440
  return String(Math.floor(t / 60)).padStart(2, '0') + ':' + String(t % 60).padStart(2, '0')
}
// 分钟 → '1 小时 20 分' / '40 分'
function minHuman(t) {
  t = Math.max(0, Math.round(t))
  const h = Math.floor(t / 60); const m = t % 60
  if (h && m) return h + ' 小时 ' + m + ' 分'
  if (h) return h + ' 小时'
  return m + ' 分'
}
function planMood(loadKey) {
  if (loadKey === 'full') return '节奏很满'
  if (loadKey === 'light') return '适合慢逛'
  return '从容出发'
}
// 末班车提醒：按当前时刻判断「仅剩 N 分 / 已过」（凌晨末班车做跨日处理）
function lastBusInfo(lb) {
  if (!lb || !lb.last) return { text: '', warn: false }
  const base = (lb.metro ? '🚇 ' : '🚌 ') + (lb.name || '') + ' 末班 ' + lb.last
  const end = hmToMin(lb.last)
  if (end == null) return { text: base, warn: false }
  const now = new Date()
  const cur = now.getHours() * 60 + now.getMinutes()
  let diff = end - cur
  if (diff < -180) diff += 1440 // 末班车在凌晨（如 00:30）时按次日计
  if (diff < 0) return { text: base + ' · 末班已过，建议打车', warn: true }
  if (diff <= 90) return { text: base + ' · 仅剩约 ' + minHuman(diff) + '，注意赶车', warn: true }
  return { text: base, warn: false }
}
// 估算某一天的时间表 + 通勤/游玩合计 + 节奏（太满/太松）
// startCoord {lat,lng}|null；stopsOfDay 含 latitude/longitude/stayMinutes/plannedTime
function buildDaySchedule(startCoord, stopsOfDay, startMin) {
  const DEFAULT_STAY = 60
  let t = startMin
  let prev = startCoord && startCoord.lat != null ? { lat: startCoord.lat, lng: startCoord.lng } : null
  let commuteMin = 0
  let stayMin = 0
  const rows = []
  stopsOfDay.forEach((s) => {
    const here = s.latitude != null && s.longitude != null ? { lat: s.latitude, lng: s.longitude } : null
    let legMin = 0
    if (prev && here) legMin = estimateCommuteMin(haversineM(prev.lat, prev.lng, here.lat, here.lng))
    t += legMin
    commuteMin += legMin
    const pt = hmToMin(s.plannedTime)
    if (pt != null && pt > t) t = pt // 设了计划时间且更晚则等待
    const arrive = t
    const stay = Number(s.stayMinutes) > 0 ? Number(s.stayMinutes) : DEFAULT_STAY
    stayMin += stay
    t += stay
    rows.push({
      id: s.id,
      arrive: minToHm(arrive),
      leave: minToHm(t),
      legText: legMin > 0 ? ('约 ' + minHuman(legMin)) : '',
      stayText: Number(s.stayMinutes) > 0 ? minHuman(Number(s.stayMinutes)) : '建议 ' + minHuman(DEFAULT_STAY),
      staySet: Number(s.stayMinutes) > 0,
    })
  })
  const spanMin = rows.length ? (t - startMin) : 0
  let loadKey = ''; let loadText = ''
  if (rows.length) {
    if (spanMin > 660) { loadKey = 'full'; loadText = '今天偏满，注意留出余量' }
    else if (spanMin < 240) { loadKey = 'light'; loadText = '今天较松，可再加一两个点' }
    else { loadKey = 'ok'; loadText = '节奏适中' }
  }
  return { rows, commuteMin, stayMin, spanMin, loadKey, loadText }
}
// 取某一天对应的住宿：优先匹配多段 hotels 的 [startDay,endDay]，否则回退单酒店 plan.hotel
function hotelForDay(plan, day) {
  const list = (plan && plan.hotels) || []
  for (let i = 0; i < list.length; i++) {
    const h = list[i]
    const sd = Number(h.startDay) || 1
    const ed = Number(h.endDay) || sd
    if (day >= sd && day <= ed && (h.name || h.lat != null)) return h
  }
  const single = plan && plan.hotel
  if (single && (single.name || single.lat != null)) return single
  return null
}

// 计算一组 stops 的总直线距离（米）
function totalDist(stops) {
  let d = 0
  for (let i = 1; i < stops.length; i++) {
    d += haversineM(stops[i - 1].latitude, stops[i - 1].longitude, stops[i].latitude, stops[i].longitude) || 0
  }
  return d
}

// 贪心最近邻 TSP，返回重排后的 stops 数组
function greedyTSP(stops) {
  if (stops.length <= 2) return stops.slice()
  const used = new Array(stops.length).fill(false)
  const result = [stops[0]]
  used[0] = true
  for (let i = 1; i < stops.length; i++) {
    const last = result[result.length - 1]
    let minDist = Infinity, minIdx = -1
    for (let j = 0; j < stops.length; j++) {
      if (used[j]) continue
      const d = haversineM(last.latitude, last.longitude, stops[j].latitude, stops[j].longitude)
      if (d < minDist) { minDist = d; minIdx = j }
    }
    if (minIdx >= 0) { result.push(stops[minIdx]); used[minIdx] = true }
  }
  return result
}

Page({
  data: {
    ready: false,
    loading: true,
    error: '',
    isAdmin: false,
    canEdit: false,
    openid: '',

    plans: [],
    activeIndex: 0,
    active: null,
    weatherByDate: {},

    toneList: TONE_LIST,
    toneSwatches: TONE_LIST.map((t) => ({ tone: t, grad: toneGradient(t), name: TONE_NAMES[t] || '' })),
    // 新建计划快速模板（仅预填标题/备注，可再改）
    planTemplates: [
      { name: '周末两日', title: '周末两日游', note: '两天一夜，城市周边轻松慢玩。' },
      { name: '长假五日', title: '长假五日深度游', note: '五天四夜，跨城深度，景点 + 美食。' },
    ],
    focusField: '', // 当前聚焦的输入框 key，用于描边高亮
    rowH: 88, // px，onLoad 计算
    dayHeadH: 72,
    areaH: 0,
    dragId: 0,

    // 地图可视化
    mapMarkers: [],
    mapPolyline: [],
    mapPolylineBase: [],
    mapInclude: [],
    mapCenter: { latitude: 34.5, longitude: 110 },
    mapScale: 11,
    geoStopCount: 0,
    mapDayChips: [], // 多天时的「全部 / 第N天」筛选
    mapDayFilter: 0, // 0=全部
    posterMaking: false, // 导出长图生成中
    posterW: 300,
    posterH: 100,
    // 按天分组
    multiDay: false,
    dayGroups: [],
    aiEnabled: app.globalData.aiEnabled,
    // AI 助手抽屉
    aiDrawerShow: false,
    aiDrawerPlace: '',
    aiDrawerTitle: '',
    aiDrawerLoading: false,
    aiDrawerContent: '',
    aiDrawerHtml: '',
    aiDrawerError: '',
    aiDrawerContext: {},
    aiDrawerBasis: '',
    aiDrawerCached: false,
    aiDrawerReturnStopSheet: false,
    // 预算汇总（按分类）
    budgetBars: [],
    pieCanvasW: 240,
    pieCanvasH: 240,

    expCats: EXP_CATS,
    expenses: [],
    expenseTotal: 0,
    expenseEditor: { show: false, catIndex: 0, amount: '', memo: '' },
    completingStops: false,
    completionStatus: '',

    planEditor: {
      show: false, mode: 'add', id: '', title: '', toneIndex: 0, coverTone: TONE_LIST[0],
      planDate: '', planDateEnd: '', dayCountText: '', coverImageUrl: '', uploadingCover: false, note: '',
      hotelName: '', hotelAddress: '', hotelLat: '', hotelLng: '', hotelGeoLoading: false,
    },
    stopEditor: {
      show: false, mode: 'add', id: 0, planId: '',
      name: '', address: '', plannedTime: '', stayMinutes: 0, note: '', openHours: '', ticket: '', bookingUrl: '', day: 1,
      latitude: '', longitude: '', geoLoading: false,
    },
    stayPresets: [
      { v: 30, t: '30 分' }, { v: 60, t: '1 小时' }, { v: 90, t: '1.5 小时' },
      { v: 120, t: '2 小时' }, { v: 180, t: '3 小时' }, { v: 240, t: '半天' },
    ],
    // 点击目的地弹出的「怎么去 + 一键导航」抽屉
    stopSheet: {
      show: false, id: 0, name: '', address: '', note: '', plannedTime: '', openHours: '', ticket: '', bookingUrl: '', latitude: null, longitude: null,
      originName: '', canNav: false, canRoute: false,
      route: { loading: false, error: '', mode: '', modes: [] },
    },
    // 每天出发点编辑器（默认从酒店出发，可自定义）
    dayStartEditor: {
      show: false, day: 1, name: '', address: '', lat: '', lng: '', geoLoading: false, hotelName: '',
    },
    // 当天全程路线（串联各段 + 总通勤时长）
    dayRouteSheet: {
      show: false, day: 1, label: '', loading: false, total: '', legs: [],
    },
    // 多晚 / 分段住宿编辑器
    hotelsEditor: {
      show: false, planId: '', dayMax: 0, list: [],
    },
  },

  onLoad() {
    const sys = wx.getWindowInfo ? wx.getWindowInfo() : { windowWidth: 375 }
    const rowH = Math.round((ROW_RPX * sys.windowWidth) / 750)
    const dayHeadH = Math.round((DAY_HEAD_RPX * sys.windowWidth) / 750)
    this.setData({ rowH, dayHeadH })
    const user = app.getUser()
    if (user && user.openid) this.setData({ openid: user.openid, canEdit: true })
    app.refreshAiEnabled && app.refreshAiEnabled().then((enabled) => {
      if (this.data.aiEnabled !== enabled) this.setData({ aiEnabled: enabled })
    })
    this.refreshAdminThenLoad()
  },

  onShow() {
    app.syncAiEnabled(this)
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 2, hidden: false })
    }
    // 登录可能发生在「我的」页，回到本页时同步编辑权限
    const user = app.getUser()
    const openid = user && user.openid ? user.openid : ''
    if (openid && openid !== this.data.openid) {
      this.setData({ openid, canEdit: true })
      if (this.data.ready) this.refreshAdminThenLoad()
    } else if (!openid && this.data.openid) {
      this.setData({ openid: '', canEdit: false, isAdmin: false })
      if (this.data.ready) this.load()
    }
  },

  onPullDownRefresh() {
    this.load().then(
      () => wx.stopPullDownRefresh(),
      () => wx.stopPullDownRefresh()
    )
  },

  retry() {
    wx.vibrateShort && wx.vibrateShort({ type: 'light' })
    this.load()
  },

  async refreshAdminThenLoad() {
    const openid = this.data.openid
    if (openid) {
      try {
        const r = await api.admin({ action: 'check_admin', openid })
        this.setData({ isAdmin: !!(r && r.isAdmin) })
      } catch (e) {
        // 非管理员或接口不支持 whoami，按只读处理
      }
    }
    await this.load()
  },

  async load() {
    this.setData({ loading: true, error: '' })
    try {
      let plans
      if (this.data.openid) {
        const r = await api.admin({ action: 'admin_plans', openid: this.data.openid })
        plans = (r.plans || []).map((p) => ({ ...p }))
      } else {
        const r = await api.getPlans()
        plans = (r.plans || []).map((p) => ({ ...p, visible: true }))
      }
      plans = plans.map((p) => {
        const dc = dayCount(p.planDate, p.planDateEnd)
        return {
          ...p,
          coverGrad: toneGradient(p.coverTone),
          planDateText: toDotted(p.planDate),
          planDateISO: toISO(p.planDate),
          planDateEndText: toDotted(p.planDateEnd),
          planDateEndISO: toISO(p.planDateEnd),
          dayCountText: dc ? dc + ' 天' : '',
          coverImageUrl: p.coverImageUrl || '',
          stops: (p.stops || []).map((s) => ({ ...s })),
        }
      })
      const activeIndex = Math.min(this.data.activeIndex, Math.max(plans.length - 1, 0))
      const totalStops = plans.reduce((n, p) => n + (p.stops ? p.stops.length : 0), 0)
      this.setData({ plans, activeIndex, totalStops, loading: false, ready: true })
      this.applyActive()
    } catch (e) {
      this.setData({ loading: false, ready: true, error: '这次没翻到计划，请稍后再试' })
    }
  },

  applyActive() {
    const plan = this.data.plans[this.data.activeIndex] || null
    if (!plan) {
      this.setData({
        active: null, areaH: 0,
        mapMarkers: [], mapPolyline: [], mapPolylineBase: [], mapInclude: [], geoStopCount: 0,
        multiDay: false, dayGroups: [], budgetBars: [],
      })
      return
    }
    const dayVals = plan.stops.map((s) => Number(s.day) || 1)
    const multiDay = dayVals.length > 0 && Math.max(...dayVals) > 1
    const stops = plan.stops.map((s) => {
      const day = Number(s.day) || 1
      const coord = validCoord(s.latitude, s.longitude)
      const hasGeo = !!coord
      return {
        ...s,
        latitude: coord ? coord.latitude : null,
        longitude: coord ? coord.longitude : null,
        day,
        dayTag: multiDay ? 'D' + day : '',
        hasGeo,
        geoText: hasGeo ? '已定位' : '未定位',
        completenessText: stopCompleteness(s),
      }
    })
    const completeness = planCompleteness(stops)
    const active = { ...plan, stops, completeness }

    const geo = stops.filter((s) => validCoord(s.latitude, s.longitude))

    // 按天分组（每天显示出发点：默认对应当晚酒店，可自定义）
    const dayStarts = plan.dayStarts || {}
    const dayMap = {}
    stops.forEach((s) => { (dayMap[s.day] = dayMap[s.day] || []).push(s) })
    const startISO = plan.planDateISO || toISO(plan.planDate)
    const wmap = {}
    const dayGroups = Object.keys(dayMap)
      .map(Number)
      .sort((a, b) => a - b)
      .map((d) => {
        const ds = dayStarts[d] || dayStarts[String(d)]
        const hotel = hotelForDay(plan, d)
        let startName = ''
        let startCustom = false
        let startCoord = null
        if (ds && (ds.name || ds.lat != null)) {
          startName = ds.name || '自定义出发点'
          startCustom = true
          const coord = validCoord(ds.lat, ds.lng)
          if (coord) startCoord = { lat: coord.latitude, lng: coord.longitude }
        } else if (hotel && (hotel.name || hotel.lat != null)) {
          startName = hotel.name || '酒店'
          const coord = validCoord(hotel.lat, hotel.lng)
          if (coord) startCoord = { lat: coord.latitude, lng: coord.longitude }
        }
        const dateISO = startISO ? addDaysISO(startISO, d - 1) : ''
        const w = dateISO ? wmap[dateISO] : null
        const firstPt = hmToMin((dayMap[d][0] || {}).plannedTime)
        const sched = buildDaySchedule(startCoord, dayMap[d], firstPt != null ? firstPt : 9 * 60)
        const stopsWithSched = dayMap[d].map((s, i) => ({ ...s, sched: sched.rows[i] }))
        return {
          day: d, label: '第 ' + d + ' 天', stops: stopsWithSched, startName, startCustom, hasStart: !!startName,
          startCoord,
          dateISO, dateText: dateLabel(dateISO),
          weather: weatherLine(w),
          commuteMin: sched.commuteMin,
          stayMin: sched.stayMin,
          spanMin: sched.spanMin,
          commuteText: sched.commuteMin > 0 ? minHuman(sched.commuteMin) : '',
          stayText: sched.stayMin > 0 ? minHuman(sched.stayMin) : '',
          spanText: sched.spanMin > 0 ? minHuman(sched.spanMin) : '',
          loadKey: sched.loadKey, loadText: sched.loadText,
          canOptimize: dayMap[d].filter((s) => validCoord(s.latitude, s.longitude)).length >= 3,
          routeOptHint: (() => {
            const geoStops = dayMap[d].filter((s) => validCoord(s.latitude, s.longitude))
            if (geoStops.length < 3) return ''
            const origDist = totalDist(geoStops)
            const optDist = totalDist(greedyTSP(geoStops))
            const savedM = Math.round((origDist - optDist) / 1000 / 22 * 60)
            return savedM >= 15 ? `调整顺序可省约 ${savedM} 分钟通勤时间` : ''
          })(),
        }
      })

    // 地图：按天着色的编号标记 + 路线（支持「全部 / 第N天」筛选）
    this.markDayFirst(stops, multiDay, plan, dayGroups)
    this.layoutStopSlots(stops, multiDay)

    const dayChips = multiDay
      ? [{ day: 0, label: '全部', color: '#1b1712' }].concat(
          dayGroups.filter((g) => g.stops.some((s) => validCoord(s.latitude, s.longitude))).map((g) => ({ day: g.day, label: '第' + g.day + '天', color: dayColor(g.day) })))
      : []
    if (this.data.mapDayFilter && !dayChips.some((c) => c.day === this.data.mapDayFilter)) this.data.mapDayFilter = 0
    const md = this.buildMapData(dayGroups, multiDay, this.data.mapDayFilter || 0)
    const totalSpan = dayGroups.reduce((sum, g) => sum + (Number(g.spanMin) || 0), 0)
    const totalCommute = dayGroups.reduce((sum, g) => sum + (Number(g.commuteMin) || 0), 0)
    const firstLoad = dayGroups[0] ? dayGroups[0].loadKey : ''
    active.softSummary = [
      stops.length ? `${stops.length} 个地点` : '',
      totalCommute ? `预计通勤 ${minHuman(totalCommute)}` : '',
      planMood(firstLoad),
    ].filter(Boolean).join(' · ')
    active.mapSummary = [
      multiDay ? `${dayGroups.length} 天` : '',
      geo.length ? `${geo.length} 个已定位地点` : '',
      totalSpan ? `约 ${minHuman(totalSpan)}` : '',
    ].filter(Boolean).join(' · ')

    this.setData({
      active, areaH: this.stopAreaHeight(stops),
      mapMarkers: md.markers, mapPolyline: md.polylines, mapPolylineBase: md.polylines,
      mapInclude: md.include, mapCenter: md.center || this.data.mapCenter, mapScale: md.scale || 11, geoStopCount: geo.length,
      mapDayChips: dayChips, mapDayFilter: this.data.mapDayFilter || 0,
      multiDay, dayGroups,
    })
    this.fitPlanMap(md.include)
    this.loadExpenses()
    this.loadWeather()
  },

  // 构建地图标记 + 路线：按天着色，filterDay=0 显示全部，否则只显示该天
  buildMapData(dayGroups, multiDay, filterDay) {
    const markers = []
    const polylines = []
    const include = []
    let center = null
    const groups = (filterDay && filterDay !== 0)
      ? dayGroups.filter((g) => g.day === filterDay)
      : dayGroups
    groups.forEach((g) => {
      const color = multiDay ? dayColor(g.day) : '#1b1712'
      const geo = (g.stops || [])
        .map((s) => ({ ...s, coord: validCoord(s.latitude, s.longitude) }))
        .filter((s) => s.coord)
      geo.forEach((s, i) => {
        markers.push({
          id: s.id,
          latitude: s.coord.latitude,
          longitude: s.coord.longitude,
          iconPath: '/assets/pin.png',
          width: 26, height: 32, anchor: { x: 0.5, y: 1 },
          label: {
            content: multiDay ? (g.day + '-' + (i + 1)) : s.no,
            color, fontSize: 10, anchorX: -8, anchorY: -34,
            bgColor: '#faf8f3', borderColor: color, borderWidth: 1, borderRadius: 8, padding: 3,
          },
          callout: {
            content: (multiDay ? ('第' + g.day + '天 · ') : '') + s.name,
            color: '#1f1d1b', fontSize: 12, borderRadius: 10, borderWidth: 1,
            borderColor: '#00000014', padding: 8, bgColor: '#ffffff', display: 'BYCLICK',
          },
        })
        include.push(s.coord)
      })
      // 连线：当天出发点（若有坐标）→ 各站
      const pts = []
      const start = g.startCoord ? validCoord(g.startCoord.lat, g.startCoord.lng) : null
      if (start) pts.push(start)
      geo.forEach((s) => pts.push(s.coord))
      if (pts.length > 1) polylines.push({ points: pts, color: color + 'B3', width: multiDay ? 3 : 2, dottedLine: !multiDay, arrowLine: true })
    })
    let scale = 11
    if (include.length) {
      const lats = include.map((p) => Number(p.latitude))
      const lngs = include.map((p) => Number(p.longitude))
      const minLat = Math.min(...lats)
      const maxLat = Math.max(...lats)
      const minLng = Math.min(...lngs)
      const maxLng = Math.max(...lngs)
      center = {
        latitude: (minLat + maxLat) / 2,
        longitude: (minLng + maxLng) / 2,
      }
      const span = Math.max(maxLat - minLat, maxLng - minLng)
      scale = span > 2 ? 7 : span > 1 ? 8 : span > 0.45 ? 9 : span > 0.18 ? 10 : span > 0.08 ? 11 : span > 0.03 ? 12 : 13
    }
    return { markers, polylines, include, center, scale }
  },

  fitPlanMap(points) {
    const list = (points || []).filter((p) => validCoord(p.latitude, p.longitude))
    if (!list.length) return
    setTimeout(() => {
      const ctx = wx.createMapContext && wx.createMapContext('planMap', this)
      if (!ctx || !ctx.includePoints) return
      ctx.includePoints({
        points: list,
        padding: [72, 48, 80, 48],
      })
    }, 180)
  },

  layoutStopSlots(stops, multiDay) {
    let y = 0
    const rowH = this.data.rowH || 88
    const dayHeadH = this.data.dayHeadH || 72
    ;(stops || []).forEach((s, i) => {
      s.no = String(i + 1).padStart(2, '0')
      const h = rowH + (multiDay && s.dayFirst ? dayHeadH : 0)
      s._y = y
      s._h = h
      y += h
    })
    return stops
  },

  stopAreaHeight(stops) {
    return (stops || []).reduce((sum, s) => sum + (Number(s._h) || this.data.rowH || 88), 0)
  },

  stopIndexByY(stops, y) {
    const rows = stops || []
    if (!rows.length) return 0
    const pos = Math.max(0, Number(y) || 0)
    for (let i = 0; i < rows.length; i++) {
      const top = Number(rows[i]._y) || 0
      const h = Number(rows[i]._h) || this.data.rowH || 88
      if (pos < top + h / 2) return i
    }
    return rows.length - 1
  },

  weatherRequest(plan) {
    if (!plan || !this.data.openid) return null
    const startISO = plan.planDateISO || toISO(plan.planDate)
    if (!startISO) return null
    let coord = null
    const h0 = hotelForDay(plan, 1)
    if (h0) coord = validCoord(h0.lat, h0.lng)
    if (!coord) {
      const first = (plan.stops || []).find((s) => validCoord(s.latitude, s.longitude))
      if (first) coord = validCoord(first.latitude, first.longitude)
    }
    if (!coord) return null
    const dates = (this.data.dayGroups || []).map((g) => g.dateISO || '').join(',')
    const key = [
      this.data.openid,
      plan.id || '',
      startISO,
      coord.latitude.toFixed(5),
      coord.longitude.toFixed(5),
      dates,
    ].join('|')
    return { key, latitude: coord.latitude, longitude: coord.longitude }
  },

  applyWeatherMap(wmap) {
    const dayGroups = (this.data.dayGroups || []).map((g) => {
      const w = g.dateISO ? wmap[g.dateISO] : null
      return { ...g, weather: weatherLine(w) }
    })
    const active = this.data.active
    if (!active) {
      this.setData({ weatherByDate: wmap, dayGroups })
      return
    }
    const stops = (active.stops || []).map((s) => ({ ...s }))
    this.markDayFirst(stops, this.data.multiDay, active, dayGroups)
    this.layoutStopSlots(stops, this.data.multiDay)
    this.setData({
      weatherByDate: wmap,
      dayGroups,
      active: { ...active, stops },
      areaH: this.stopAreaHeight(stops),
    })
  },

  // 切换地图「全部 / 第N天」
  setMapDay(e) {
    const day = Number(e.currentTarget.dataset.day) || 0
    if (day === this.data.mapDayFilter) return
    const md = this.buildMapData(this.data.dayGroups || [], this.data.multiDay, day)
    this.setData({
      mapDayFilter: day,
      mapMarkers: md.markers,
      mapPolyline: md.polylines,
      mapPolylineBase: md.polylines,
      mapInclude: md.include,
      mapCenter: md.center || this.data.mapCenter,
      mapScale: md.scale || 11,
    })
    this.fitPlanMap(md.include)
  },

  // 点地图标记 → 打开该站抽屉
  onMarkerTap(e) {
    const id = e.detail.markerId
    if (id != null) this.openStopSheet({ currentTarget: { dataset: { id } } })
  },

  // 导出行程长图：按天列出目的地/时间表/出发点，生成可保存/转发的长图
  exportItinerary() {
    const plan = this.data.active
    if (this.data.posterMaking || !plan) return
    const groups = this.data.dayGroups || []
    if (!groups.length) { wx.showToast({ title: '先添加目的地', icon: 'none' }); return }
    // 组织海报数据
    const total = (plan.stops || []).length
    const meta = [
      (plan.planDateText ? plan.planDateText + (plan.planDateEndText ? ' – ' + plan.planDateEndText : '') : ''),
      plan.dayCountText,
      total ? ('共 ' + total + ' 个目的地') : '',
    ].filter(Boolean).join('  ·  ')
    const days = groups.map((g) => ({
      label: g.label,
      dateText: g.dateText || '',
      weather: g.weather || '',
      startName: g.startName || '',
      summary: g.spanText ? ('约 ' + g.spanText + (g.commuteText ? ' · 通勤 ' + g.commuteText : '') + (g.stayText ? ' · 游玩 ' + g.stayText : '')) : '',
      stops: (g.stops || []).map((s, i) => ({
        idx: i + 1,
        name: s.name || '',
        timeText: s.sched ? ('🕘 ' + s.sched.arrive + '–' + s.sched.leave) : (s.plannedTime ? ('🕘 ' + s.plannedTime) : ''),
        stayText: (s.sched && s.sched.stayText) ? ('停 ' + s.sched.stayText) : '',
        note: s.note || '',
      })),
    }))
    const data = { title: plan.title || '行程单', meta, coverUrl: plan.cover || '', days }

    this.setData({ posterMaking: true })
    wx.vibrateShort && wx.vibrateShort({ type: 'light' })
    wx.showLoading({ title: '生成中…', mask: true })
    wx.createSelectorQuery().in(this)
      .select('#itinPoster')
      .fields({ node: true, size: true })
      .exec(async (res) => {
        const node = res && res[0] && res[0].node
        if (!node) {
          wx.hideLoading(); this.setData({ posterMaking: false })
          wx.showToast({ title: '长图暂时没生成', icon: 'none' }); return
        }
        try {
          const tempFilePath = await buildItineraryPoster(node, data)
          wx.hideLoading(); this.setData({ posterMaking: false })
          wx.previewImage({ urls: [tempFilePath], current: tempFilePath })
        } catch (e) {
          wx.hideLoading(); this.setData({ posterMaking: false })
          wx.showToast({ title: '长图暂时没生成，请重试', icon: 'none' })
        }
      })
  },

  // 拉取目的地城市的高德天气（4 天预报），按计划日期映射到每天
  async loadWeather() {
    const plan = this.data.active
    const req = this.weatherRequest(plan)
    if (!req) return
    if (this._weatherKey === req.key && this._weatherMap) {
      this.applyWeatherMap(this._weatherMap)
      return
    }
    if (this._weatherPendingKey === req.key) return
    this._weatherPendingKey = req.key
    try {
      const r = await api.admin({ action: 'weather', openid: this.data.openid, latitude: req.latitude, longitude: req.longitude })
      const wmap = {}
      ;(r.casts || []).forEach((c) => { if (c.date) wmap[c.date] = c })
      this._weatherKey = req.key
      this._weatherMap = wmap
      const current = this.weatherRequest(this.data.active)
      if (current && current.key === req.key) this.applyWeatherMap(wmap)
    } catch (e) {
      // 天气失败不影响主流程
    } finally {
      if (this._weatherPendingKey === req.key) this._weatherPendingKey = ''
    }
  },

  openStopLocation(e) {
    const id = e.currentTarget.dataset.id
    const s = (this.data.active && this.data.active.stops || []).find((x) => x.id === id)
    if (!s || s.latitude == null || s.longitude == null) return
    wx.openLocation({ latitude: Number(s.latitude), longitude: Number(s.longitude), name: s.name, address: s.address || '', scale: 16 })
  },

  /* ---------------- 饼图 ---------------- */
  drawPie() {
    const bars = this.data.budgetBars
    const total = this.data.expenseTotal
    if (!bars || !bars.length || !total) return
    const COLORS = ['#1b1712','#b4423a','#2f6f4f','#3a5ba0','#9a6b2f','#7a4fa0']
    wx.createSelectorQuery().in(this).select('#expPie').fields({ node: true, size: true }).exec(res => {
      const canvas = res && res[0] && res[0].node
      if (!canvas) return
      const size = res[0].size
      const dpr = wx.getWindowInfo ? wx.getWindowInfo().pixelRatio : 2
      canvas.width = size.width * dpr
      canvas.height = size.height * dpr
      const ctx = canvas.getContext('2d')
      ctx.scale(dpr, dpr)
      const cx = size.width / 2
      const cy = size.height / 2
      const r = Math.min(cx, cy) - 16
      let startAngle = -Math.PI / 2
      bars.forEach((b, i) => {
        const slice = (b.amount / total) * 2 * Math.PI
        ctx.beginPath()
        ctx.moveTo(cx, cy)
        ctx.arc(cx, cy, r, startAngle, startAngle + slice)
        ctx.closePath()
        ctx.fillStyle = COLORS[i % COLORS.length]
        ctx.fill()
        startAngle += slice
      })
      ctx.beginPath()
      ctx.arc(cx, cy, r * 0.55, 0, 2 * Math.PI)
      ctx.fillStyle = '#f4f1ea'
      ctx.fill()
      ctx.fillStyle = '#1b1712'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.font = `bold ${Math.round(r * 0.28)}px Georgia`
      ctx.fillText('¥' + Math.round(total), cx, cy)
    })
  },

  /* ---------------- 记账 ---------------- */
  async loadExpenses(force = false) {
    const p = this.data.active
    if (!p || !this.data.openid) {
      this.setData({ expenses: [], expenseTotal: 0, budgetBars: [] })
      return
    }
    const key = `${this.data.openid}|${p.id || ''}`
    if (!force && this._expenseKey === key && this._expenseCache) {
      this.setData(this._expenseCache)
      setTimeout(() => this.drawPie(), 100)
      return
    }
    if (this._expensePendingKey === key) return
    this._expensePendingKey = key
    try {
      const r = await api.admin({ action: 'expenses', openid: this.data.openid, planId: p.id })
      const expenses = (r.expenses || []).map((e) => ({ ...e, catName: EXP_CAT_LABEL[e.category] || '其他' }))
      const catSum = {}
      expenses.forEach((e) => { catSum[e.category] = (catSum[e.category] || 0) + Number(e.amount || 0) })
      const COLORS = ['#1b1712','#b4423a','#2f6f4f','#3a5ba0','#9a6b2f','#7a4fa0']
      const max = Math.max(1, ...EXP_CATS.map((c) => catSum[c.key] || 0))
      const budgetBars = EXP_CATS
        .map((c, i) => ({ key: c.key, catName: c.name, name: c.name, value: Math.round((catSum[c.key] || 0) * 100) / 100, amount: catSum[c.key] || 0, pct: Math.round(((catSum[c.key] || 0) / max) * 100), color: COLORS[i % COLORS.length] }))
        .filter((b) => b.value > 0)
      const patch = { expenses, expenseTotal: r.total || 0, budgetBars }
      this._expenseKey = key
      this._expenseCache = patch
      if (this.data.active && `${this.data.openid}|${this.data.active.id || ''}` === key) this.setData(patch)
      setTimeout(() => this.drawPie(), 100)
    } catch (e) {
      this.setData({ expenses: [], expenseTotal: 0, budgetBars: [] })
    } finally {
      if (this._expensePendingKey === key) this._expensePendingKey = ''
    }
  },

  // 隐藏/恢复自定义 tabBar：打开底部编辑面板时隐藏，避免它盖住面板底部的「取消/保存」
  setTabBarHidden(hidden) {
    const tb = typeof this.getTabBar === 'function' ? this.getTabBar() : null
    if (tb) tb.setData({ hidden })
  },
  openExpenseAdd() {
    this.setData({ expenseEditor: { show: true, catIndex: 0, amount: '', memo: '' } })
    this.setTabBarHidden(true)
  },
  closeExpenseEditor() {
    this.setData({ 'expenseEditor.show': false })
    this.setTabBarHidden(false)
  },
  pickExpCat(e) {
    this.setData({ 'expenseEditor.catIndex': e.currentTarget.dataset.index })
  },
  onExpAmount(e) {
    this.setData({ 'expenseEditor.amount': e.detail.value })
  },
  onExpMemo(e) {
    this.setData({ 'expenseEditor.memo': e.detail.value })
  },
  async saveExpense() {
    const ed = this.data.expenseEditor
    const amount = parseFloat(ed.amount)
    if (!(amount > 0)) {
      wx.showToast({ title: '请输入金额', icon: 'none' })
      return
    }
    const p = this.data.active
    wx.showLoading({ title: '记账中', mask: true })
    try {
      await api.admin({
        action: 'add_expense',
        openid: this.data.openid,
        planId: p.id,
        city: p.title,
        category: this.data.expCats[ed.catIndex].key,
        amount,
        memo: (ed.memo || '').trim(),
      })
      wx.hideLoading()
      this.setData({ 'expenseEditor.show': false })
      this.setTabBarHidden(false)
      this.loadExpenses(true)
    } catch (e) {
      wx.hideLoading()
      wx.showToast({ title: '记账失败', icon: 'none' })
    }
  },
  delExpense(e) {
    const id = e.currentTarget.dataset.id
    wx.showModal({
      title: '删除这笔花费',
      content: '确定删除吗？',
      success: async (r) => {
        if (!r.confirm) return
        try {
          await api.admin({ action: 'del_expense', openid: this.data.openid, id })
          this.loadExpenses(true)
        } catch (err) {
          wx.showToast({ title: '删除失败', icon: 'none' })
        }
      },
    })
  },

  async budgetAnalysis() {
    const plan = this.data.active
    const total = this.data.expenseTotal
    if (!total || total <= 0) { wx.showToast({ title: '还没有花费记录', icon: 'none' }); return }
    const openid = this.data.openid
    if (!openid) { wx.showToast({ title: '请先登录', icon: 'none' }); return }
    this.setTabBarHidden(true)
    this.setData({
      aiDrawerShow: true,
      aiDrawerTitle: '花费分析',
      aiDrawerPlace: '',
      aiDrawerLoading: true,
      aiDrawerContent: '',
      aiDrawerHtml: '',
      aiDrawerError: '',
      aiDrawerBasis: '',
      aiDrawerCached: false,
      aiDrawerReturnStopSheet: false,
    })
    try {
      const r = await api.admin({
        action: 'ai_budget_analysis',
        openid,
        planId: plan ? plan.id : '',
        city: plan ? (plan.title || '') : '',
        total: this.data.expenseTotal,
        byCategory: this.data.budgetBars.reduce((acc, b) => { acc[b.key] = b.amount; return acc }, {}),
      })
      const content = r.analysis || ''
      this.setData({
        aiDrawerContent: content,
        aiDrawerHtml: markdownToHtml(content),
        aiDrawerLoading: false,
      })
    } catch {
      this.setData({ aiDrawerLoading: false, aiDrawerError: '暂时无法分析，请重试' })
    }
  },

  selectPlan(e) {
    const i = e.currentTarget.dataset.index
    if (i === this.data.activeIndex) return
    wx.vibrateShort && wx.vibrateShort({ type: 'light' })
    this.setData({ activeIndex: i })
    this.applyActive()
  },

  /* ---------------- 计划 CRUD ---------------- */
  openPlanAdd() {
    this.setData({
      planEditor: {
        show: true, mode: 'add', id: '', title: '', toneIndex: 0, coverTone: this.data.toneList[0],
        planDate: '', planDateEnd: '', dayCountText: '', coverImageUrl: '', uploadingCover: false, note: '',
        hotelName: '', hotelAddress: '', hotelLat: '', hotelLng: '', hotelGeoLoading: false,
      },
    })
    this.setTabBarHidden(true)
  },
  openPlanEdit() {
    const p = this.data.active
    if (!p) return
    const toneIndex = Math.max(0, this.data.toneList.indexOf(p.coverTone))
    const dc = dayCount(p.planDateISO, p.planDateEndISO)
    const h = p.hotel || {}
    this.setData({
      planEditor: {
        show: true, mode: 'edit', id: p.id, title: p.title, toneIndex, coverTone: p.coverTone,
        planDate: p.planDateISO || '', planDateEnd: p.planDateEndISO || '', dayCountText: dc ? '共 ' + dc + ' 天' : '',
        coverImageUrl: p.coverImageUrl || '', uploadingCover: false, note: p.note || '',
        hotelName: h.name || '', hotelAddress: h.address || '',
        hotelLat: h.lat == null ? '' : String(h.lat), hotelLng: h.lng == null ? '' : String(h.lng),
        hotelGeoLoading: false,
      },
    })
    this.setTabBarHidden(true)
  },
  onHotelField(e) {
    const k = e.currentTarget.dataset.field
    this.setData({ [`planEditor.${k}`]: e.detail.value })
  },
  // 酒店地址 → 坐标（复用 geo 接口）
  async geocodeHotel() {
    const ed = this.data.planEditor
    const addr = (ed.hotelAddress || ed.hotelName || '').trim()
    if (!addr) {
      wx.showToast({ title: '先填酒店名称或地址', icon: 'none' })
      return
    }
    this.setData({ 'planEditor.hotelGeoLoading': true })
    try {
      const r = await api.admin({ action: 'geo', openid: this.data.openid, address: addr })
      const coord = r ? validCoord(r.latitude, r.longitude) : null
      if (coord) {
        this.setData({
          'planEditor.hotelLng': String(coord.longitude),
          'planEditor.hotelLat': String(coord.latitude),
          'planEditor.hotelAddress': r.formatted || ed.hotelAddress,
          'planEditor.hotelGeoLoading': false,
        })
        wx.showToast({ title: '已定位', icon: 'success' })
      } else {
        this.setData({ 'planEditor.hotelGeoLoading': false })
        wx.showToast({ title: '未找到该地点', icon: 'none' })
      }
    } catch (err) {
      this.setData({ 'planEditor.hotelGeoLoading': false })
      wx.showToast({ title: (err && err.data && err.data.message) || '定位失败', icon: 'none' })
    }
  },
  closePlanEditor() {
    this.setData({ 'planEditor.show': false })
    this.setTabBarHidden(false)
  },
  // 输入框聚焦高亮（focusField 与 wxml 里 data-k 对应）
  onFieldFocus(e) {
    this.setData({ focusField: e.currentTarget.dataset.k || '' })
  },
  onFieldBlur() {
    this.setData({ focusField: '' })
  },
  // 快速模板：一键预填标题/备注
  applyPlanTemplate(e) {
    const t = this.data.planTemplates[e.currentTarget.dataset.index]
    if (!t) return
    this.setData({ 'planEditor.title': t.title, 'planEditor.note': t.note })
  },
  onPlanTitle(e) {
    this.setData({ 'planEditor.title': e.detail.value })
  },
  onPlanNote(e) {
    this.setData({ 'planEditor.note': e.detail.value })
  },
  onPlanDate(e) {
    this.setData({ 'planEditor.planDate': e.detail.value }, () => this.refreshDayCount())
  },
  onPlanDateEnd(e) {
    this.setData({ 'planEditor.planDateEnd': e.detail.value }, () => this.refreshDayCount())
  },
  // 起止日期都填时，编辑器内实时显示天数（结束早于开始则提示）
  refreshDayCount() {
    const ed = this.data.planEditor
    let txt = ''
    if (ed.planDate && ed.planDateEnd) {
      const dc = dayCount(ed.planDate, ed.planDateEnd)
      txt = dc ? '共 ' + dc + ' 天' : '结束日期不能早于开始日期'
    }
    this.setData({ 'planEditor.dayCountText': txt })
  },
  // 选择并上传封面图（复用 upload_image 接口）
  chooseCoverImage() {
    if (!this.data.openid) {
      wx.showToast({ title: '请先登录', icon: 'none' })
      return
    }
    wx.chooseMedia({
      count: 1, mediaType: ['image'], sizeType: ['compressed'], sourceType: ['album', 'camera'],
      success: (res) => {
        const filePath = res.tempFiles && res.tempFiles[0] && res.tempFiles[0].tempFilePath
        if (!filePath) return
        this.setData({ 'planEditor.uploadingCover': true })
        wx.showLoading({ title: '上传中', mask: true })
        api
          .uploadImage(filePath, this.data.openid)
          .then((d) => {
            wx.hideLoading()
            this.setData({ 'planEditor.coverImageUrl': d.imageUrl, 'planEditor.uploadingCover': false })
          })
          .catch((err) => {
            wx.hideLoading()
            this.setData({ 'planEditor.uploadingCover': false })
            wx.showToast({ title: (err && err.message) || '上传失败', icon: 'none' })
          })
      },
    })
  },
  removeCoverImage() {
    this.setData({ 'planEditor.coverImageUrl': '' })
  },
  pickPlanTone(e) {
    const i = e.currentTarget.dataset.index
    this.setData({ 'planEditor.toneIndex': i, 'planEditor.coverTone': this.data.toneList[i] })
  },
  async savePlan() {
    const ed = this.data.planEditor
    if (!ed.title.trim()) {
      wx.showToast({ title: '请填写计划标题', icon: 'none' })
      return
    }
    const payload = {
      action: ed.mode === 'add' ? 'add_plan' : 'update_plan',
      openid: this.data.openid,
      title: ed.title.trim(),
      coverTone: ed.coverTone,
      planDate: ed.planDate || '',
      planDateEnd: ed.planDateEnd || '',
      coverImageUrl: ed.coverImageUrl || '',
      note: ed.note || '',
      hotelName: (ed.hotelName || '').trim(),
      hotelAddress: (ed.hotelAddress || '').trim(),
      hotelLat: ed.hotelLat || '',
      hotelLng: ed.hotelLng || '',
    }
    if (ed.mode === 'edit') payload.id = ed.id
    try {
      const r = await api.admin(payload)
      this.setData({ 'planEditor.show': false })
      this.setTabBarHidden(false)
      wx.showToast({ title: '已保存', icon: 'success' })
      if (ed.mode === 'add' && r && r.id) {
        // 新建后选中它
        await this.load()
        const idx = this.data.plans.findIndex((p) => p.id === r.id)
        if (idx >= 0) {
          this.setData({ activeIndex: idx })
          this.applyActive()
        }
      } else {
        await this.load()
      }
    } catch (e) {
      wx.showToast({ title: (e && e.data && e.data.message) || '保存失败', icon: 'none' })
    }
  },
  delPlan() {
    const p = this.data.active
    if (!p) return
    wx.showModal({
      title: '删除计划', content: `确定删除「${p.title}」及其所有目的地吗？`, confirmColor: '#1b1712',
      success: async (res) => {
        if (!res.confirm) return
        try {
          await api.admin({ action: 'del_plan', openid: this.data.openid, id: p.id })
          this.setData({ activeIndex: 0 })
          await this.load()
          wx.showToast({ title: '已删除', icon: 'success' })
        } catch (e) {
          wx.showToast({ title: '删除失败', icon: 'none' })
        }
      },
    })
  },
  async togglePlan() {
    const p = this.data.active
    if (!p) return
    try {
      await api.admin({ action: 'toggle_plan', openid: this.data.openid, id: p.id })
      await this.load()
    } catch (e) {
      wx.showToast({ title: '操作失败', icon: 'none' })
    }
  },

  /* ---------------- 目的地 CRUD ---------------- */
  openStopAdd() {
    const p = this.data.active
    if (!p) return
    this.setData({
      stopEditor: { show: true, mode: 'add', id: 0, planId: p.id, name: '', address: '', plannedTime: '', stayMinutes: 0, note: '', openHours: '', ticket: '', bookingUrl: '', day: 1, latitude: '', longitude: '', geoLoading: false },
    })
    this.setTabBarHidden(true)
  },
  openStopEdit(e) {
    const id = e.currentTarget.dataset.id
    const s = this.data.active.stops.find((x) => x.id === id)
    if (!s) return
    this.setData({
      stopEditor: {
        show: true, mode: 'edit', id: s.id, planId: this.data.active.id,
        name: s.name || '', address: s.address || '', plannedTime: s.plannedTime || '', stayMinutes: Number(s.stayMinutes) || 0, note: s.note || '',
        openHours: s.openHours || '', ticket: s.ticket || '', bookingUrl: s.bookingUrl || '', day: Number(s.day) || 1,
        latitude: s.latitude == null ? '' : String(s.latitude), longitude: s.longitude == null ? '' : String(s.longitude),
        geoLoading: false,
      },
    })
    this.setTabBarHidden(true)
  },
  closeStopEditor() {
    this.setData({ 'stopEditor.show': false })
    this.setTabBarHidden(false)
  },
  onStopField(e) {
    const k = e.currentTarget.dataset.field
    this.setData({ [`stopEditor.${k}`]: e.detail.value })
  },
  stopDayDelta(e) {
    const d = Number(e.currentTarget.dataset.d) || 0
    const cur = Number(this.data.stopEditor.day) || 1
    this.setData({ 'stopEditor.day': Math.max(1, Math.min(60, cur + d)) })
  },
  // 选择建议游玩时长（点同一个再次点击=取消）
  pickStay(e) {
    const v = Number(e.currentTarget.dataset.v) || 0
    const cur = Number(this.data.stopEditor.stayMinutes) || 0
    this.setData({ 'stopEditor.stayMinutes': cur === v ? 0 : v })
  },
  onStayInput(e) {
    const v = Math.max(0, Math.min(1440, Number(e.detail.value) || 0))
    this.setData({ 'stopEditor.stayMinutes': v })
  },
  async geocodeStop() {
    const ed = this.data.stopEditor
    const addr = (ed.address || ed.name || '').trim()
    if (!addr) {
      wx.showToast({ title: '先填地址或名称', icon: 'none' })
      return
    }
    this.setData({ 'stopEditor.geoLoading': true })
    try {
      const r = await api.admin({ action: 'geo', openid: this.data.openid, address: addr })
      const coord = r ? validCoord(r.latitude, r.longitude) : null
      if (coord) {
        const updates = {
          'stopEditor.longitude': String(coord.longitude),
          'stopEditor.latitude': String(coord.latitude),
          'stopEditor.address': r.formatted || ed.address,
          'stopEditor.geoLoading': false,
        }
        if (!ed.openHours && r.openHours) updates['stopEditor.openHours'] = String(r.openHours)
        if (!ed.ticket && r.ticket) updates['stopEditor.ticket'] = String(r.ticket)
        this.setData(updates)
        wx.showToast({ title: (r.openHours || r.ticket) ? '已补全信息' : '已补全地址', icon: 'success' })
      } else {
        this.setData({ 'stopEditor.geoLoading': false })
        wx.showToast({ title: '未找到该地点', icon: 'none' })
      }
    } catch (e) {
      this.setData({ 'stopEditor.geoLoading': false })
      wx.showToast({ title: (e && e.data && e.data.message) || '定位失败', icon: 'none' })
    }
  },
  async completePlanStops() {
    if (this.data.completingStops) return
    const active = this.data.active
    const openid = this.data.openid
    if (!active || !openid) return
    const targets = (active.stops || []).filter(needsStopCompletion)
    if (!targets.length) {
      wx.showToast({ title: '资料已完整', icon: 'success' })
      return
    }
    wx.vibrateShort && wx.vibrateShort({ type: 'light' })
    this.setData({ completingStops: true, completionStatus: `0/${targets.length}` })
    wx.showLoading({ title: '补全中…', mask: true })
    let changed = 0
    for (let i = 0; i < targets.length; i++) {
      const s = targets[i]
      this.setData({ completionStatus: `${i + 1}/${targets.length}` })
      const query = (s.address || s.name || '').trim()
      if (!query) continue
      try {
        const r = await api.admin({ action: 'geo', openid, address: query })
        if (!r || !r.longitude || !r.latitude) continue
        const next = {
          address: s.address || r.formatted || '',
          latitude: s.latitude == null ? String(r.latitude) : s.latitude,
          longitude: s.longitude == null ? String(r.longitude) : s.longitude,
          openHours: s.openHours || r.openHours || '',
          ticket: s.ticket || r.ticket || '',
        }
        const hasChange =
          next.address !== (s.address || '') ||
          String(next.latitude) !== String(s.latitude == null ? '' : s.latitude) ||
          String(next.longitude) !== String(s.longitude == null ? '' : s.longitude) ||
          next.openHours !== (s.openHours || '') ||
          next.ticket !== (s.ticket || '')
        if (!hasChange) continue
        await api.admin({
          action: 'update_stop',
          openid,
          id: s.id,
          planId: active.id,
          name: s.name || '',
          address: next.address,
          plannedTime: s.plannedTime || '',
          stayMinutes: Number(s.stayMinutes) || 0,
          note: s.note || '',
          openHours: next.openHours,
          ticket: next.ticket,
          bookingUrl: s.bookingUrl || '',
          day: Number(s.day) || 1,
          latitude: next.latitude,
          longitude: next.longitude,
        })
        changed += 1
      } catch (e) {
        console.warn('[completePlanStops] skip', s.name, e)
      }
    }
    wx.hideLoading()
    this.setData({ completingStops: false, completionStatus: '' })
    await this.load()
    wx.showToast({ title: changed ? `已补全 ${changed} 个` : '暂无可补信息', icon: 'none' })
  },
  async saveStop() {
    const ed = this.data.stopEditor
    if (!ed.name.trim()) {
      wx.showToast({ title: '请填写地点名称', icon: 'none' })
      return
    }
    const payload = {
      action: ed.mode === 'add' ? 'add_stop' : 'update_stop',
      openid: this.data.openid,
      planId: ed.planId,
      name: ed.name.trim(),
      address: ed.address || '',
      plannedTime: ed.plannedTime || '',
      stayMinutes: Number(ed.stayMinutes) || 0,
      note: ed.note || '',
      openHours: ed.openHours || '',
      ticket: ed.ticket || '',
      bookingUrl: ed.bookingUrl || '',
      day: Number(ed.day) || 1,
      latitude: ed.latitude || '',
      longitude: ed.longitude || '',
    }
    if (ed.mode === 'edit') payload.id = ed.id
    try {
      await api.admin(payload)
      this.setData({ 'stopEditor.show': false })
      this.setTabBarHidden(false)
      await this.load()
      wx.showToast({ title: '已保存', icon: 'success' })
    } catch (e) {
      wx.showToast({ title: (e && e.data && e.data.message) || '保存失败', icon: 'none' })
    }
  },
  delStop(e) {
    const id = e.currentTarget.dataset.id
    wx.showModal({
      title: '删除目的地', content: '确定删除该目的地吗？', confirmColor: '#1b1712',
      success: async (res) => {
        if (!res.confirm) return
        try {
          await api.admin({ action: 'del_stop', openid: this.data.openid, id })
          await this.load()
          wx.showToast({ title: '已删除', icon: 'success' })
        } catch (err) {
          wx.showToast({ title: '删除失败', icon: 'none' })
        }
      },
    })
  },

  // 标记每天的第一个目的地（按当前顺序，相邻 day 不同处即新一天的开头），
  // 用于在该卡片上方渲染「第 N 天」小标题分隔。
  markDayFirst(stops, multiDay, plan, dayGroupsOverride) {
    plan = plan || this.data.active || {}
    const dayStarts = plan.dayStarts || {}
    const dayGroups = dayGroupsOverride || this.data.dayGroups || []
    let prev = null
    stops.forEach((s, i) => {
      const isFirstOfDay = i === 0 || s.day !== prev
      s.dayFirst = !!multiDay && isFirstOfDay
      s.dayLabel = '第 ' + s.day + ' 天'
      // 给每个站添加所属天的元信息（用于合并显示）
      const dayInfo = dayGroups.find((g) => g.day === s.day)
      if (dayInfo) {
        s.dayInfo = {
          dateText: dayInfo.dateText || '',
          weather: dayInfo.weather || '',
          stopCount: (dayInfo.stops || []).length,
          spanText: dayInfo.spanText || '',
          commuteText: dayInfo.commuteText || '',
          stayText: dayInfo.stayText || '',
          loadKey: dayInfo.loadKey || '',
          loadText: dayInfo.loadText || '',
          canOptimize: dayInfo.canOptimize || false,
          routeOptHint: dayInfo.routeOptHint || '',
        }
        // 从 dayGroups 里找到对应的 stop，把 sched 复制过来
        const stopWithSched = (dayInfo.stops || []).find((st) => st.id === s.id)
        if (stopWithSched && stopWithSched.sched) {
          s.sched = stopWithSched.sched
        }
      } else {
        s.dayInfo = {}
      }
      // 每天首站标注出发点（默认对应当晚酒店，可自定义）
      if (isFirstOfDay) {
        const ds = dayStarts[s.day] || dayStarts[String(s.day)]
        const hotel = hotelForDay(plan, s.day)
        if (ds && (ds.name || ds.lat != null)) {
          s.startName = ds.name || '自定义出发点'
          s.startCustom = true
        } else if (hotel && (hotel.name || hotel.lat != null)) {
          s.startName = hotel.name || '酒店'
          s.startCustom = false
        } else {
          s.startName = ''
          s.startCustom = false
        }
        s.startDay = s.day
      } else {
        s.startName = ''
      }
      prev = s.day
    })
    return stops
  },

  // 打开 AI 助手抽屉
  openAiDrawer(e) {
    const name = (e.currentTarget.dataset.name || '').trim()
    if (!name) return
    const address = (e.currentTarget.dataset.address || '').trim()
    const openHours = (e.currentTarget.dataset.openHours || '').trim()
    const ticket = (e.currentTarget.dataset.ticket || '').trim()
    const bookingUrl = (e.currentTarget.dataset.bookingUrl || '').trim()
    const note = (e.currentTarget.dataset.note || '').trim()
    const context = { address, openHours, ticket, bookingUrl, note }
    const basis = ['地址', '开放时间', '门票'].filter((k) => {
      if (k === '地址') return !!address
      if (k === '开放时间') return !!openHours
      return !!ticket
    }).join(' / ') || '地点名称'
    const returnStopSheet = !!(this.data.stopSheet && this.data.stopSheet.show)
    this.setTabBarHidden(true)
    this.setData({
      'stopSheet.show': false,
      aiDrawerShow: true,
      aiDrawerTitle: '',
      aiDrawerPlace: name,
      aiDrawerLoading: true,
      aiDrawerContent: '',
      aiDrawerHtml: '',
      aiDrawerError: '',
      aiDrawerContext: context,
      aiDrawerBasis: basis,
      aiDrawerCached: false,
      aiDrawerReturnStopSheet: returnStopSheet,
    })
    this.loadAiContent(name, context)
  },

  // 加载地点攻略。统一走 admin_api 的 DeepSeek 配置。
  async loadAiContent(place, context = {}, force = false) {
    const user = app.getUser && app.getUser()
    const openid = this.data.openid || (user && user.openid) || ''
    if (!openid) {
      this.setData({ aiDrawerError: '请先登录后再使用 AI 攻略', aiDrawerLoading: false })
      return
    }
    const active = this.data.active || {}
    const name = String(place || '').trim()
    const genericNames = ['景区', '公园', '博物馆', '酒店', '餐厅', '目的地', '地点', '古镇', '商场']
    const genericName = name.length < 2 || genericNames.includes(name)
    if (genericName && !context.address) {
      this.setData({
        aiDrawerLoading: false,
        aiDrawerError: '地点名称太泛，请先补充具体地址后再生成攻略。',
      })
      return
    }
    const cacheKey = aiGuideCacheKey(name, context)
    if (!force) {
      try {
        const cached = wx.getStorageSync(cacheKey)
        if (cached && cached.answer) {
          this.setData({
            aiDrawerContent: cached.answer,
            aiDrawerHtml: markdownToHtml(cached.answer),
            aiDrawerLoading: false,
            aiDrawerError: '',
            aiDrawerCached: true,
          })
          return
        }
      } catch (e) {}
    }
    const detail = [
      `地点名称：${name}`,
      `地址：${context.address || '待确认'}`,
      `开放时间：${context.openHours || '待确认'}`,
      `门票：${context.ticket || '待确认'}`,
      context.bookingUrl ? `预约/购票链接：${context.bookingUrl}` : '',
      context.note ? `行程备注：${context.note}` : '',
      active.title ? `所属行程：${active.title}` : '',
    ].filter(Boolean).join('\n')
    const query = `${detail}

请基于这个具体地点生成旅游攻略，不要写成通用景区模板。
必须直接围绕地点名称回答；如果你不确定真实信息，就明确写“该地点资料不足”，不要编造。
地址、开放时间、门票为“待确认”的字段，必须在对应内容里标注“待确认”，不要自行补全。
输出格式：
【怎么玩】2-3句
【游览路线】2-3句
【附近吃什么】2-3句
【交通提醒】1-2句
【避坑提醒】1-2句
最后单独加一句：开放时间和门票以官方为准。
总字数控制在350字以内。`

    try {
      const res = await api.admin({ action: 'ai_recommend', openid, mode: 'scene', city: place, query })
      if (res && res.answer) {
        const answer = String(res.answer).trim()
        const suffix = '开放时间和门票以官方为准。'
        const content = answer.includes(suffix) ? answer : (answer + '\n\n' + suffix)
        try {
          wx.setStorageSync(cacheKey, { answer: content, savedAt: Date.now() })
        } catch (e) {}
        this.setData({ aiDrawerContent: content, aiDrawerHtml: markdownToHtml(content), aiDrawerLoading: false, aiDrawerCached: false })
      } else {
        this.setData({ aiDrawerError: '暂无内容', aiDrawerLoading: false })
      }
    } catch (err) {
      console.error('[AI] 加载失败', err)
      const msg = (err && err.data && err.data.message) || err.message || 'AI 暂时不可用'
      this.setData({ aiDrawerError: msg, aiDrawerLoading: false })
    }
  },

  // 重试加载
  retryAiDrawer() {
    this.setData({ aiDrawerLoading: true, aiDrawerError: '', aiDrawerCached: false })
    this.loadAiContent(this.data.aiDrawerPlace, this.data.aiDrawerContext || {}, true)
  },

  regenerateAiDrawer() {
    if (this.data.aiDrawerLoading) return
    this.setData({ aiDrawerLoading: true, aiDrawerError: '', aiDrawerContent: '', aiDrawerHtml: '', aiDrawerCached: false })
    this.loadAiContent(this.data.aiDrawerPlace, this.data.aiDrawerContext || {}, true)
  },

  // 关闭抽屉
  closeAiDrawer() {
    const returnStopSheet = !!this.data.aiDrawerReturnStopSheet
    this.setData({
      aiDrawerShow: false,
      aiDrawerTitle: '',
      aiDrawerReturnStopSheet: false,
      ...(returnStopSheet ? { 'stopSheet.show': true } : {}),
    })
    this.setTabBarHidden(returnStopSheet)
  },

  // 阻止冒泡
  stopProp() {},

  /* ---------------- 拖动排序（movable-view 竖向） ---------------- */
  onStopTouchStart(e) {
    if (!this.data.isAdmin) return
    const id = e.currentTarget.dataset.id
    this.dragFrom = this.data.active.stops.findIndex((s) => s.id === id)
    this.setData({ dragId: id })
  },
  onStopChange(e) {
    if (!this.data.dragId || e.detail.source !== 'touch') return
    const id = e.currentTarget.dataset.id
    if (id !== this.data.dragId) return
    const n = this.data.active.stops.length
    const from = this.dragFrom
    let to = this.stopIndexByY(this.data.active.stops, e.detail.y)
    to = Math.max(0, Math.min(n - 1, to))
    if (to === from) return
    const stops = this.data.active.stops.slice()
    const [moved] = stops.splice(from, 1)
    stops.splice(to, 0, moved)
    // 重排非拖动项的槽位（拖动项跟随手指，不强制其 _y）
    this.markDayFirst(stops, this.data.multiDay)
    this.layoutStopSlots(stops, this.data.multiDay)
    this.dragFrom = to
    this.setData({ 'active.stops': stops, areaH: this.stopAreaHeight(stops) })
  },
  onStopTouchEnd() {
    if (!this.data.dragId) return
    const draggedId = this.data.dragId
    const stops = this.data.active.stops.slice()
    this.layoutStopSlots(stops, this.data.multiDay)
    // 跨天拖动：拖动项归属 = 落点上一项的天（落在最前则取下一项的天）
    let dayChanged = false
    if (this.data.multiDay) {
      const di = stops.findIndex((s) => s.id === draggedId)
      if (di >= 0) {
        const neighborDay = di > 0 ? Number(stops[di - 1].day) : (stops[di + 1] ? Number(stops[di + 1].day) : Number(stops[di].day))
        if (neighborDay && neighborDay !== Number(stops[di].day)) {
          stops[di].day = neighborDay
          stops[di].dayTag = 'D' + neighborDay
          dayChanged = true
        }
      }
    }
    this.markDayFirst(stops, this.data.multiDay)
    this.layoutStopSlots(stops, this.data.multiDay)
    this.setData({ 'active.stops': stops, areaH: this.stopAreaHeight(stops), dragId: 0 })
    // 同步本地 plans 缓存并持久化排序
    const plans = this.data.plans.slice()
    plans[this.data.activeIndex] = { ...plans[this.data.activeIndex], stops: stops.map((s) => ({ ...s })) }
    this.setData({ plans })
    const persist = async () => {
      try {
        if (dayChanged) {
          const s = stops.find((x) => x.id === draggedId)
          await api.admin({
            action: 'update_stop', openid: this.data.openid, id: s.id, planId: this.data.active.id,
            name: s.name, address: s.address || '', note: s.note || '', plannedTime: s.plannedTime || '',
            openHours: s.openHours || '', ticket: s.ticket || '', bookingUrl: s.bookingUrl || '',
            stayMinutes: s.stayMinutes || 0, day: Number(s.day),
            latitude: s.latitude == null ? '' : s.latitude, longitude: s.longitude == null ? '' : s.longitude,
          })
        }
        await api.admin({ action: 'reorder_stops', openid: this.data.openid, ids: stops.map((s) => s.id) })
        if (dayChanged) await this.load()
        else this.applyActive()
      } catch (err) {
        wx.showToast({ title: '排序未保存', icon: 'none' })
      }
    }
    persist()
  },
  // ③ 一键路线最优排序：当天各点按最近邻从出发点起重排（仅排当天，保留其余天顺序）
  async optimizeDay(e) {
    if (!this.data.canEdit) { wx.showToast({ title: '登录后可调整', icon: 'none' }); return }
    const day = Number(e.currentTarget.dataset.day)
    const plan = this.data.active
    if (!plan) return
    const grp = (this.data.dayGroups || []).find((g) => g.day === day)
    if (!grp) return
    const dayStops = (plan.stops || []).filter((s) => Number(s.day) === day)
    const geo = dayStops.filter((s) => validCoord(s.latitude, s.longitude))
    if (geo.length < 3) { wx.showToast({ title: '需 3 个以上带坐标的点', icon: 'none' }); return }
    // 起点坐标
    let cur = null
    if (grp.startCustom) {
      const ds = (plan.dayStarts || {})[day] || (plan.dayStarts || {})[String(day)]
      const coord = ds ? validCoord(ds.lat, ds.lng) : null
      if (coord) cur = { lat: coord.latitude, lng: coord.longitude }
    }
    if (!cur) {
      const h = hotelForDay(plan, day)
      const coord = h ? validCoord(h.lat, h.lng) : null
      if (coord) cur = { lat: coord.latitude, lng: coord.longitude }
    }
    if (!cur) cur = { lat: geo[0].latitude, lng: geo[0].longitude }
    // 最近邻贪心
    const pool = geo.slice()
    const ordered = []
    while (pool.length) {
      let bi = 0; let bd = Infinity
      for (let i = 0; i < pool.length; i++) {
        const dd = haversineM(cur.lat, cur.lng, pool[i].latitude, pool[i].longitude)
        if (dd != null && dd < bd) { bd = dd; bi = i }
      }
      const nx = pool.splice(bi, 1)[0]
      ordered.push(nx)
      cur = { lat: nx.latitude, lng: nx.longitude }
    }
    // 无坐标的点保持原相对顺序，接在当天末尾
    const noGeo = dayStops.filter((s) => s.latitude == null || s.longitude == null)
    const newDayOrder = ordered.concat(noGeo)
    // 拼回全局顺序：其它天保持原序，本天替换为新序
    const full = (plan.stops || []).map((s) => ({ ...s }))
    let k = 0
    const newFull = full.map((s) => (Number(s.day) === day ? newDayOrder[k++] : s))
    try {
      wx.showLoading({ title: '优化中…', mask: true })
      await api.admin({ action: 'reorder_stops', openid: this.data.openid, ids: newFull.map((s) => s.id) })
      await this.load()
      wx.hideLoading()
      wx.showToast({ title: '已按最短路程重排', icon: 'none' })
    } catch (err) {
      wx.hideLoading()
      wx.showToast({ title: '优化失败', icon: 'none' })
    }
  },

  /* ---------------- 目的地抽屉：怎么去 + 一键导航 ---------------- */
  // 计算某个目的地的「出发点」：同一天的上一站；当天第一站则用当天自定义出发点或酒店
  originForStop(stop) {
    const plan = this.data.active
    if (!plan) return null
    const stops = plan.stops || []
    const idx = stops.findIndex((s) => s.id === stop.id)
    if (idx > 0 && stops[idx - 1].day === stop.day) {
      const prev = stops[idx - 1]
      const coord = validCoord(prev.latitude, prev.longitude)
      if (coord) return { name: prev.name, address: prev.address || '', lat: coord.latitude, lng: coord.longitude }
      return { name: prev.name, address: prev.address || '', lat: null, lng: null }
    }
    // 当天第一站 → 自定义出发点 or 酒店
    const dayStarts = plan.dayStarts || {}
    const ds = dayStarts[stop.day] || dayStarts[String(stop.day)]
    if (ds && (ds.name || ds.lat != null)) {
      const coord = validCoord(ds.lat, ds.lng)
      return { name: ds.name || '出发点', address: ds.address || '', lat: coord ? coord.latitude : null, lng: coord ? coord.longitude : null }
    }
    const hotel = hotelForDay(plan, stop.day)
    if (hotel && (hotel.name || hotel.lat != null)) {
      const coord = validCoord(hotel.lat, hotel.lng)
      return { name: hotel.name || '酒店', address: hotel.address || '', lat: coord ? coord.latitude : null, lng: coord ? coord.longitude : null }
    }
    return null
  },
  openStopSheet(e) {
    const id = e.currentTarget.dataset.id
    const stop = (this.data.active && this.data.active.stops || []).find((s) => s.id === id)
    if (!stop) return
    const origin = this.originForStop(stop)
    const hasStopGeo = stop.latitude != null && stop.longitude != null
    const canRoute = !!(origin && origin.lat != null && origin.lng != null && hasStopGeo)
    // 从分组里取该站时间表（到达-离开）
    let sched = null
    for (const g of (this.data.dayGroups || [])) {
      const hit = (g.stops || []).find((x) => x.id === id)
      if (hit && hit.sched) { sched = hit.sched; break }
    }
    this.setData({
      stopSheet: {
        show: true, id: stop.id, name: stop.name, address: stop.address || '',
        day: Number(stop.day) || 1,
        note: stop.note || '', plannedTime: stop.plannedTime || '',
        stayText: Number(stop.stayMinutes) > 0 ? minHuman(Number(stop.stayMinutes)) : '',
        schedText: sched ? (sched.arrive + ' – ' + sched.leave) : '',
        openHours: stop.openHours || '', ticket: stop.ticket || '', bookingUrl: stop.bookingUrl || '',
        latitude: hasStopGeo ? Number(stop.latitude) : null,
        longitude: hasStopGeo ? Number(stop.longitude) : null,
        originName: origin ? origin.name : '',
        canNav: hasStopGeo,
        canRoute,
        route: { loading: canRoute, error: '', mode: '', modes: [] },
      },
    })
    // 地图高亮当前这段：起点 → 本站（在原路线之上叠一条醒目实线）
    if (canRoute) {
      const hl = {
        points: [
          { latitude: Number(origin.lat), longitude: Number(origin.lng) },
          { latitude: Number(stop.latitude), longitude: Number(stop.longitude) },
        ],
        color: '#c0392bF0', width: 6, arrowLine: true,
      }
      this.setData({
        mapPolyline: (this.data.mapPolylineBase || []).concat([hl]),
        mapInclude: hl.points,
      })
    }
    this.setTabBarHidden(true)
    if (canRoute) this.loadStopRoute(origin, stop)
  },
  // 把高德返回的某种方式整理成可展示对象
  fmtMode(key, opt) {
    const distTxt = (m) => (m >= 1000 ? (m / 1000).toFixed(1) + ' 公里' : m + ' 米')
    const m = { key, label: RECO_LABEL[key] || '路线', duration: opt.duration ? opt.duration + ' 分钟' : '', distance: '', extra: '', steps: opt.steps || [] }
    if (key === 'walking') {
      m.distance = opt.distance ? distTxt(opt.distance) : ''
    } else if (key === 'driving') {
      m.distance = opt.distance ? distTxt(opt.distance) : ''
      const ex = []
      if (opt.taxiCost > 0) ex.push('打车约 ¥' + opt.taxiCost)
      if (opt.tolls > 0) ex.push('过路费约 ¥' + opt.tolls)
      if (opt.lights > 0) ex.push('红绿灯 ' + opt.lights + ' 个')
      m.extra = ex.join(' · ')
    } else if (key === 'transit') {
      if (opt.usesMetro) m.label = '地铁 / 公交'
      const ex = []
      if (opt.usesMetro) ex.push('🚇 地铁优先')
      if (opt.cost > 0) ex.push('约 ¥' + opt.cost)
      if (opt.walkingDistance > 0) ex.push('步行 ' + distTxt(opt.walkingDistance))
      m.extra = ex.join(' · ')
      const lb = lastBusInfo(opt.lastBus)
      m.lastBusText = lb.text
      m.lastBusWarn = lb.warn
    }
    return m
  },
  async loadStopRoute(origin, stop) {
    try {
      const r = await api.getRoute({
        origin: `${origin.lng},${origin.lat}`,
        destination: `${stop.longitude},${stop.latitude}`,
      })
      const order = ['walking', 'transit', 'driving']
      const opts = r.options || {}
      const modes = order.filter((k) => opts[k]).map((k) => this.fmtMode(k, opts[k]))
      if (!modes.length) {
        this.setData({ 'stopSheet.route': { loading: false, error: '这段路线暂时没算出来', mode: '', modes: [] } })
        return
      }
      const reco = opts[r.recommend] ? r.recommend : modes[0].key
      this.setData({ 'stopSheet.route': { loading: false, error: '', mode: reco, modes } })
    } catch (err) {
      this.setData({ 'stopSheet.route': { loading: false, error: (err && err.data && err.data.message) || '这段路线暂时没算出来', mode: '', modes: [] } })
    }
  },
  pickRouteMode(e) {
    this.setData({ 'stopSheet.route.mode': e.currentTarget.dataset.mode })
  },
  copyStopAddr() {
    const s = this.data.stopSheet
    const txt = s.address || s.name
    if (!txt) return
    wx.setClipboardData({ data: txt, success: () => wx.showToast({ title: '已复制地址', icon: 'none' }) })
  },
  copyBookingUrl() {
    const url = this.data.stopSheet.bookingUrl
    if (!url) return
    wx.setClipboardData({ data: url, success: () => wx.showToast({ title: '链接已复制，可粘贴到浏览器打开', icon: 'none' }) })
  },
  closeStopSheet() {
    this.setData({ 'stopSheet.show': false, mapPolyline: this.data.mapPolylineBase || [] })
    this.setTabBarHidden(false)
  },
  // 抽屉里把这站改到第几天（同步更新归属，并按天重排顺序持久化）
  async changeStopDay(e) {
    if (!this.data.canEdit) { wx.showToast({ title: '登录后可调整', icon: 'none' }); return }
    const delta = Number(e.currentTarget.dataset.delta)
    const plan = this.data.active
    if (!plan) return
    const stop = (plan.stops || []).find((s) => s.id === this.data.stopSheet.id)
    if (!stop) return
    const dayMax = dayCount(plan.planDate, plan.planDateEnd) || 60
    const newDay = Math.max(1, Math.min(dayMax, (Number(stop.day) || 1) + delta))
    if (newDay === Number(stop.day)) return
    try {
      await api.admin({
        action: 'update_stop', openid: this.data.openid, id: stop.id, planId: plan.id,
        name: stop.name, address: stop.address || '', note: stop.note || '', plannedTime: stop.plannedTime || '',
        openHours: stop.openHours || '', ticket: stop.ticket || '', bookingUrl: stop.bookingUrl || '',
        day: newDay,
        latitude: stop.latitude == null ? '' : stop.latitude,
        longitude: stop.longitude == null ? '' : stop.longitude,
      })
      // 按天稳定重排（同天内保持原相对顺序），持久化全局顺序，避免分组交错
      const list = (plan.stops || []).map((s) => ({ ...s }))
      const t = list.find((s) => s.id === stop.id)
      if (t) t.day = newDay
      const ordered = list
        .map((s, i) => ({ s, i }))
        .sort((a, b) => (Number(a.s.day) - Number(b.s.day)) || (a.i - b.i))
        .map((x) => x.s)
      await api.admin({ action: 'reorder_stops', openid: this.data.openid, ids: ordered.map((s) => s.id) })
      this.setData({ 'stopSheet.day': newDay })
      await this.load()
      wx.showToast({ title: '已改到第 ' + newDay + ' 天', icon: 'none' })
    } catch (err) {
      wx.showToast({ title: (err && err.data && err.data.message) || '调整失败', icon: 'none' })
    }
  },
  // 抽屉里把这站在「当天」内上移/下移
  async moveStopInDay(e) {
    if (!this.data.canEdit) { wx.showToast({ title: '登录后可调整', icon: 'none' }); return }
    const dir = Number(e.currentTarget.dataset.dir)
    const plan = this.data.active
    if (!plan) return
    const list = (plan.stops || []).map((s) => ({ ...s }))
    const idx = list.findIndex((s) => s.id === this.data.stopSheet.id)
    if (idx < 0) return
    const day = Number(list[idx].day)
    let j = idx + dir
    while (j >= 0 && j < list.length && Number(list[j].day) !== day) j += dir
    if (j < 0 || j >= list.length || Number(list[j].day) !== day) {
      wx.showToast({ title: dir < 0 ? '已是当天第一个' : '已是当天最后一个', icon: 'none' })
      return
    }
    const tmp = list[idx]; list[idx] = list[j]; list[j] = tmp
    try {
      await api.admin({ action: 'reorder_stops', openid: this.data.openid, ids: list.map((s) => s.id) })
      await this.load()
      wx.showToast({ title: '已调整顺序', icon: 'none' })
    } catch (err) {
      wx.showToast({ title: (err && err.data && err.data.message) || '调整失败', icon: 'none' })
    }
  },
  /* ---------------- 当天全程：串联各段 + 估算总通勤时长 + 逐段导航 ---------------- */
  async openDayRoute(e) {
    const day = Number(e.currentTarget.dataset.day)
    const grp = (this.data.dayGroups || []).find((g) => g.day === day)
    if (!grp || !grp.stops || !grp.stops.length) return
    const origin = this.originForStop(grp.stops[0])
    const seq = []
    const originCoord = origin ? validCoord(origin.lat, origin.lng) : null
    if (origin) seq.push({ name: origin.name, lat: originCoord ? originCoord.latitude : null, lng: originCoord ? originCoord.longitude : null })
    grp.stops.forEach((s) => {
      const coord = validCoord(s.latitude, s.longitude)
      seq.push({
        name: s.name,
        lat: coord ? coord.latitude : null,
        lng: coord ? coord.longitude : null,
      })
    })
    const legs = []
    for (let i = 0; i < seq.length - 1; i++) {
      const a = seq[i]
      const b = seq[i + 1]
      legs.push({
        fromName: a.name, toName: b.name, toLat: b.lat, toLng: b.lng,
        canNav: b.lat != null && b.lng != null,
        hasGeo: a.lat != null && a.lng != null && b.lat != null && b.lng != null,
        label: '', dur: '', dist: '',
      })
    }
    this.setData({ dayRouteSheet: { show: true, day, label: grp.label, loading: true, total: '', legs } })
    this.setTabBarHidden(true)
    let totalMins = 0
    let anyOk = false
    for (let i = 0; i < legs.length; i++) {
      if (!legs[i].hasGeo) {
        this.setData({ [`dayRouteSheet.legs[${i}].dur`]: '缺坐标' })
        continue
      }
      const a = seq[i]
      const b = seq[i + 1]
      try {
        const r = await api.getRoute({ origin: `${a.lng},${a.lat}`, destination: `${b.lng},${b.lat}` })
        const opt = (r.options && r.options[r.recommend]) || {}
        const mins = opt.duration || 0
        if (mins) { totalMins += mins; anyOk = true }
        this.setData({
          [`dayRouteSheet.legs[${i}].label`]: RECO_LABEL[r.recommend] || '',
          [`dayRouteSheet.legs[${i}].dur`]: mins ? mins + ' 分钟' : '',
          [`dayRouteSheet.legs[${i}].dist`]: opt.distance ? (opt.distance >= 1000 ? (opt.distance / 1000).toFixed(1) + ' 公里' : opt.distance + ' 米') : '',
        })
      } catch (err) {
        this.setData({ [`dayRouteSheet.legs[${i}].dur`]: '暂时没算出' })
      }
    }
    this.setData({ 'dayRouteSheet.loading': false, 'dayRouteSheet.total': anyOk ? '约 ' + totalMins + ' 分钟' : '' })
  },
  closeDayRoute() {
    this.setData({ 'dayRouteSheet.show': false })
    this.setTabBarHidden(false)
  },
  navLeg(e) {
    const d = e.currentTarget.dataset
    if (d.lat == null || d.lat === '') return
    wx.openLocation({ latitude: Number(d.lat), longitude: Number(d.lng), name: d.name || '', scale: 16 })
  },
  // 一键导航：唤起微信内置地图（可再跳第三方地图 App）
  navStop() {
    const s = this.data.stopSheet
    if (s.latitude == null || s.longitude == null) {
      wx.showToast({ title: '该地点未定位', icon: 'none' })
      return
    }
    wx.openLocation({ latitude: Number(s.latitude), longitude: Number(s.longitude), name: s.name, address: s.address || '', scale: 16 })
  },
  editFromStopSheet() {
    if (!this.data.canEdit) {
      wx.showToast({ title: '登录后可编辑', icon: 'none' })
      wx.switchTab({ url: '/pages/mine/mine' })
      return
    }
    const id = this.data.stopSheet.id
    this.setData({ 'stopSheet.show': false })
    this.openStopEdit({ currentTarget: { dataset: { id } } })
  },

  /* ---------------- 每天出发点（默认酒店，可自定义） ---------------- */
  openDayStart(e) {
    if (!this.data.canEdit) {
      wx.showToast({ title: '登录后可设置', icon: 'none' })
      return
    }
    const day = Number(e.currentTarget.dataset.day) || 1
    const plan = this.data.active
    const dayStarts = (plan && plan.dayStarts) || {}
    const ds = dayStarts[day] || dayStarts[String(day)] || {}
    const hotel = hotelForDay(plan, day) || {}
    this.setData({
      dayStartEditor: {
        show: true, day,
        name: ds.name || '', address: ds.address || '',
        lat: ds.lat == null ? '' : String(ds.lat), lng: ds.lng == null ? '' : String(ds.lng),
        geoLoading: false, hotelName: hotel.name || '',
      },
    })
    this.setTabBarHidden(true)
  },
  closeDayStartEditor() {
    this.setData({ 'dayStartEditor.show': false })
    this.setTabBarHidden(false)
  },
  onDayStartField(e) {
    const k = e.currentTarget.dataset.field
    this.setData({ [`dayStartEditor.${k}`]: e.detail.value })
  },
  async geocodeDayStart() {
    const ed = this.data.dayStartEditor
    const addr = (ed.address || ed.name || '').trim()
    if (!addr) {
      wx.showToast({ title: '先填名称或地址', icon: 'none' })
      return
    }
    this.setData({ 'dayStartEditor.geoLoading': true })
    try {
      const r = await api.admin({ action: 'geo', openid: this.data.openid, address: addr })
      const coord = r ? validCoord(r.latitude, r.longitude) : null
      if (coord) {
        this.setData({
          'dayStartEditor.lng': String(coord.longitude),
          'dayStartEditor.lat': String(coord.latitude),
          'dayStartEditor.address': r.formatted || ed.address,
          'dayStartEditor.geoLoading': false,
        })
        wx.showToast({ title: '已定位', icon: 'success' })
      } else {
        this.setData({ 'dayStartEditor.geoLoading': false })
        wx.showToast({ title: '未找到该地点', icon: 'none' })
      }
    } catch (err) {
      this.setData({ 'dayStartEditor.geoLoading': false })
      wx.showToast({ title: (err && err.data && err.data.message) || '定位失败', icon: 'none' })
    }
  },
  async saveDayStart() {
    const ed = this.data.dayStartEditor
    const plan = this.data.active
    if (!plan) return
    if (!ed.name.trim() && !ed.address.trim()) {
      wx.showToast({ title: '填名称或地址', icon: 'none' })
      return
    }
    try {
      await api.admin({
        action: 'set_day_start', openid: this.data.openid, id: plan.id, day: ed.day,
        name: ed.name.trim(), address: ed.address.trim(), lat: ed.lat || '', lng: ed.lng || '',
      })
      this.setData({ 'dayStartEditor.show': false })
      this.setTabBarHidden(false)
      await this.load()
      wx.showToast({ title: '已保存', icon: 'success' })
    } catch (err) {
      wx.showToast({ title: (err && err.data && err.data.message) || '保存失败', icon: 'none' })
    }
  },
  // 恢复默认：删除当天自定义出发点，回落到酒店
  async resetDayStart() {
    const ed = this.data.dayStartEditor
    const plan = this.data.active
    if (!plan) return
    try {
      await api.admin({ action: 'set_day_start', openid: this.data.openid, id: plan.id, day: ed.day, clear: 1 })
      this.setData({ 'dayStartEditor.show': false })
      this.setTabBarHidden(false)
      await this.load()
      wx.showToast({ title: '已恢复默认', icon: 'success' })
    } catch (err) {
      wx.showToast({ title: (err && err.data && err.data.message) || '操作失败', icon: 'none' })
    }
  },

  /* ---------------- 多晚 / 分段住宿 ---------------- */
  openHotelsEditor() {
    if (!this.data.canEdit) {
      wx.showToast({ title: '登录后可设置', icon: 'none' })
      return
    }
    const plan = this.data.active
    if (!plan) return
    const dayMax = dayCount(plan.planDate, plan.planDateEnd) || 1
    let key = 0
    let list = (plan.hotels || []).map((h) => ({
      key: key++, name: h.name || '', address: h.address || '',
      lat: h.lat == null ? '' : String(h.lat), lng: h.lng == null ? '' : String(h.lng),
      startDay: Number(h.startDay) || 1, endDay: Number(h.endDay) || Number(h.startDay) || 1,
      geoLoading: false,
    }))
    // 没有多段数据时，用旧单酒店或一条空白覆盖全程作为起点
    if (!list.length) {
      const h = plan.hotel || {}
      list = [{
        key: key++, name: h.name || '', address: h.address || '',
        lat: h.lat == null ? '' : String(h.lat), lng: h.lng == null ? '' : String(h.lng),
        startDay: 1, endDay: dayMax, geoLoading: false,
      }]
    }
    this.setData({ hotelsEditor: { show: true, planId: plan.id, dayMax, list, _key: key } })
    this.setTabBarHidden(true)
  },
  closeHotelsEditor() {
    this.setData({ 'hotelsEditor.show': false })
    this.setTabBarHidden(false)
  },
  addHotelSeg() {
    const ed = this.data.hotelsEditor
    const key = ed._key || ed.list.length
    const last = ed.list[ed.list.length - 1]
    const sd = last ? Math.min((Number(last.endDay) || 1) + 1, ed.dayMax || 1) : 1
    const list = ed.list.concat([{
      key, name: '', address: '', lat: '', lng: '', startDay: sd, endDay: Math.max(sd, ed.dayMax || sd), geoLoading: false,
    }])
    this.setData({ 'hotelsEditor.list': list, 'hotelsEditor._key': key + 1 })
  },
  removeHotelSeg(e) {
    const i = Number(e.currentTarget.dataset.i)
    const list = this.data.hotelsEditor.list.slice()
    list.splice(i, 1)
    this.setData({ 'hotelsEditor.list': list })
  },
  onHotelSegField(e) {
    const i = Number(e.currentTarget.dataset.i)
    const field = e.currentTarget.dataset.field
    this.setData({ [`hotelsEditor.list[${i}].${field}`]: e.detail.value })
  },
  adjustHotelSegDay(e) {
    const i = Number(e.currentTarget.dataset.i)
    const field = e.currentTarget.dataset.field
    const delta = Number(e.currentTarget.dataset.delta)
    const seg = this.data.hotelsEditor.list[i]
    if (!seg) return
    const max = this.data.hotelsEditor.dayMax || 60
    let v = (Number(seg[field]) || 1) + delta
    v = Math.max(1, Math.min(max, v))
    const patch = { [`hotelsEditor.list[${i}].${field}`]: v }
    // 保持 start ≤ end
    if (field === 'startDay' && v > (Number(seg.endDay) || 1)) patch[`hotelsEditor.list[${i}].endDay`] = v
    if (field === 'endDay' && v < (Number(seg.startDay) || 1)) patch[`hotelsEditor.list[${i}].startDay`] = v
    this.setData(patch)
  },
  async geocodeHotelSeg(e) {
    const i = Number(e.currentTarget.dataset.i)
    const seg = this.data.hotelsEditor.list[i]
    if (!seg) return
    const addr = (seg.address || seg.name || '').trim()
    if (!addr) {
      wx.showToast({ title: '先填地址或名称', icon: 'none' })
      return
    }
    this.setData({ [`hotelsEditor.list[${i}].geoLoading`]: true })
    try {
      const r = await api.admin({ action: 'geo', openid: this.data.openid, address: addr })
      if (r && r.longitude != null && r.latitude != null) {
        this.setData({
          [`hotelsEditor.list[${i}].lng`]: String(r.longitude),
          [`hotelsEditor.list[${i}].lat`]: String(r.latitude),
          [`hotelsEditor.list[${i}].address`]: r.formatted || seg.address,
          [`hotelsEditor.list[${i}].geoLoading`]: false,
        })
      } else {
        this.setData({ [`hotelsEditor.list[${i}].geoLoading`]: false })
        wx.showToast({ title: '未找到坐标', icon: 'none' })
      }
    } catch (err) {
      this.setData({ [`hotelsEditor.list[${i}].geoLoading`]: false })
      wx.showToast({ title: (err && err.data && err.data.message) || '定位失败', icon: 'none' })
    }
  },
  async saveHotels() {
    const ed = this.data.hotelsEditor
    const plan = this.data.active
    if (!plan) return
    const hotels = (ed.list || [])
      .filter((h) => (h.name || '').trim() || h.lat)
      .map((h) => ({
        name: (h.name || '').trim(), address: (h.address || '').trim(),
        lat: h.lat || '', lng: h.lng || '',
        startDay: Number(h.startDay) || 1, endDay: Number(h.endDay) || Number(h.startDay) || 1,
      }))
    try {
      await api.admin({ action: 'set_hotels', openid: this.data.openid, id: plan.id, hotels })
      this.setData({ 'hotelsEditor.show': false })
      this.setTabBarHidden(false)
      await this.load()
      wx.showToast({ title: '已保存', icon: 'success' })
    } catch (err) {
      wx.showToast({ title: (err && err.data && err.data.message) || '保存失败', icon: 'none' })
    }
  },

  /* ---------------- 行程导出 / 分享 ---------------- */
  planSummary() {
    const p = this.data.active
    if (!p) return ''
    const lines = [`【${p.title}】`]
    if (p.planDateText) lines.push(p.planDateText)
    ;(p.stops || []).forEach((s, i) => {
      let line = `${String(i + 1).padStart(2, '0')}. ${s.name}`
      if (s.plannedTime) line += `（${s.plannedTime}）`
      if (s.note) line += ` — ${s.note}`
      lines.push(line)
    })
    return lines.join('\n')
  },

  copyPlan() {
    const text = this.planSummary()
    if (!text) {
      wx.showToast({ title: '还没有行程', icon: 'none' })
      return
    }
    wx.setClipboardData({
      data: text,
      success: () => wx.showToast({ title: '已复制，去粘贴给 TA', icon: 'none' }),
    })
  },

  onShareAppMessage() {
    const p = this.data.active
    const title = p ? `我们的行程 · ${p.title}` : '我们的旅行计划'
    return { title, path: '/pages/plans/plans' }
  },

  onShareTimeline() {
    const p = this.data.active
    return { title: p ? `我们的行程 · ${p.title}` : '我们的旅行计划' }
  },
})
