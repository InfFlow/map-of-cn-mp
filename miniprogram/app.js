const api = require('./utils/api')

App({
  globalData: {
    // 后端 API 根地址（你的服务器，已带 HTTPS 证书）
    apiBase: 'https://ql.hlat.xyz/api',
    title: 'Map of Us',
    subtitle: '我们的地图 · 一起走过的路',
    // 点菜购物车：{ [dishId]: { id, name, price, qty, remark } }
    cart: {},
    // AI 功能开关：个人主体小程序不允许「深度合成/AI 问答」类目，故默认关闭所有 AI 入口以便过审。
    // 升级为企业主体并补充相应服务类目后，把此处改成 true 即可一键恢复全部 AI 入口。
    aiEnabled: false,
    user: null, // { openid, nickname, avatarUrl }
  },

  onLaunch() {
    const user = wx.getStorageSync('user')
    if (user && user.openid) this.globalData.user = user
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
