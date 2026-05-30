const app = getApp()
const api = require('../../utils/api')

const SPICY = ['不辣', '微辣', '中辣', '重辣']
const STATUS_FLOW = [
  { key: 'pending', label: '待处理' },
  { key: 'accepted', label: '已接单' },
  { key: 'done', label: '已完成' },
  { key: 'canceled', label: '已取消' },
]

Page({
  data: {
    tab: 'dishes',
    openid: '',
    ready: false,
    notAdmin: false,

    categories: [],
    dishes: [],
    activeCat: 0, // 当前筛选的分类 id（0 = 全部）
    catName: {}, // id -> name
    filteredDishes: [],

    orders: [],
    ordersLoaded: false,

    spicyOptions: SPICY,
    statusFlow: STATUS_FLOW,

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

  onLoad() {
    const user = app.getUser()
    if (!user || !user.openid) {
      this.setData({ notAdmin: true, ready: true })
      return
    }
    this.setData({ openid: user.openid })
    this.loadOverview()
  },

  onPullDownRefresh() {
    const done = () => wx.stopPullDownRefresh()
    if (this.data.tab === 'orders') this.loadOrders().then(done, done)
    else this.loadOverview().then(done, done)
  },

  switchTab(e) {
    const tab = e.currentTarget.dataset.tab
    if (tab === this.data.tab) return
    wx.vibrateShort && wx.vibrateShort({ type: 'light' })
    this.setData({ tab })
    if (tab === 'orders' && !this.data.ordersLoaded) this.loadOrders()
  },

  /* ---------------- 读取 ---------------- */
  async loadOverview() {
    try {
      const data = await api.admin({ action: 'overview', openid: this.data.openid })
      const categories = data.categories || []
      const dishes = data.dishes || []
      const catName = {}
      categories.forEach((c) => (catName[c.id] = c.name))
      const activeCat = this.data.activeCat || (categories[0] && categories[0].id) || 0
      this.setData({ categories, dishes, catName, ready: true, activeCat }, () => this.applyFilter())
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

  goLogin() {
    wx.switchTab({ url: '/pages/mine/mine' })
  },
})
