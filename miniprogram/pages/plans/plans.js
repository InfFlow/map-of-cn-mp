const app = getApp()
const api = require('../../utils/api')
const { toneGradient, TONE_LIST } = require('../../utils/util')

const ROW_RPX = 176 // 拖动列表每行槽位高度（含间距）
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

    toneList: TONE_LIST,
    toneSwatches: TONE_LIST.map((t) => ({ tone: t, grad: toneGradient(t) })),
    rowH: 88, // px，onLoad 计算
    areaH: 0,
    dragId: 0,

    // 地图可视化
    mapMarkers: [],
    mapPolyline: [],
    mapInclude: [],
    mapCenter: { latitude: 34.5, longitude: 110 },
    geoStopCount: 0,
    // 按天分组
    multiDay: false,
    dayGroups: [],
    // 预算汇总（按分类）
    budgetBars: [],

    legs: {}, // `${fromId}_${toId}` -> { loading, open, recommend, opt, steps }

    expCats: EXP_CATS,
    expenses: [],
    expenseTotal: 0,
    expenseEditor: { show: false, catIndex: 0, amount: '', memo: '' },

    planEditor: { show: false, mode: 'add', id: '', title: '', toneIndex: 0, coverTone: TONE_LIST[0], planDate: '', note: '' },
    stopEditor: {
      show: false, mode: 'add', id: 0, planId: '',
      name: '', address: '', plannedTime: '', note: '', day: 1,
      latitude: '', longitude: '', geoLoading: false,
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
      this.getTabBar().setData({ selected: 2 })
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
      plans = plans.map((p) => ({
        ...p,
        coverGrad: toneGradient(p.coverTone),
        planDateText: toDotted(p.planDate),
        planDateISO: toISO(p.planDate),
        stops: (p.stops || []).map((s) => ({ ...s })),
      }))
      const activeIndex = Math.min(this.data.activeIndex, Math.max(plans.length - 1, 0))
      this.setData({ plans, activeIndex, loading: false, ready: true, legs: {} })
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
        mapMarkers: [], mapPolyline: [], mapInclude: [], geoStopCount: 0,
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

    // 按天分组
    const dayMap = {}
    stops.forEach((s) => { (dayMap[s.day] = dayMap[s.day] || []).push(s) })
    const dayGroups = Object.keys(dayMap)
      .map(Number)
      .sort((a, b) => a - b)
      .map((d) => ({ day: d, label: '第 ' + d + ' 天', stops: dayMap[d] }))

    this.setData({
      active, areaH: stops.length * this.data.rowH,
      mapMarkers, mapPolyline, mapInclude, mapCenter, geoStopCount: geo.length,
      multiDay, dayGroups,
    })
    this.loadExpenses()
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

  openExpenseAdd() {
    this.setData({ expenseEditor: { show: true, catIndex: 0, amount: '', memo: '' } })
  },
  closeExpenseEditor() {
    this.setData({ 'expenseEditor.show': false })
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
    this.setData({ activeIndex: i, legs: {} })
    this.applyActive()
  },

  /* ---------------- 计划 CRUD ---------------- */
  openPlanAdd() {
    this.setData({
      planEditor: { show: true, mode: 'add', id: '', title: '', toneIndex: 0, coverTone: this.data.toneList[0], planDate: '', note: '' },
    })
  },
  openPlanEdit() {
    const p = this.data.active
    if (!p) return
    const toneIndex = Math.max(0, this.data.toneList.indexOf(p.coverTone))
    this.setData({
      planEditor: { show: true, mode: 'edit', id: p.id, title: p.title, toneIndex, coverTone: p.coverTone, planDate: p.planDateISO || '', note: p.note || '' },
    })
  },
  closePlanEditor() {
    this.setData({ 'planEditor.show': false })
  },
  onPlanTitle(e) {
    this.setData({ 'planEditor.title': e.detail.value })
  },
  onPlanNote(e) {
    this.setData({ 'planEditor.note': e.detail.value })
  },
  onPlanDate(e) {
    this.setData({ 'planEditor.planDate': e.detail.value })
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
      note: ed.note || '',
    }
    if (ed.mode === 'edit') payload.id = ed.id
    try {
      const r = await api.admin(payload)
      this.setData({ 'planEditor.show': false })
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
      stopEditor: { show: true, mode: 'add', id: 0, planId: p.id, name: '', address: '', plannedTime: '', note: '', day: 1, latitude: '', longitude: '', geoLoading: false },
    })
  },
  openStopEdit(e) {
    const id = e.currentTarget.dataset.id
    const s = this.data.active.stops.find((x) => x.id === id)
    if (!s) return
    this.setData({
      stopEditor: {
        show: true, mode: 'edit', id: s.id, planId: this.data.active.id,
        name: s.name || '', address: s.address || '', plannedTime: s.plannedTime || '', note: s.note || '', day: Number(s.day) || 1,
        latitude: s.latitude == null ? '' : String(s.latitude), longitude: s.longitude == null ? '' : String(s.longitude),
        geoLoading: false,
      },
    })
  },
  closeStopEditor() {
    this.setData({ 'stopEditor.show': false })
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
      day: Number(ed.day) || 1,
      latitude: ed.latitude || '',
      longitude: ed.longitude || '',
    }
    if (ed.mode === 'edit') payload.id = ed.id
    try {
      await api.admin(payload)
      this.setData({ 'stopEditor.show': false })
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
    this.setData({ 'active.stops': stops, dragId: 0 })
    // 同步本地 plans 缓存并持久化排序
    const plans = this.data.plans.slice()
    plans[this.data.activeIndex] = { ...plans[this.data.activeIndex], stops: stops.map((s) => ({ ...s })) }
    this.setData({ plans, legs: {} })
    api.admin({ action: 'reorder_stops', openid: this.data.openid, ids: stops.map((s) => s.id) }).catch(() => {
      wx.showToast({ title: '排序未保存', icon: 'none' })
    })
  },

  /* ---------------- 高德路线 ---------------- */
  async toggleLeg(e) {
    const i = e.currentTarget.dataset.index
    const stops = this.data.active.stops
    const a = stops[i]
    const b = stops[i + 1]
    if (!a || !b) return
    const keyk = `${a.id}_${b.id}`
    const existing = this.data.legs[keyk]
    if (existing && existing.open) {
      this.setData({ [`legs.${keyk}.open`]: false })
      return
    }
    if (existing && existing.recommend) {
      this.setData({ [`legs.${keyk}.open`]: true })
      return
    }
    if (a.longitude == null || a.latitude == null || b.longitude == null || b.latitude == null) {
      wx.showToast({ title: '目的地缺少坐标，先在编辑里定位', icon: 'none' })
      return
    }
    this.setData({ [`legs.${keyk}`]: { loading: true, open: true } })
    try {
      const r = await api.getRoute({
        origin: `${a.longitude},${a.latitude}`,
        destination: `${b.longitude},${b.latitude}`,
      })
      const reco = r.recommend
      const opt = (r.options && r.options[reco]) || {}
      this.setData({
        [`legs.${keyk}`]: {
          loading: false, open: true,
          recommend: reco,
          recoLabel: RECO_LABEL[reco] || '路线',
          distance: opt.distance ? (opt.distance >= 1000 ? (opt.distance / 1000).toFixed(1) + ' 公里' : opt.distance + ' 米') : '',
          duration: opt.duration ? opt.duration + ' 分钟' : '',
          steps: opt.steps || [],
          options: r.options || {},
        },
      })
    } catch (err) {
      this.setData({ [`legs.${keyk}`]: { loading: false, open: true, error: (err && err.data && err.data.message) || '规划失败' } })
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
