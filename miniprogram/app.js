const api = require('./utils/api')

App({
  globalData: {
    apiBase: 'https://ql.hlat.xyz/api',
    title: 'Map of Us',
    subtitle: '我们的地图 · 一起走过的路',
    cart: {},
    aiEnabled: false,
    user: null,
    networkType: 'unknown',
    networkWeak: false,
  },

  onLaunch() {
    const user = wx.getStorageSync('user')
    if (user && user.openid) this.globalData.user = user
    // AI 开关：始终以服务器为准，默认关闭。后台一关，小程序立即隐藏所有 AI 入口。
    setTimeout(() => {
      api.admin({ action: 'get_config' }).then((cfg) => {
        const enabled = cfg.aiEnabled === true
        this.globalData.aiEnabled = enabled
        // 通知当前活跃页面同步最新开关
        const pages = getCurrentPages()
        const cur = pages && pages[pages.length - 1]
        if (cur && typeof cur.setData === 'function' && ('aiEnabled' in cur.data)) {
          cur.setData({ aiEnabled: enabled })
        }
      }).catch(() => {})
    }, 0)
    this.watchNetwork()
    // 全局未捕获错误监听
    wx.onError && wx.onError((msg) => {
      // 静默，不打扰用户，仅记录
      try { wx.setStorageSync('last_error', String(msg).slice(0, 200)) } catch(e) {}
    })
  },

  // 页面 onShow 里调此方法：先用已知值立即渲染，再静默拉服务器最新值，有变化就更新页面。
  // 这样后台改了开关，用户切个页面即可生效，无需重新发布小程序。
  syncAiEnabled(page) {
    if (!page || typeof page.setData !== 'function') return
    // 1. 立即用当前已知值渲染
    page.setData({ aiEnabled: this.globalData.aiEnabled })
    // 2. 静默向服务器确认最新值
    api.admin({ action: 'get_config' }).then((cfg) => {
      const enabled = cfg.aiEnabled === true
      this.globalData.aiEnabled = enabled
      // 仅当与页面当前值不一致时才再次 setData，避免无谓刷新
      if (page.data && page.data.aiEnabled !== enabled) {
        page.setData({ aiEnabled: enabled })
      }
    }).catch(() => {})
  },

  // 监听网络状态：离线/弱网（2g）时提示，恢复时提示
  refreshAiEnabled() {
    return api.admin({ action: 'get_config' }).then((cfg) => {
      const enabled = cfg.aiEnabled === true
      this.globalData.aiEnabled = enabled
      return enabled
    }).catch(() => this.globalData.aiEnabled)
  },

  watchNetwork() {
    wx.getNetworkType({
      success: (r) => this.applyNetwork(r.networkType, true),
    })
    wx.onNetworkStatusChange((r) => this.applyNetwork(r.networkType, r.isConnected))
  },

  applyNetwork(type, connected) {
    const weak = !connected || type === 'none' || type === '2g'
    const was = this.globalData.networkWeak
    this.globalData.networkType = type
    this.globalData.networkWeak = weak
    if (weak && !was) {
      wx.showToast({
        title: type === 'none' || !connected ? '网络已断开' : '当前网络较弱',
        icon: 'none',
        duration: 2000,
      })
    } else if (!weak && was) {
      wx.showToast({ title: '网络已恢复', icon: 'none', duration: 1500 })
    }
  },

  // 微信快捷登录：wx.login 取 code → 后端 code2session 换 openid
  login(profile = {}) {
    return new Promise((resolve, reject) => {
      wx.login({
        success: ({ code }) => {
          if (!code) return reject(new Error('no code'))
          api
            .wxAuth({ code, ...profile })
            .then((user) => {
              this.globalData.user = user
              wx.setStorageSync('user', user)
              this.refreshAiEnabled()
              resolve(user)
            })
            .catch(reject)
        },
        fail: reject,
      })
    })
  },

  getUser() {
    return this.globalData.user
  },
})
