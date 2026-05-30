function request(pathname, options = {}) {
  const base = getApp().globalData.apiBase
  return new Promise((resolve, reject) => {
    wx.request({
      url: `${base}${pathname}`,
      method: options.method || 'GET',
      data: options.data,
      header: { 'content-type': 'application/json', ...(options.header || {}) },
      success: (res) => {
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(res.data)
        else reject(res)
      },
      fail: reject,
    })
  })
}

module.exports = {
  // { journeys: [...], anniversaries: [...] }
  getJourneys: () => request('/journeys.php'),
  // [{ province, points: [{latitude, longitude}] }]
  getProvincePolygons: () => request('/provinces.php'),
  // { categories: [{ id, name, dishes: [{ id, name, description, price, imageUrl }] }] }
  getMenu: () => request('/menu.php'),
  // 旅行计划（行程）：{ plans: [{ id, title, coverTone, planDate, note, stops:[...] }] }
  getPlans: () => request('/plans.php'),
  // 高德路线：{ origin:'lng,lat', destination:'lng,lat', city?, cityd? } -> { recommend, options }
  getRoute: (data) => request('/route.php', { method: 'POST', data }),
  // 微信登录：{ code, nickname?, avatarUrl? } -> { openid, nickname, avatarUrl }
  wxAuth: (data) => request('/auth.php', { method: 'POST', data }),
  // 下单：{ openid, nickname, remark, items:[{ id, qty, remark }] } -> { id, itemCount, totalAmount, status }
  createOrder: (data) => request('/order.php', { method: 'POST', data }),
  // 我的订单：openid -> { orders: [...] }
  getMyOrders: (openid) => request(`/order.php?openid=${encodeURIComponent(openid)}`),
  // 小程序内管理接口：{ action, openid, ... } -> 结果。action 见 admin_api.php
  admin: (data) => request('/admin_api.php', { method: 'POST', data }),
  // 上传菜品图片（multipart）：(filePath, openid) -> { imageUrl }
  uploadDishImage: (filePath, openid) =>
    new Promise((resolve, reject) => {
      wx.uploadFile({
        url: `${getApp().globalData.apiBase}/admin_api.php`,
        filePath,
        name: 'image',
        formData: { action: 'upload_image', openid },
        success: (res) => {
          try {
            const data = JSON.parse(res.data)
            if (data && data.imageUrl) resolve(data)
            else reject(data)
          } catch (e) {
            reject(e)
          }
        },
        fail: reject,
      })
    }),
}
