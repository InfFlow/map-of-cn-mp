Component({
  data: {
    selected: 0,
    pressed: -1,
    hidden: false,
    cartCount: 0,
    list: [
      { page: '/pages/index/index', text: '地图', key: 'index' },
      { page: '/pages/timeline/timeline', text: '足迹', key: 'timeline' },
      { page: '/pages/plans/plans', text: '行程', key: 'plans' },
      { page: '/pages/menu/menu', text: '菜单', key: 'menu' },
      { page: '/pages/mine/mine', text: '我们', key: 'mine' },
    ],
  },
  lifetimes: {
    attached() {
      this.updateCart()
    },
  },
  methods: {
    // 从全局购物车计算角标数量
    updateCart() {
      const cart = (getApp() && getApp().globalData && getApp().globalData.cart) || {}
      let n = 0
      Object.keys(cart).forEach((k) => {
        n += (cart[k] && cart[k].qty) || 0
      })
      if (n !== this.data.cartCount) this.setData({ cartCount: n })
    },
    onTap(e) {
      const index = e.currentTarget.dataset.index
      const target = this.data.list[index]
      if (!target) return
      this.setData({ pressed: index })
      setTimeout(() => this.setData({ pressed: -1 }), 180)
      if (wx.vibrateShort) wx.vibrateShort({ type: 'light' })
      wx.switchTab({ url: target.page })
    },
  },
})
