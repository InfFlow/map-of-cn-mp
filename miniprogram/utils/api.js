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
  // 微信登录：{ code, nickname?, avatarUrl? } -> { openid, nickname, avatarUrl }
  wxAuth: (data) => request('/auth.php', { method: 'POST', data }),
  // 下单：{ openid, nickname, remark, items:[{ id, qty, remark }] } -> { id, itemCount, totalAmount, status }
  createOrder: (data) => request('/order.php', { method: 'POST', data }),
  // 我的订单：openid -> { orders: [...] }
  getMyOrders: (openid) => request(`/order.php?openid=${encodeURIComponent(openid)}`),
}
