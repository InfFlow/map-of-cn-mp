Component({
  data: {
    selected: 0,
    pressed: -1,
    hidden: false,
    list: [
      { page: '/pages/index/index', text: '地图', key: 'index' },
      { page: '/pages/timeline/timeline', text: '时间线', key: 'timeline' },
      { page: '/pages/plans/plans', text: '行程', key: 'plans' },
      { page: '/pages/menu/menu', text: '菜单', key: 'menu' },
      { page: '/pages/mine/mine', text: '我的', key: 'mine' },
    ],
  },
  methods: {
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
