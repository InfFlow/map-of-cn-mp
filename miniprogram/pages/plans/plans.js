const app = getApp()
const api = require('../../utils/api')
const { toneGradient, TONE_LIST, TONE_NAMES } = require('../../utils/util')

const ROW_RPX = 268 // 拖动列表每行槽位高度（含间距、「怎么去」提示，首行还要容纳「第 N 天」小标题）
const RECO_LABEL = { walking: '步行', transit: '公交 / 地铁', driving: '驾车' }
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
      name: '', address: '', plannedTime: '', note: '', day: 1,
      latitude: '', longitude: '', geoLoading: false,
    },
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

    // 地图：编号标记 + 按顺序连成墨色虚线路线
    const geo = stops.filter((s) => s.latitude != null && s.longitude != null)
    const mapMarkers = geo.map((s) => ({
      id: s.id,
      latitude: s.latitude,
      longitude: s.longitude,
      iconPath: '/assets/pin.png',
      width: 26,
      height: 32,
      anchor: { x: 0.5, y: 1 },
      label: {
        content: s.no,
        color: '#1b1712', fontSize: 10,
        anchorX: -8, anchorY: -34,
        bgColor: '#faf8f3', borderColor: '#1b1712', borderWidth: 1, borderRadius: 8, padding: 3,
      },
      callout: {
        content: `${s.no} · ${s.name}`,
        color: '#1f1d1b', fontSize: 12, borderRadius: 10, borderWidth: 1,
        borderColor: '#00000014', padding: 8, bgColor: '#ffffff', display: 'BYCLICK',
      },
    }))
    const mapPolyline = geo.length > 1
      ? [{ points: geo.map((s) => ({ latitude: s.latitude, longitude: s.longitude })), color: '#1b1712B3', width: 2, dottedLine: true, arrowLine: true }]
      : []
    const mapInclude = geo.map((s) => ({ latitude: s.latitude, longitude: s.longitude }))
    const mapCenter = geo.length ? { latitude: geo[0].latitude, longitude: geo[0].longitude } : this.data.mapCenter

    // 按天分组（每天显示出发点：默认酒店，可自定义）
    const hotel = plan.hotel || null
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
        let startName = ''
        let startCustom = false
        if (ds && (ds.name || ds.lat != null)) {
          startName = ds.name || '自定义出发点'
          startCustom = true
        } else if (hotel && (hotel.name || hotel.lat != null)) {
          startName = hotel.name || '酒店'
        }
        const dateISO = startISO ? addDaysISO(startISO, d - 1) : ''
        const w = dateISO ? wmap[dateISO] : null
        return {
          day: d, label: '第 ' + d + ' 天', stops: dayMap[d], startName, startCustom, hasStart: !!startName,
          dateISO, dateText: dateLabel(dateISO),
          weather: w ? (w.dayWeather + ' ' + w.nightTemp + '~' + w.dayTemp + '°') : '',
        }
      })

    this.setData({
      active, areaH: stops.length * this.data.rowH,
      mapMarkers, mapPolyline, mapPolylineBase: mapPolyline, mapInclude, mapCenter, geoStopCount: geo.length,
      multiDay, dayGroups,
    })
    this.loadExpenses()
    this.loadWeather()
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
    if (plan.hotel && plan.hotel.lat != null && plan.hotel.lng != null) {
      lat = plan.hotel.lat; lng = plan.hotel.lng
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
      stopEditor: { show: true, mode: 'add', id: 0, planId: p.id, name: '', address: '', plannedTime: '', note: '', openHours: '', ticket: '', bookingUrl: '', day: 1, latitude: '', longitude: '', geoLoading: false },
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
        name: s.name || '', address: s.address || '', plannedTime: s.plannedTime || '', note: s.note || '',
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
    const hotel = plan.hotel || null
    const dayStarts = plan.dayStarts || {}
    let prev = null
    stops.forEach((s, i) => {
      const isFirstOfDay = i === 0 || s.day !== prev
      s.dayFirst = !!multiDay && isFirstOfDay
      s.dayLabel = '第 ' + s.day + ' 天'
      // 每天首站标注出发点（默认酒店，可自定义）
      if (isFirstOfDay) {
        const ds = dayStarts[s.day] || dayStarts[String(s.day)]
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
    const stops = this.data.active.stops.slice()
    stops.forEach((s, i) => {
      s._y = i * this.data.rowH
    })
    this.markDayFirst(stops, this.data.multiDay)
    this.setData({ 'active.stops': stops, dragId: 0 })
    // 同步本地 plans 缓存并持久化排序
    const plans = this.data.plans.slice()
    plans[this.data.activeIndex] = { ...plans[this.data.activeIndex], stops: stops.map((s) => ({ ...s })) }
    this.setData({ plans })
    api.admin({ action: 'reorder_stops', openid: this.data.openid, ids: stops.map((s) => s.id) }).catch(() => {
      wx.showToast({ title: '排序未保存', icon: 'none' })
    })
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
    const hotel = plan.hotel
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
    this.setData({
      stopSheet: {
        show: true, id: stop.id, name: stop.name, address: stop.address || '',
        note: stop.note || '', plannedTime: stop.plannedTime || '',
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
      if (opt.tolls > 0) ex.push('过路费约 ¥' + opt.tolls)
      if (opt.lights > 0) ex.push('红绿灯 ' + opt.lights + ' 个')
      m.extra = ex.join(' · ')
    } else if (key === 'transit') {
      const ex = []
      if (opt.cost > 0) ex.push('约 ¥' + opt.cost)
      if (opt.walkingDistance > 0) ex.push('步行 ' + distTxt(opt.walkingDistance))
      m.extra = ex.join(' · ')
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
    const hotel = (plan && plan.hotel) || {}
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
