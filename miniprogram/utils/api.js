const app = getApp()

function request(pathname, options = {}) {
  const base = app.globalData.apiBase
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
}
