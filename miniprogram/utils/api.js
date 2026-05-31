// 带超时 + 网络类错误自动重试一次（弱网下更稳）
function request(pathname, options = {}, attempt = 0) {
  const base = getApp().globalData.apiBase
  return new Promise((resolve, reject) => {
    wx.request({
      url: `${base}${pathname}`,
      method: options.method || 'GET',
      data: options.data,
      timeout: options.timeout || 15000,
      header: { 'content-type': 'application/json', ...(options.header || {}) },
      success: (res) => {
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(res.data)
        else reject(res)
      },
      fail: (err) => {
        if (attempt < 1) {
          setTimeout(() => request(pathname, options, attempt + 1).then(resolve, reject), 700)
        } else {
          reject(err)
        }
      },
    })
  })
}

// 上传前压缩，省流且更快（失败则用原图）
function compressImage(filePath) {
  return new Promise((resolve) => {
    if (!filePath) return resolve(filePath)
    wx.compressImage({
      src: filePath,
      quality: 80,
      success: (r) => resolve(r.tempFilePath || filePath),
      fail: () => resolve(filePath),
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
  // 高德天气：{ location:'lng,lat' } 或 { city:adcode } -> { ok, city, weather, temperature, dayTemp, nightTemp, tip, ... }
  getWeather: (data) => request('/weather.php', { method: 'POST', data }),
  // 微信登录：{ code, nickname?, avatarUrl? } -> { openid, nickname, avatarUrl }
  wxAuth: (data) => request('/auth.php', { method: 'POST', data }),
  // 下单：{ openid, nickname, remark, items:[{ id, qty, remark }] } -> { id, itemCount, totalAmount, status }
  createOrder: (data) => request('/order.php', { method: 'POST', data }),
  // 我的订单：openid -> { orders: [...] }
  getMyOrders: (openid) => request(`/order.php?openid=${encodeURIComponent(openid)}`),
  // 小程序内管理接口：{ action, openid, ... } -> 结果。action 见 admin_api.php
  admin: (data) => request('/admin_api.php', { method: 'POST', data }),
  // 上传图片（multipart）：(filePath, openid) -> { imageUrl }。菜品 / 计划封面通用。上传前自动压缩省流
  uploadImage: async (filePath, openid) => {
    const path = await compressImage(filePath)
    return new Promise((resolve, reject) => {
      wx.uploadFile({
        url: `${getApp().globalData.apiBase}/admin_api.php`,
        filePath: path,
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
    })
  },
}
// 向后兼容旧调用名
module.exports.uploadDishImage = module.exports.uploadImage
