const app = getApp()
const api = require('../../utils/api')
const { toneGradient, TONE_LIST, TONE_NAMES } = require('../../utils/util')
const { buildItineraryPoster } = require('../../utils/poster')

const ROW_RPX = 268 // 拖动列表每行槽位高度（含间距、「怎么去」提示，首行还要容纳「第 N 天」小标题）
const RECO_LABEL = { walking: '步行', transit: '公交 / 地铁', driving: '驾车' }
// 每天一种颜色，地图上区分不同天的路线
const DAY_COLORS = ['#1b1712', '#b4423a', '#2f6f4f', '#3a5ba0', '#9a6b2f', '#7a4fa0', '#2f8a8a', '#a03f6b']
function dayColor(day) { return DAY_COLORS[((Number(day) || 1) - 1) % DAY_COLORS.length] }
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
    areaH: 0,
    dragId: 0,

    // 地图可视化
    mapMarkers: [],
    mapPolyline: [],
    mapPolylineBase: [],
    mapInclude: [],
    mapCenter: { latitude: 34.5, longitude: 110 },
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
    // 预算汇总（按分类）
    budgetBars: [],

    expCats: EXP_CATS,
    expenses: [],
    expenseTotal: 0,
    expenseEditor: { show: false, catIndex: 0, amount: '', memo: '' },

    planEditor: {
      show: false, mode: 'add', id: '', title: '', toneIndex: 0, coverTone: TONE_LIST[0],
      planDate: '', planDateEnd: '', dayCountText: '', coverImageUrl: '', uploadingCover: false, note: '',
      hotelName: '', hotelAddress: '', hotelLat: '', hotelLng: '', hotelGeoLoading: false,
    },
    stopEditor: {
      show: false, mode: 'add', id: 0, planId: '',
      name: '', address: '', plannedTime: '', stayMinutes: 0, note: '', day: 1,
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
    const sys = wx.getSystemInfoSync()
    const rowH = Math.round((ROW_RPX * sys.windowWidth) / 750)
    this.setData({ rowH })
    const user = app.getUser()
    if (user && user.openid) this.setData({ openid: user.openid, canEdit: true })
    this.refreshAdminThenLoad()
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 2, hidden: false })
    }
    // 登录可能发生在「我的」页，回到本页时同步编辑权限
    const user = app.getUser()
    const openid = user && user.openid ? user.openid : ''
    if (openid && openid !== this.data.openid) {
      this.setData({ openid, canEdit: true })
      if (this.data.ready) this.refreshAdminThenLoad()
    }
  },

  onPullDownRefresh() {
    this.load().then(
      () => wx.stopPullDownRefresh(),
      () => wx.stopPullDownRefresh()
    )
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
      this.setData({ loading: false, ready: true, error: '加载失败，请检查网络' })
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
    const stops = plan.stops.map((s, i) => {
      const day = Number(s.day) || 1
      return {
        ...s,
        no: String(i + 1).padStart(2, '0'),
        _y: i * this.data.rowH,
        day,
        dayTag: multiDay ? 'D' + day : '',
      }
    })
    this.markDayFirst(stops, multiDay, plan)
    const active = { ...plan, stops }

    const geo = stops.filter((s) => s.latitude != null && s.longitude != null)

    // 按天分组（每天显示出发点：默认对应当晚酒店，可自定义）
    const dayStarts = plan.dayStarts || {}
    const dayMap = {}
    stops.forEach((s) => { (dayMap[s.day] = dayMap[s.day] || []).push(s) })
    const startISO = plan.planDateISO || toISO(plan.planDate)
    const wmap = this.data.weatherByDate || {}
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
          if (ds.lat != null) startCoord = { lat: Number(ds.lat), lng: Number(ds.lng) }
        } else if (hotel && (hotel.name || hotel.lat != null)) {
          startName = hotel.name || '酒店'
          if (hotel.lat != null) startCoord = { lat: Number(hotel.lat), lng: Number(hotel.lng) }
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
          weather: w ? (w.dayWeather + ' ' + w.nightTemp + '~' + w.dayTemp + '°') : '',
          commuteText: sched.commuteMin > 0 ? minHuman(sched.commuteMin) : '',
          stayText: sched.stayMin > 0 ? minHuman(sched.stayMin) : '',
          spanText: sched.spanMin > 0 ? minHuman(sched.spanMin) : '',
          loadKey: sched.loadKey, loadText: sched.loadText,
          canOptimize: dayMap[d].filter((s) => s.latitude != null && s.longitude != null).length >= 3,
        }
      })

    // 地图：按天着色的编号标记 + 路线（支持「全部 / 第N天」筛选）
    const dayChips = multiDay
      ? [{ day: 0, label: '全部', color: '#1b1712' }].concat(
          dayGroups.filter((g) => g.stops.some((s) => s.latitude != null)).map((g) => ({ day: g.day, label: '第' + g.day + '天', color: dayColor(g.day) })))
      : []
    if (this.data.mapDayFilter && !dayChips.some((c) => c.day === this.data.mapDayFilter)) this.data.mapDayFilter = 0
    const md = this.buildMapData(dayGroups, multiDay, this.data.mapDayFilter || 0)

    this.setData({
      active, areaH: stops.length * this.data.rowH,
      mapMarkers: md.markers, mapPolyline: md.polylines, mapPolylineBase: md.polylines,
      mapInclude: md.include, mapCenter: md.center || this.data.mapCenter, geoStopCount: geo.length,
      mapDayChips: dayChips, mapDayFilter: this.data.mapDayFilter || 0,
      multiDay, dayGroups,
    })
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
      const geo = (g.stops || []).filter((s) => s.latitude != null && s.longitude != null)
      geo.forEach((s, i) => {
        markers.push({
          id: s.id,
          latitude: s.latitude,
          longitude: s.longitude,
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
        include.push({ latitude: s.latitude, longitude: s.longitude })
      })
      // 连线：当天出发点（若有坐标）→ 各站
      const pts = []
      if (g.startCoord && g.startCoord.lat != null) pts.push({ latitude: g.startCoord.lat, longitude: g.startCoord.lng })
      geo.forEach((s) => pts.push({ latitude: s.latitude, longitude: s.longitude }))
      if (pts.length > 1) polylines.push({ points: pts, color: color + 'B3', width: multiDay ? 3 : 2, dottedLine: !multiDay, arrowLine: true })
    })
    if (include.length) center = { latitude: include[0].latitude, longitude: include[0].longitude }
    return { markers, polylines, include, center }
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
    })
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
          wx.showToast({ title: '生成失败', icon: 'none' }); return
        }
        try {
          const tempFilePath = await buildItineraryPoster(node, data)
          wx.hideLoading(); this.setData({ posterMaking: false })
          wx.previewImage({ urls: [tempFilePath], current: tempFilePath })
        } catch (e) {
          wx.hideLoading(); this.setData({ posterMaking: false })
          wx.showToast({ title: '生成失败，请重试', icon: 'none' })
        }
      })
  },

  // 拉取目的地城市的高德天气（4 天预报），按计划日期映射到每天
  async loadWeather() {
    const plan = this.data.active
    if (!plan || !this.data.openid) return
    const startISO = plan.planDateISO || toISO(plan.planDate)
    if (!startISO) return // 无计划日期无法对应天气
    // 取一个坐标定位城市：酒店优先，否则第一个有坐标的目的地
    let lat = null
    let lng = null
    const h0 = hotelForDay(plan, 1)
    if (h0 && h0.lat != null && h0.lng != null) {
      lat = h0.lat; lng = h0.lng
    } else {
      const g = (plan.stops || []).find((s) => s.latitude != null && s.longitude != null)
      if (g) { lat = g.latitude; lng = g.longitude }
    }
    if (lat == null || lng == null) return
    try {
      const r = await api.admin({ action: 'weather', openid: this.data.openid, latitude: lat, longitude: lng })
      const wmap = {}
      ;(r.casts || []).forEach((c) => { if (c.date) wmap[c.date] = c })
      this.setData({ weatherByDate: wmap })
      // 回填到当前 dayGroups
      const dg = (this.data.dayGroups || []).map((g) => {
        const w = g.dateISO ? wmap[g.dateISO] : null
        return { ...g, weather: w ? (w.dayWeather + ' ' + w.nightTemp + '~' + w.dayTemp + '°') : '' }
      })
      this.setData({ dayGroups: dg })
    } catch (e) {
      // 天气失败不影响主流程
    }
  },

  openStopLocation(e) {
    const id = e.currentTarget.dataset.id
    const s = (this.data.active && this.data.active.stops || []).find((x) => x.id === id)
    if (!s || s.latitude == null || s.longitude == null) return
    wx.openLocation({ latitude: Number(s.latitude), longitude: Number(s.longitude), name: s.name, address: s.address || '', scale: 16 })
  },

  /* ---------------- 记账 ---------------- */
  async loadExpenses() {
    const p = this.data.active
    if (!p || !this.data.openid) {
      this.setData({ expenses: [], expenseTotal: 0, budgetBars: [] })
      return
    }
    try {
      const r = await api.admin({ action: 'expenses', openid: this.data.openid, planId: p.id })
      const expenses = (r.expenses || []).map((e) => ({ ...e, catName: EXP_CAT_LABEL[e.category] || '其他' }))
      const catSum = {}
      expenses.forEach((e) => { catSum[e.category] = (catSum[e.category] || 0) + Number(e.amount || 0) })
      const max = Math.max(1, ...EXP_CATS.map((c) => catSum[c.key] || 0))
      const budgetBars = EXP_CATS
        .map((c) => ({ key: c.key, name: c.name, value: Math.round((catSum[c.key] || 0) * 100) / 100, pct: Math.round(((catSum[c.key] || 0) / max) * 100) }))
        .filter((b) => b.value > 0)
      this.setData({ expenses, expenseTotal: r.total || 0, budgetBars })
    } catch (e) {
      this.setData({ expenses: [], expenseTotal: 0, budgetBars: [] })
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
      this.loadExpenses()
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
          this.loadExpenses()
        } catch (err) {
          wx.showToast({ title: '删除失败', icon: 'none' })
        }
      },
    })
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
      if (r && r.longitude && r.latitude) {
        this.setData({
          'planEditor.hotelLng': String(r.longitude),
          'planEditor.hotelLat': String(r.latitude),
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
      if (r && r.longitude && r.latitude) {
        this.setData({
          'stopEditor.longitude': String(r.longitude),
          'stopEditor.latitude': String(r.latitude),
          'stopEditor.address': r.formatted || ed.address,
          'stopEditor.geoLoading': false,
        })
        wx.showToast({ title: '已定位', icon: 'success' })
      } else {
        this.setData({ 'stopEditor.geoLoading': false })
        wx.showToast({ title: '未找到该地点', icon: 'none' })
      }
    } catch (e) {
      this.setData({ 'stopEditor.geoLoading': false })
      wx.showToast({ title: (e && e.data && e.data.message) || '定位失败', icon: 'none' })
    }
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
  markDayFirst(stops, multiDay, plan) {
    plan = plan || this.data.active || {}
    const dayStarts = plan.dayStarts || {}
    let prev = null
    stops.forEach((s, i) => {
      const isFirstOfDay = i === 0 || s.day !== prev
      s.dayFirst = !!multiDay && isFirstOfDay
      s.dayLabel = '第 ' + s.day + ' 天'
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

  // 点景点 → AI 地点介绍（怎么玩/怎么逛/附近美食）
  aiPlace(e) {
    const name = (e.currentTarget.dataset.name || '').trim()
    if (!name) return
    wx.navigateTo({ url: '/pages/ai/ai?mode=place&place=' + encodeURIComponent(name) + '&auto=1' })
  },

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
    let to = Math.round(e.detail.y / this.data.rowH)
    to = Math.max(0, Math.min(n - 1, to))
    if (to === from) return
    const stops = this.data.active.stops.slice()
    const [moved] = stops.splice(from, 1)
    stops.splice(to, 0, moved)
    // 重排非拖动项的槽位（拖动项跟随手指，不强制其 _y）
    stops.forEach((s, i) => {
      s.no = String(i + 1).padStart(2, '0')
      if (s.id !== this.data.dragId) s._y = i * this.data.rowH
    })
    this.dragFrom = to
    this.setData({ 'active.stops': stops })
  },
  onStopTouchEnd() {
    if (!this.data.dragId) return
    const draggedId = this.data.dragId
    const stops = this.data.active.stops.slice()
    stops.forEach((s, i) => {
      s._y = i * this.data.rowH
    })
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
    this.setData({ 'active.stops': stops, dragId: 0 })
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
    const geo = dayStops.filter((s) => s.latitude != null && s.longitude != null)
    if (geo.length < 3) { wx.showToast({ title: '需 3 个以上带坐标的点', icon: 'none' }); return }
    // 起点坐标
    let cur = null
    if (grp.startCustom) {
      const ds = (plan.dayStarts || {})[day] || (plan.dayStarts || {})[String(day)]
      if (ds && ds.lat != null) cur = { lat: Number(ds.lat), lng: Number(ds.lng) }
    }
    if (!cur) { const h = hotelForDay(plan, day); if (h && h.lat != null) cur = { lat: Number(h.lat), lng: Number(h.lng) } }
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
      if (prev.latitude != null && prev.longitude != null) {
        return { name: prev.name, address: prev.address || '', lat: Number(prev.latitude), lng: Number(prev.longitude) }
      }
      return { name: prev.name, address: prev.address || '', lat: null, lng: null }
    }
    // 当天第一站 → 自定义出发点 or 酒店
    const dayStarts = plan.dayStarts || {}
    const ds = dayStarts[stop.day] || dayStarts[String(stop.day)]
    if (ds && (ds.name || ds.lat != null)) {
      return { name: ds.name || '出发点', address: ds.address || '', lat: ds.lat == null ? null : Number(ds.lat), lng: ds.lng == null ? null : Number(ds.lng) }
    }
    const hotel = hotelForDay(plan, stop.day)
    if (hotel && (hotel.name || hotel.lat != null)) {
      return { name: hotel.name || '酒店', address: hotel.address || '', lat: hotel.lat == null ? null : Number(hotel.lat), lng: hotel.lng == null ? null : Number(hotel.lng) }
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
        this.setData({ 'stopSheet.route': { loading: false, error: '未能规划出路线', mode: '', modes: [] } })
        return
      }
      const reco = opts[r.recommend] ? r.recommend : modes[0].key
      this.setData({ 'stopSheet.route': { loading: false, error: '', mode: reco, modes } })
    } catch (err) {
      this.setData({ 'stopSheet.route': { loading: false, error: (err && err.data && err.data.message) || '规划失败', mode: '', modes: [] } })
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
    if (origin) seq.push({ name: origin.name, lat: origin.lat, lng: origin.lng })
    grp.stops.forEach((s) => seq.push({
      name: s.name,
      lat: s.latitude == null ? null : Number(s.latitude),
      lng: s.longitude == null ? null : Number(s.longitude),
    }))
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
        this.setData({ [`dayRouteSheet.legs[${i}].dur`]: '规划失败' })
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
      if (r && r.longitude && r.latitude) {
        this.setData({
          'dayStartEditor.lng': String(r.longitude),
          'dayStartEditor.lat': String(r.latitude),
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
