const app = getApp()
const api = require('../../utils/api')

Page({
  data: {
    keyword: '',
    results: [],
    allData: [],
    searching: false,
    hasSearched: false,
  },

  onLoad(options) {
    if (options.keyword) {
      const kw = decodeURIComponent(options.keyword)
      this.setData({ keyword: kw })
      // 等数据加载完再搜索
      const timer = setInterval(() => {
        if (this._all) { clearInterval(timer); this.doSearch(kw) }
      }, 100)
      setTimeout(() => clearInterval(timer), 3000)
    }
    // 预加载数据
    api.getJourneys().then(data => {
      const journeys = data.journeys || []
      this._all = journeys
      if (this.data.keyword) this.doSearch(this.data.keyword)
    }).catch(() => {})
  },

  onInput(e) {
    const kw = e.detail.value
    this.setData({ keyword: kw })
    if (kw.trim().length >= 1) {
      this.doSearch(kw.trim())
    } else {
      this.setData({ results: [], hasSearched: false })
    }
  },

  doSearch(kw) {
    const all = this._all || []
    const kwLow = kw.toLowerCase()
    const results = []
    all.forEach(j => {
      const searchText = [
        j.city, j.province, j.title, j.intro,
        j.landmark, j.season, j.weather,
        ...(j.tags || []),
        ...(j.notes || []),
      ].join(' ').toLowerCase()
      if (searchText.includes(kwLow)) {
        const photo = (j.photos || []).find(p => p.imageUrl)
        results.push({
          id: j.id,
          city: j.city || '',
          province: j.province || '',
          title: j.title || '',
          date: String(j.date || ''),
          imageUrl: photo ? photo.imageUrl : '',
          tags: (j.tags || []).filter(t => t.toLowerCase().includes(kwLow)),
          matchCity: (j.city || '').toLowerCase().includes(kwLow),
        })
      }
    })
    this.setData({ results, hasSearched: true })
  },

  clear() {
    this.setData({ keyword: '', results: [], hasSearched: false })
  },

  openDetail(e) {
    const id = e.currentTarget.dataset.id
    if (id) wx.navigateTo({ url: `/pages/detail/detail?id=${id}` })
  },
})
