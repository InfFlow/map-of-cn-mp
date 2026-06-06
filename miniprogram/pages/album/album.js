const app = getApp()
const api = require('../../utils/api')

Page({
  data: {
    photos: [],
    allPhotos: [],
    cities: [],
    filterCity: '',
    mono: false,
    total: 0,
    aiEnabled: false,
    loading: true,
    showTop: false,
    error: '',
    viewerShow: false,
    viewerUrls: [],
    viewerCurrent: 0,
  },

  onLoad() {
    this.loadAll()
  },

  onShow() { app.syncAiEnabled(this) },

  onShareAppMessage() {
    return {
      title: '我们一起拍下的照片',
      path: '/pages/album/album',
    }
  },

  onShareTimeline() {
    return { title: '我们一起拍下的照片' }
  },

  onPullDownRefresh() {
    this.loadAll().then(() => wx.stopPullDownRefresh())
  },

  retry() {
    wx.vibrateShort && wx.vibrateShort({ type: 'light' })
    this.loadAll()
  },

  onPageScroll(e) {
    const show = e.scrollTop > 480
    if (show !== this.data.showTop) this.setData({ showTop: show })
  },

  backToTop() {
    wx.pageScrollTo({ scrollTop: 0, duration: 300 })
  },

  async loadAll() {
    try {
      const data = await api.getJourneys()
      const journeys = data.journeys || []
      const all = []
      journeys.forEach((j) => {
        ;(j.photos || []).forEach((p) => {
          if (p.imageUrl) {
            all.push({
              imageUrl: p.imageUrl,
              city: j.city || '',
              title: p.title || j.title || '',
              date: String(j.date || ''),
              journeyId: j.id,
              mood: p.mood || '',
            })
          }
        })
      })
      // 按日期倒序（最新的在前）
      all.sort((a, b) => b.date.localeCompare(a.date))
      const cities = [...new Set(all.map((p) => p.city).filter(Boolean))]
      this.setData({
        allPhotos: all,
        cities,
        total: all.length,
        loading: false,
        error: '',
      })
      this.applyFilter()
    } catch (e) {
      this.setData({ loading: false, error: '这次没翻到相册，请稍后再试' })
    }
  },

  applyFilter() {
    const { allPhotos, filterCity } = this.data
    const list = filterCity
      ? allPhotos.filter((p) => p.city === filterCity)
      : allPhotos
    // 错落高度：用索引制造规律的高低变化（避免随机导致刷新跳动）
    const heights = [320, 240, 280, 360, 260, 300] // rpx 候选高度
    const photos = list.map((p, i) => ({
      ...p,
      no: String(i + 1).padStart(2, '0'),
      h: heights[i % heights.length],
    }))
    this.setData({ photos })
  },

  onFilter(e) {
    const city = e.currentTarget.dataset.city || ''
    if (city === this.data.filterCity) return
    wx.vibrateShort && wx.vibrateShort({ type: 'light' })
    this.setData({ filterCity: city }, () => this.applyFilter())
  },

  toggleMono() {
    wx.vibrateShort && wx.vibrateShort({ type: 'light' })
    this.setData({ mono: !this.data.mono })
  },

  onPhotoError(e) {
    const index = Number(e.currentTarget.dataset.index)
    if (!Number.isFinite(index)) return
    this.setData({ [`photos[${index}].broken`]: true })
  },

  preview(e) {
    const url = e.currentTarget.dataset.url
    if (!url) return
    const urls = this.data.photos.map((p) => p.imageUrl).filter(Boolean)
    const current = Math.max(0, urls.indexOf(url))
    wx.vibrateShort && wx.vibrateShort({ type: 'light' })
    this.setData({ viewerUrls: urls, viewerCurrent: current, viewerShow: true })
  },

  // 智能分析照片
  async smartAnalysis() {
    if (!this.data.aiEnabled) {
      wx.showToast({ title: '回忆整理还没开启', icon: 'none' })
      return
    }

    if (this.data.allPhotos.length === 0) {
      wx.showToast({ title: '还没有照片可以整理', icon: 'none' })
      return
    }

    wx.vibrateShort && wx.vibrateShort({ type: 'light' })
    wx.showLoading({ title: '正在整理回忆…', mask: true })

    try {
      // 准备照片数据
      const photos = this.data.allPhotos.map(p => ({
        imageUrl: p.imageUrl,
        city: p.city,
        location: p.city,
        title: p.title,
        date: p.date,
        mood: p.mood,
        timestamp: p.date ? new Date(p.date).getTime() / 1000 : 0
      }))

      const result = await api.analyzePhotos({ photos })
      wx.hideLoading()

      // 显示分析结果
      this.showAnalysisResult(result)
    } catch (err) {
      wx.hideLoading()
      console.error('[SmartAnalysis] 分析失败', err)
      wx.showToast({ title: '整理失败，请重试', icon: 'none' })
    }
  },

  // 显示分析结果
  showAnalysisResult(result) {
    const { groups, highlights, amazingPlaces, travelNote } = result

    let content = travelNote || '回忆整理好了'

    if (amazingPlaces && amazingPlaces.length > 0) {
      content += '\n\n点击“查看详情”继续看'
    }

    wx.showModal({
      title: '回忆整理好了',
      content,
      confirmText: '查看详情',
      cancelText: '关闭',
      success: (res) => {
        if (res.confirm) {
          // 跳转到分析结果页面
          wx.navigateTo({
            url: `/pages/analysis/analysis?data=${encodeURIComponent(JSON.stringify(result))}`
          })
        }
      }
    })
  },

  // 长按照片 → 保存图片
  onPhotoHold(e) {
    const { url } = e.currentTarget.dataset
    if (!url) return
    wx.vibrateShort && wx.vibrateShort({ type: 'medium' })
    this.saveImageUrl(url)
  },

  saveImageUrl(url) {
    wx.showLoading({ title: '保存中…', mask: true })
    const doSave = () => {
      wx.downloadFile({
        url,
        success: (r) => {
          if (r.statusCode !== 200) {
            wx.hideLoading()
            wx.showToast({ title: '下载失败', icon: 'none' })
            return
          }
          wx.saveImageToPhotosAlbum({
            filePath: r.tempFilePath,
            success: () => {
              wx.hideLoading()
              wx.showToast({ title: '已保存到相册', icon: 'success' })
            },
            fail: () => {
              wx.hideLoading()
              wx.showToast({ title: '保存失败', icon: 'none' })
            },
          })
        },
        fail: () => {
          wx.hideLoading()
          wx.showToast({ title: '下载失败', icon: 'none' })
        },
      })
    }
    wx.getSetting({
      success: (res) => {
        if (res.authSetting['scope.writePhotosAlbum'] === false) {
          wx.hideLoading()
          wx.showModal({
            title: '需要相册权限',
            content: '请在设置中允许保存到相册',
            confirmText: '去设置',
            success: (m) => {
              if (!m.confirm) return
              wx.openSetting({
                success: (s) => {
                  if (s.authSetting['scope.writePhotosAlbum']) doSave()
                },
              })
            },
          })
        } else {
          doSave()
        }
      },
      fail: () => doSave(),
    })
  },

  closeViewer() {
    this.setData({ viewerShow: false })
  },

  openDetail(e) {
    const id = e.currentTarget.dataset.id
    if (id === undefined || id === null || id === '') return
    wx.vibrateShort && wx.vibrateShort({ type: 'light' })
    wx.navigateTo({ url: `/pages/detail/detail?id=${id}` })
  },

})
