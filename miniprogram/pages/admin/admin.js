const app = getApp()
const api = require('../../utils/api')
const { TONE_LIST, anniversaryCount, prettyDate } = require('../../utils/util')

const SPICY = ['不辣', '微辣', '中辣', '重辣']
const STATUS_FLOW = [
  { key: 'pending', label: '待处理' },
  { key: 'accepted', label: '已接单' },
  { key: 'done', label: '已完成' },
  { key: 'canceled', label: '已取消' },
]

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

Page({
  data: {
    tab: 'todo',
    openid: '',
    ready: false,
    notAdmin: false,
    isAdmin: false,

    categories: [],
    dishes: [],
    activeCat: 0, // 当前筛选的分类 id（0 = 全部）
    catName: {}, // id -> name
    filteredDishes: [],

    orders: [],
    ordersLoaded: false,
    todoIssues: [],
    todoGroups: [],
    todoSummary: { total: 0, journeys: 0, stops: 0 },
    todoLoaded: false,

    // 足迹 / 城市
    journeys: [],
    journeysLoaded: false,
    // 纪念日
    anniversaries: [],
    anniLoaded: false,

    toneList: TONE_LIST,

    spicyOptions: SPICY,
    statusFlow: STATUS_FLOW,

    // 足迹编辑器
    journeyEditor: {
      show: false, id: '', city: '', province: '', date: '', season: '', weather: '',
      landmark: '', title: '', intro: '', toneIndex: 0, coverTone: TONE_LIST[0],
      latitude: '', longitude: '', tagsText: '', notesText: '', geoLoading: false,
    },
    // 纪念日编辑器
    anniEditor: { show: false, id: '', label: '', date: '', city: '', repeatYearly: false },

    // 分类编辑器
    catEditor: { show: false, id: 0, name: '' },
    // 菜品编辑器
    dishEditor: {
      show: false,
      id: 0,
      categoryId: 0,
      catIndex: 0,
      name: '',
      description: '',
      price: '',
      recommended: false,
      spicy: 0,
      portion: '',
      imageUrl: '',
      uploading: false,
    },
  },

  async onLoad() {
    const user = app.getUser()
    if (!user || !user.openid) {
      this.setData({ notAdmin: true, ready: true })
      return
    }
    this.setData({ openid: user.openid })
    let isAdmin = !!user.isAdmin
    try {
      const r = await api.admin({ action: 'check_admin', openid: user.openid })
      isAdmin = !!r.isAdmin
    } catch (e) {}
    // 情侣双方（已登录用户）均可编辑，默认进「待补」
    this.setData({ isAdmin, canEdit: true, tab: 'todo', ready: true })
    this.loadTodo()
  },

  onPullDownRefresh() {
    const done = () => wx.stopPullDownRefresh()
    const t = this.data.tab
    if (t === 'todo') this.loadTodo().then(done, done)
    else if (t === 'orders') this.loadOrders().then(done, done)
    else if (t === 'journeys') this.loadJourneys().then(done, done)
    else if (t === 'anniversaries') this.loadAnniversaries().then(done, done)
    else this.loadOverview().then(done, done)
  },

  switchTab(e) {
    const tab = e.currentTarget.dataset.tab
    if (tab === this.data.tab) return
    wx.vibrateShort && wx.vibrateShort({ type: 'light' })
    this.setData({ tab })
    if (tab === 'orders' && !this.data.ordersLoaded) this.loadOrders()
    if (tab === 'todo' && !this.data.todoLoaded) this.loadTodo()
    if (tab === 'journeys' && !this.data.journeysLoaded) this.loadJourneys()
    if (tab === 'anniversaries' && !this.data.anniLoaded) this.loadAnniversaries()
    if ((tab === 'dishes' || tab === 'categories') && !this.data.overviewLoaded) this.loadOverview()
  },

  /* ---------------- 读取 ---------------- */
  async loadTodo() {
    try {
      const [journeyData, planData] = await Promise.all([
        api.admin({ action: 'admin_journeys', openid: this.data.openid }),
        api.admin({ action: 'admin_plans', openid: this.data.openid }),
      ])
      const issues = []
      ;(journeyData.journeys || []).forEach((j) => {
        const miss = []
        if (!validCoord(j.latitude, j.longitude)) miss.push('坐标')
        if (!(j.photos || []).length) miss.push('照片')
        if (miss.length) issues.push({ type: '足迹', title: j.city || j.title || '未命名足迹', desc: '缺 ' + miss.join(' / ') })
      })
      ;(planData.plans || []).forEach((p) => {
        ;(p.stops || []).forEach((s) => {
          const miss = []
          if (!s.address) miss.push('地址')
          if (!validCoord(s.latitude, s.longitude)) miss.push('坐标')
          if (!s.openHours) miss.push('营业')
          if (!s.ticket) miss.push('门票')
          if (miss.length) issues.push({ type: '行程', title: s.name || '未命名地点', desc: `${p.title || '未命名行程'} · 缺 ${miss.join(' / ')}` })
        })
      })
      const keyed = issues.map((it, i) => ({ ...it, key: `${it.type}_${i}` }))
      const groups = [
        { key: 'journeys', title: '足迹', items: keyed.filter((x) => x.type === '足迹') },
        { key: 'stops', title: '行程地点', items: keyed.filter((x) => x.type === '行程') },
      ].filter((g) => g.items.length)
      this.setData({
        todoIssues: keyed,
        todoGroups: groups,
        todoSummary: {
          total: issues.length,
          journeys: issues.filter((x) => x.type === '足迹').length,
          stops: issues.filter((x) => x.type === '行程').length,
        },
        todoLoaded: true,
      })
    } catch (e) {
      wx.showToast({ title: '待补数据加载失败', icon: 'none' })
    }
  },

  async loadOverview() {
    try {
      const data = await api.admin({ action: 'overview', openid: this.data.openid })
      const categories = data.categories || []
      const dishes = data.dishes || []
      const catName = {}
      categories.forEach((c) => (catName[c.id] = c.name))
      const activeCat = this.data.activeCat || (categories[0] && categories[0].id) || 0
      this.setData({ categories, dishes, catName, ready: true, overviewLoaded: true, activeCat }, () => this.applyFilter())
    } catch (e) {
      this.setData({ ready: true })
      if (e && e.statusCode === 403) this.setData({ notAdmin: true })
      else wx.showToast({ title: '加载失败', icon: 'none' })
    }
  },

  async loadOrders() {
    try {
      const data = await api.admin({ action: 'orders', openid: this.data.openid })
      const orders = (data.orders || []).map((o) => ({
        ...o,
        dateShort: this.fmtDate(o.createdAt),
        summary: o.items.map((it) => `${it.name}×${it.qty}`).join('、'),
      }))
      this.setData({ orders, ordersLoaded: true })
    } catch (e) {
      wx.showToast({ title: '订单加载失败', icon: 'none' })
    }
  },

  applyFilter() {
    const { dishes, activeCat } = this.data
    const filtered = activeCat ? dishes.filter((d) => d.categoryId === activeCat) : dishes
    const withMeta = filtered.map((d) => ({ ...d, spicyText: SPICY[d.spicy] || '' }))
    this.setData({ filteredDishes: withMeta })
  },

  pickCat(e) {
    const id = e.currentTarget.dataset.id
    this.setData({ activeCat: id }, () => this.applyFilter())
  },

  fmtDate(s) {
    if (!s) return ''
    const m = String(s).match(/(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})/)
    return m ? `${m[2]}.${m[3]} ${m[4]}:${m[5]}` : s
  },

  async act(payload, okMsg) {
    wx.showLoading({ title: '处理中', mask: true })
    try {
      const res = await api.admin({ ...payload, openid: this.data.openid })
      wx.hideLoading()
      if (okMsg) wx.showToast({ title: okMsg, icon: 'success' })
      return res
    } catch (e) {
      wx.hideLoading()
      wx.showToast({ title: (e && e.data && e.data.message) || '操作失败', icon: 'none' })
      throw e
    }
  },

  /* ---------------- 分类 ---------------- */
  openCatEditor(e) {
    const id = (e.currentTarget.dataset.id && Number(e.currentTarget.dataset.id)) || 0
    const cat = this.data.categories.find((c) => c.id === id)
    this.setData({ catEditor: { show: true, id, name: cat ? cat.name : '' } })
  },
  closeCatEditor() {
    this.setData({ ['catEditor.show']: false })
  },
  onCatName(e) {
    this.setData({ ['catEditor.name']: e.detail.value })
  },
  async saveCat() {
    const { id, name } = this.data.catEditor
    if (!name.trim()) return wx.showToast({ title: '请输入分类名', icon: 'none' })
    const action = id ? 'update_category' : 'add_category'
    await this.act({ action, id, name: name.trim() }, '已保存')
    this.setData({ ['catEditor.show']: false })
    await this.loadOverview()
  },
  async toggleCat(e) {
    const id = e.currentTarget.dataset.id
    await this.act({ action: 'toggle_category', id })
    await this.loadOverview()
  },
  delCat(e) {
    const id = e.currentTarget.dataset.id
    wx.showModal({
      title: '删除分类',
      content: '确定删除该分类？（分类下有菜品时无法删除）',
      confirmColor: '#1b1712',
      success: async (r) => {
        if (!r.confirm) return
        await this.act({ action: 'del_category', id }, '已删除')
        await this.loadOverview()
      },
    })
  },
  moveCat(e) {
    const { id, dir } = e.currentTarget.dataset
    this.reorder('categories', Number(id), Number(dir))
  },

  /* ---------------- 菜品 ---------------- */
  openDishEditor(e) {
    const id = (e.currentTarget.dataset.id && Number(e.currentTarget.dataset.id)) || 0
    const cats = this.data.categories
    let d = {
      show: true,
      id: 0,
      categoryId: this.data.activeCat || (cats[0] && cats[0].id) || 0,
      name: '',
      description: '',
      price: '',
      recommended: false,
      spicy: 0,
      portion: '',
      imageUrl: '',
      uploading: false,
    }
    if (id) {
      const src = this.data.dishes.find((x) => x.id === id)
      if (src) {
        d = {
          show: true,
          id: src.id,
          categoryId: src.categoryId,
          name: src.name,
          description: src.description,
          price: src.price ? String(src.price) : '',
          recommended: src.recommended,
          spicy: src.spicy,
          portion: src.portion,
          imageUrl: src.imageUrl,
          uploading: false,
        }
      }
    }
    d.catIndex = Math.max(0, cats.findIndex((c) => c.id === d.categoryId))
    this.setData({ dishEditor: d })
  },
  closeDishEditor() {
    this.setData({ ['dishEditor.show']: false })
  },
  onDishField(e) {
    const f = e.currentTarget.dataset.f
    this.setData({ [`dishEditor.${f}`]: e.detail.value })
  },
  onDishCat(e) {
    const idx = Number(e.detail.value)
    const cat = this.data.categories[idx]
    this.setData({ ['dishEditor.catIndex']: idx, ['dishEditor.categoryId']: cat ? cat.id : 0 })
  },
  onDishSpicy(e) {
    this.setData({ ['dishEditor.spicy']: Number(e.detail.value) })
  },
  onDishRec(e) {
    this.setData({ ['dishEditor.recommended']: e.detail.value })
  },
  chooseImage() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sizeType: ['compressed'],
      success: async (res) => {
        const file = res.tempFiles[0]
        if (!file) return
        this.setData({ ['dishEditor.uploading']: true })
        wx.showLoading({ title: '上传中', mask: true })
        try {
          const { imageUrl } = await api.uploadDishImage(file.tempFilePath, this.data.openid)
          this.setData({ ['dishEditor.imageUrl']: imageUrl, ['dishEditor.uploading']: false })
          wx.hideLoading()
        } catch (e) {
          this.setData({ ['dishEditor.uploading']: false })
          wx.hideLoading()
          wx.showToast({ title: '上传失败', icon: 'none' })
        }
      },
    })
  },
  removeImage() {
    this.setData({ ['dishEditor.imageUrl']: '' })
  },
  async saveDish() {
    const d = this.data.dishEditor
    if (!d.name.trim()) return wx.showToast({ title: '请输入菜名', icon: 'none' })
    if (!d.categoryId) return wx.showToast({ title: '请选择分类', icon: 'none' })
    const payload = {
      action: d.id ? 'update_dish' : 'add_dish',
      id: d.id,
      categoryId: d.categoryId,
      name: d.name.trim(),
      description: d.description.trim(),
      price: Number(d.price) || 0,
      recommended: d.recommended ? 1 : 0,
      spicy: d.spicy,
      portion: d.portion.trim(),
      imageUrl: d.imageUrl,
    }
    await this.act(payload, '已保存')
    this.setData({ ['dishEditor.show']: false })
    await this.loadOverview()
  },
  async toggleDish(e) {
    const id = e.currentTarget.dataset.id
    await this.act({ action: 'toggle_dish', id })
    await this.loadOverview()
  },
  delDish(e) {
    const id = e.currentTarget.dataset.id
    wx.showModal({
      title: '删除菜品',
      content: '确定删除这道菜？此操作不可恢复。',
      confirmColor: '#1b1712',
      success: async (r) => {
        if (!r.confirm) return
        await this.act({ action: 'del_dish', id }, '已删除')
        await this.loadOverview()
      },
    })
  },
  moveDish(e) {
    const { id, dir } = e.currentTarget.dataset
    this.reorder('dishes', Number(id), Number(dir))
  },

  // 通用上下移：在当前可见列表里交换相邻项，提交新顺序
  async reorder(kind, id, dir) {
    const list = kind === 'categories' ? this.data.categories.slice() : this.data.filteredDishes.slice()
    const idx = list.findIndex((x) => x.id === id)
    const target = idx + dir
    if (idx < 0 || target < 0 || target >= list.length) return
    const tmp = list[idx]
    list[idx] = list[target]
    list[target] = tmp
    const ids = list.map((x) => x.id)
    wx.vibrateShort && wx.vibrateShort({ type: 'light' })
    await this.act({ action: kind === 'categories' ? 'reorder_categories' : 'reorder_dishes', ids })
    await this.loadOverview()
  },

  /* ---------------- 订单 ---------------- */
  changeStatus(e) {
    const id = e.currentTarget.dataset.id
    const items = STATUS_FLOW.map((s) => s.label)
    wx.showActionSheet({
      itemList: items,
      success: async (r) => {
        const status = STATUS_FLOW[r.tapIndex].key
        await this.act({ action: 'set_order_status', id, status }, '已更新')
        await this.loadOrders()
      },
    })
  },

  /* ---------------- 足迹 / 城市 ---------------- */
  async loadJourneys() {
    try {
      const data = await api.admin({ action: 'admin_journeys', openid: this.data.openid })
      const journeys = (data.journeys || []).map((j) => ({
        ...j,
        dateText: prettyDate(String(j.date).replace(/-/g, '.')),
        tagsText: (j.tags || []).join(' · '),
        hasGeo: !!validCoord(j.latitude, j.longitude),
      }))
      this.setData({ journeys, journeysLoaded: true })
    } catch (e) {
      wx.showToast({ title: '足迹加载失败', icon: 'none' })
    }
  },
  openJourneyEditor(e) {
    const id = e.currentTarget.dataset.id || ''
    const src = id ? this.data.journeys.find((x) => x.id === id) : null
    const tone = src ? src.coverTone : TONE_LIST[0]
    const coord = src ? validCoord(src.latitude, src.longitude) : null
    this.setData({
      journeyEditor: {
        show: true,
        id,
        city: src ? src.city : '',
        province: src ? src.province : '',
        date: src ? String(src.date).slice(0, 10).replace(/\./g, '-') : '',
        season: src ? src.season : '',
        weather: src ? src.weather : '',
        landmark: src ? src.landmark : '',
        title: src ? src.title : '',
        intro: src ? src.intro : '',
        toneIndex: Math.max(0, TONE_LIST.indexOf(tone)),
        coverTone: tone,
        latitude: coord ? String(coord.latitude) : '',
        longitude: coord ? String(coord.longitude) : '',
        tagsText: src ? (src.tags || []).join('，') : '',
        notesText: src ? (src.notes || []).join('\n') : '',
        photos: src ? (src.photos || []) : [],
        pendingPhotos: [],
        geoLoading: false,
        locating: false,
        uploading: false,
      },
    })
  },
  // 用设备当前定位一键填坐标，并尝试逆地理编码补全省/市
  locateJourneyHere() {
    if (this.data.journeyEditor.locating) return
    this.setData({ ['journeyEditor.locating']: true })
    wx.getLocation({
      type: 'gcj02',
      success: async (r) => {
        const patch = {
          ['journeyEditor.longitude']: String(r.longitude),
          ['journeyEditor.latitude']: String(r.latitude),
        }
        try {
          const g = await api.admin({ action: 'regeo', openid: this.data.openid, longitude: r.longitude, latitude: r.latitude })
          if (g && g.province && !this.data.journeyEditor.province) patch['journeyEditor.province'] = g.province
          if (g && g.city && !this.data.journeyEditor.city) patch['journeyEditor.city'] = g.city
        } catch (e) {
          /* 未部署 regeo 或失败：坐标已填，省/市保持手填 */
        }
        try {
          const w = await api.admin({ action: 'weather', openid: this.data.openid, longitude: r.longitude, latitude: r.latitude })
          const today = (w.casts || [])[0] || null
          if (today && today.dayWeather && !this.data.journeyEditor.weather) patch['journeyEditor.weather'] = today.dayWeather
        } catch (e) {
          /* 天气可选，失败不影响定位填充 */
        }
        if (!this.data.journeyEditor.season) patch['journeyEditor.season'] = seasonFromDate(this.data.journeyEditor.date || new Date().toISOString().slice(0, 10))
        patch['journeyEditor.locating'] = false
        this.setData(patch)
        wx.vibrateShort && wx.vibrateShort({ type: 'light' })
        wx.showToast({ title: '地点和天气都填好了', icon: 'none' })
      },
      fail: () => {
        this.setData({ ['journeyEditor.locating']: false })
        wx.showToast({ title: '定位失败，请允许定位权限', icon: 'none' })
      },
    })
  },
  async chooseJourneyPhoto() {
    const ed = this.data.journeyEditor
    // 新足迹（尚未保存）：一次可多选，先暂存本地预览，保存时一并上传
    if (!ed.id) {
      wx.chooseMedia({
        count: 9,
        mediaType: ['image'],
        sizeType: ['compressed'],
        success: (res) => {
          const paths = (res.tempFiles || []).map((f) => f.tempFilePath).filter(Boolean)
          if (!paths.length) return
          const pending = (this.data.journeyEditor.pendingPhotos || []).concat(paths)
          this.setData({ ['journeyEditor.pendingPhotos']: pending })
          wx.showToast({ title: `已放入 ${paths.length} 张照片`, icon: 'none' })
        },
      })
      return
    }
    wx.chooseMedia({
      count: 9,
      mediaType: ['image'],
      sizeType: ['compressed'],
      success: async (res) => {
        const paths = (res.tempFiles || []).map((f) => f.tempFilePath).filter(Boolean)
        if (!paths.length) return
        this.setData({ ['journeyEditor.uploading']: true })
        let done = 0
        wx.showLoading({ title: `正在收藏 0/${paths.length}`, mask: true })
        for (const fp of paths) {
          try {
            await this.uploadOneJourneyPhoto(fp, ed)
          } catch (e) {
            /* 单张失败不阻塞其余 */
          }
          done += 1
          wx.showLoading({ title: `正在收藏 ${done}/${paths.length}`, mask: true })
        }
        try {
          await this.loadJourneys()
          const fresh = this.data.journeys.find((x) => x.id === ed.id)
          this.setData({ ['journeyEditor.photos']: fresh ? fresh.photos || [] : [], ['journeyEditor.uploading']: false })
        } catch (e) {
          this.setData({ ['journeyEditor.uploading']: false })
        }
        wx.hideLoading()
      },
    })
  },
  async uploadOneJourneyPhoto(tempFilePath, ed) {
    const { imageUrl } = await api.uploadDishImage(tempFilePath, this.data.openid)
    await api.admin({
      action: 'add_journey_photo',
      openid: this.data.openid,
      journeyId: ed.id,
      imageUrl,
      title: ed.city || '',
      subtitle: ed.title || '',
      tone: ed.coverTone || 'tone-ink',
    })
  },
  delPendingPhoto(e) {
    const i = Number(e.currentTarget.dataset.index)
    const pending = (this.data.journeyEditor.pendingPhotos || []).slice()
    pending.splice(i, 1)
    this.setData({ ['journeyEditor.pendingPhotos']: pending })
  },
  delJourneyPhoto(e) {
    const id = e.currentTarget.dataset.id
    const jid = this.data.journeyEditor.id
    wx.showModal({
      title: '删除这张照片',
      content: '确定删除吗？',
      success: async (r) => {
        if (!r.confirm) return
        try {
          await api.admin({ action: 'del_journey_photo', openid: this.data.openid, id })
          await this.loadJourneys()
          const fresh = this.data.journeys.find((x) => x.id === jid)
          this.setData({ ['journeyEditor.photos']: fresh ? fresh.photos || [] : [] })
        } catch (err) {
          wx.showToast({ title: '删除失败', icon: 'none' })
        }
      },
    })
  },
  closeJourneyEditor() {
    this.setData({ ['journeyEditor.show']: false })
  },
  onJourneyField(e) {
    const f = e.currentTarget.dataset.f
    this.setData({ [`journeyEditor.${f}`]: e.detail.value })
  },
  onJourneyDate(e) {
    this.setData({ ['journeyEditor.date']: e.detail.value })
  },
  pickJourneyTone(e) {
    const i = e.currentTarget.dataset.index
    this.setData({ ['journeyEditor.toneIndex']: i, ['journeyEditor.coverTone']: this.data.toneList[i] })
  },
  async geocodeJourney() {
    const ed = this.data.journeyEditor
    const addr = [ed.province, ed.city, ed.landmark].filter(Boolean).join('') || ed.city
    if (!addr) return wx.showToast({ title: '先填城市或地标', icon: 'none' })
    this.setData({ ['journeyEditor.geoLoading']: true })
    try {
      const r = await api.admin({ action: 'geo', openid: this.data.openid, address: addr, city: ed.city })
      const coord = r ? validCoord(r.latitude, r.longitude) : null
      if (coord) {
        this.setData({
          ['journeyEditor.longitude']: String(coord.longitude),
          ['journeyEditor.latitude']: String(coord.latitude),
          ['journeyEditor.geoLoading']: false,
        })
        wx.showToast({ title: '已定位', icon: 'success' })
      } else {
        this.setData({ ['journeyEditor.geoLoading']: false })
        wx.showToast({ title: '未找到该地点', icon: 'none' })
      }
    } catch (err) {
      this.setData({ ['journeyEditor.geoLoading']: false })
      wx.showToast({ title: '定位失败', icon: 'none' })
    }
  },
  async saveJourney() {
    const ed = this.data.journeyEditor
    if (!ed.city.trim() || !ed.province.trim()) return wx.showToast({ title: '城市与省份必填', icon: 'none' })
    const tags = ed.tagsText.split(/[，,\n]/).map((s) => s.trim()).filter(Boolean)
    const notes = ed.notesText.split(/\n+/).map((s) => s.trim()).filter(Boolean)
    const coord = validCoord(ed.latitude, ed.longitude)
    const payload = {
      action: ed.id ? 'update_journey' : 'add_journey',
      city: ed.city.trim(),
      province: ed.province.trim(),
      date: ed.date || '',
      season: ed.season.trim(),
      weather: ed.weather.trim(),
      landmark: ed.landmark.trim(),
      title: ed.title.trim(),
      intro: ed.intro.trim(),
      coverTone: ed.coverTone,
      latitude: coord ? coord.latitude : '',
      longitude: coord ? coord.longitude : '',
      tags,
      notes,
    }
    if (ed.id) payload.id = ed.id
    const res = await this.act(payload, '已保存')
    const pending = ed.pendingPhotos || []
    if (!ed.id && res && res.id && pending.length) {
      wx.showLoading({ title: `收藏照片 0/${pending.length}`, mask: true })
      const newEd = { ...ed, id: res.id }
      let done = 0
      for (const fp of pending) {
        try {
          await this.uploadOneJourneyPhoto(fp, newEd)
        } catch (e) {
          /* 单张失败不阻塞其余 */
        }
        done += 1
        wx.showLoading({ title: `收藏照片 ${done}/${pending.length}`, mask: true })
      }
      wx.hideLoading()
    }
    this.setData({ ['journeyEditor.show']: false, ['journeyEditor.pendingPhotos']: [] })
    await this.loadJourneys()
  },
  async toggleJourney(e) {
    await this.act({ action: 'toggle_journey', id: e.currentTarget.dataset.id })
    await this.loadJourneys()
  },
  delJourney(e) {
    const id = e.currentTarget.dataset.id
    wx.showModal({
      title: '删除足迹', content: '确定删除这座城市及其照片/手记吗？', confirmColor: '#1b1712',
      success: async (r) => {
        if (!r.confirm) return
        await this.act({ action: 'del_journey', id }, '已删除')
        await this.loadJourneys()
      },
    })
  },
  async moveJourney(e) {
    const { id, dir } = e.currentTarget.dataset
    const list = this.data.journeys.slice()
    const idx = list.findIndex((x) => x.id === id)
    const target = idx + Number(dir)
    if (idx < 0 || target < 0 || target >= list.length) return
    ;[list[idx], list[target]] = [list[target], list[idx]]
    wx.vibrateShort && wx.vibrateShort({ type: 'light' })
    await this.act({ action: 'reorder_journeys', ids: list.map((x) => x.id) })
    await this.loadJourneys()
  },

  /* ---------------- 纪念日 ---------------- */
  async loadAnniversaries() {
    try {
      const data = await api.admin({ action: 'admin_anniversaries', openid: this.data.openid })
      const anniversaries = (data.anniversaries || []).map((a) => {
        const dotted = String(a.date).slice(0, 10).replace(/-/g, '.')
        const c = anniversaryCount(dotted, a.repeatYearly)
        return { ...a, dateText: prettyDate(dotted), countText: c.text, countKind: c.kind }
      })
      this.setData({ anniversaries, anniLoaded: true })
    } catch (e) {
      wx.showToast({ title: '纪念日加载失败', icon: 'none' })
    }
  },
  openAnniEditor(e) {
    const id = e.currentTarget.dataset.id || ''
    const src = id ? this.data.anniversaries.find((x) => x.id === id) : null
    this.setData({
      anniEditor: {
        show: true,
        id,
        label: src ? src.label : '',
        date: src ? String(src.date).slice(0, 10).replace(/\./g, '-') : '',
        city: src ? src.city : '',
        repeatYearly: src ? !!src.repeatYearly : false,
      },
    })
  },
  closeAnniEditor() {
    this.setData({ ['anniEditor.show']: false })
  },
  onAnniField(e) {
    const f = e.currentTarget.dataset.f
    this.setData({ [`anniEditor.${f}`]: e.detail.value })
  },
  onAnniDate(e) {
    this.setData({ ['anniEditor.date']: e.detail.value })
  },
  onAnniRepeat(e) {
    this.setData({ ['anniEditor.repeatYearly']: e.detail.value })
  },
  async saveAnni() {
    const ed = this.data.anniEditor
    if (!ed.label.trim()) return wx.showToast({ title: '请填写名称', icon: 'none' })
    if (!ed.date) return wx.showToast({ title: '请选择日期', icon: 'none' })
    const payload = {
      action: ed.id ? 'update_anniversary' : 'add_anniversary',
      label: ed.label.trim(),
      date: ed.date,
      city: ed.city.trim(),
      repeatYearly: ed.repeatYearly ? 1 : 0,
    }
    if (ed.id) payload.id = ed.id
    await this.act(payload, '已保存')
    this.setData({ ['anniEditor.show']: false })
    await this.loadAnniversaries()
  },
  delAnni(e) {
    const id = e.currentTarget.dataset.id
    wx.showModal({
      title: '删除纪念日', content: '确定删除这个纪念日吗？', confirmColor: '#1b1712',
      success: async (r) => {
        if (!r.confirm) return
        await this.act({ action: 'del_anniversary', id }, '已删除')
        await this.loadAnniversaries()
      },
    })
  },
  async moveAnni(e) {
    const { id, dir } = e.currentTarget.dataset
    const list = this.data.anniversaries.slice()
    const idx = list.findIndex((x) => x.id === id)
    const target = idx + Number(dir)
    if (idx < 0 || target < 0 || target >= list.length) return
    ;[list[idx], list[target]] = [list[target], list[idx]]
    wx.vibrateShort && wx.vibrateShort({ type: 'light' })
    await this.act({ action: 'reorder_anniversaries', ids: list.map((x) => x.id) })
    await this.loadAnniversaries()
  },

  goLogin() {
    wx.switchTab({ url: '/pages/mine/mine' })
  },
})
