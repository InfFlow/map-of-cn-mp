const app = getApp()

const ALL_ITEMS = [
  { key: 'dashboard', zh: '数据概览', ico: 'stats', sub: '省 · 城 · 里程 · 趋势 · 标签', url: '/pages/dashboard/dashboard', ai: false },
  { key: 'recap', zh: '旅行回顾', ico: 'recap', sub: '年度回顾 · 集章 · 回忆放映', url: '/pages/recap/recap', ai: false },
  { key: 'footprints', zh: '足迹地图', ico: 'atlas', sub: '去过的点 · 按城市归类', url: '/pages/footprints/footprints', ai: false },
  { key: 'stats', zh: '足迹统计', ico: 'stats', sub: '34省打卡 · 年历 · 消费', url: '/pages/stats/stats', ai: false },
  { key: 'story', zh: '旅行故事', ico: 'recap', sub: '把足迹写成你们的旅行故事', url: '/pages/story/story', ai: true },
  { key: 'search', zh: '搜索回忆', ico: 'atlas', sub: '搜索城市 · 标签 · 手记', url: '/pages/search/search', ai: false },
]

Page({
  data: {
    items: [],
  },

  onLoad() {
    this.applyItems()
  },

  onShow() {
    app.syncAiEnabled && app.syncAiEnabled(this)
    this.applyItems()
  },

  applyItems() {
    const aiOn = app.globalData.aiEnabled
    const items = ALL_ITEMS.filter((it) => !it.ai || aiOn)
    this.setData({ items })
  },

  open(e) {
    const url = e.currentTarget.dataset.url
    if (!url) return
    wx.vibrateShort && wx.vibrateShort({ type: 'light' })
    wx.navigateTo({ url })
  },
})
