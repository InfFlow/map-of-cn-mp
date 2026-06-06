const app = getApp()
const api = require('../../utils/api')
const { prettyDate, toneGradient } = require('../../utils/util')
const { buildJourneyPoster } = require('../../utils/poster')

Page({
  data: {
    trip: null,
    loading: true,
    showTop: false,
    error: '',
    viewerShow: false,
    viewerUrls: [],
    viewerCurrent: 0,
    posterW: 300,
    posterH: 100,
    making: false,
    sharing: false,
    aiEnabled: app.globalData.aiEnabled,
  },

  onLoad(options) {
    this._id = options.id
    this.load(options.id)
  },

  onShow() { app.syncAiEnabled(this) },

  onShareAppMessage() {
    const c = this.data.trip ? this.data.trip.city : '我们的旅行'
    return { title: '回忆 · ' + c, path: '/pages/index/index' }
  },

  onShareTimeline() {
    const c = this.data.trip ? this.data.trip.city : '我们的旅行'
    return { title: '回忆 · ' + c }
  },

  retry() {
    wx.vibrateShort && wx.vibrateShort({ type: 'light' })
    this.setData({ loading: true, error: '' })
    this.load(this._id)
  },

  onPageScroll(e) {
    const show = e.scrollTop > 520
    if (show !== this.data.showTop) this.setData({ showTop: show })
  },

  backToTop() {
    wx.pageScrollTo({ scrollTop: 0, duration: 300 })
  },

  async load(id) {
    try {
      const data = await api.getJourneys()
      const j = (data.journeys || []).find((x) => String(x.id) === String(id))
      if (!j) {
        this.setData({ loading: false, error: '这段回忆暂时不在这里' })
        return
      }
      const photos = (j.photos || []).map((p, i) => ({
        ...p,
        grad: toneGradient(p.tone),
        fig: 'FIG.' + String(i + 1).padStart(2, '0'),
        shape: 'auto',
      }))
      const notes = j.notes || []
      const photoCount = Math.min(9, photos.length)
      const trip = {
        ...j,
        dateText: prettyDate(j.date),
        dateShort: String(j.date),
        coverGrad: toneGradient(j.coverTone),
        cover: (photos.find((p) => p.imageUrl) || {}).imageUrl || '',
        photos,
        photoCountClass: 'count-' + photoCount,
        pullquote: notes[0] || j.intro || '',
        restNotes: notes.length > 1 ? notes.slice(1) : notes,
      }
      wx.setNavigationBarTitle({ title: j.city })
      this.setData({ trip, loading: false })
      this.resolvePhotoShapes(photos)
    } catch (e) {
      this.setData({ loading: false, error: '这次没翻到这段回忆，请稍后再试' })
    }
  },

  preview(e) {
    const url = e.currentTarget.dataset.url
    if (!url) return
    const urls = (this.data.trip.photos || []).map((p) => p.imageUrl).filter(Boolean)
    const current = Math.max(0, urls.indexOf(url))
    wx.vibrateShort && wx.vibrateShort({ type: 'light' })
    this.setData({ viewerUrls: urls, viewerCurrent: current, viewerShow: true })
  },

  savePhoto(e) {
    const url = e.currentTarget.dataset.url
    if (!url) return
    this.saveImageUrl(url)
  },

  saveImageUrl(url) {
    wx.vibrateShort && wx.vibrateShort({ type: 'light' })
    wx.showLoading({ title: '保存中…', mask: true })
    const doSave = () => {
      wx.downloadFile({
        url,
        success: (r) => {
          if (r.statusCode !== 200) {
            wx.hideLoading()
            wx.showToast({ title: '照片暂时取不到', icon: 'none' })
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
              wx.showToast({ title: '暂时没保存成功', icon: 'none' })
            },
          })
        },
        fail: () => {
          wx.hideLoading()
          wx.showToast({ title: '照片暂时取不到', icon: 'none' })
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

  resolvePhotoShapes(photos) {
    (photos || []).forEach((p, i) => {
      if (!p.imageUrl) return
      wx.getImageInfo({
        src: p.imageUrl,
        success: (info) => {
          const w = Number(info.width) || 0
          const h = Number(info.height) || 0
          let shape = 'square'
          if (w > h * 1.18) shape = 'wide'
          else if (h > w * 1.18) shape = 'tall'
          this.setData({ [`trip.photos[${i}].shape`]: shape })
        },
      })
    })
  },

  closeViewer() {
    this.setData({ viewerShow: false })
  },

  // 生成分享长图：绘制 -> 预览（可长按转发 / 保存到相册）
  makePoster() {
    if (this.data.making || !this.data.trip) return
    this.setData({ making: true })
    wx.vibrateShort && wx.vibrateShort({ type: 'light' })
    wx.showLoading({ title: '生成中…', mask: true })
    wx.createSelectorQuery()
      .select('#poster')
      .fields({ node: true, size: true })
      .exec(async (res) => {
        const node = res && res[0] && res[0].node
        if (!node) {
          wx.hideLoading()
          this.setData({ making: false })
          wx.showToast({ title: '海报暂时没生成', icon: 'none' })
          return
        }
        try {
          const tempFilePath = await buildJourneyPoster(node, this.data.trip)
          wx.hideLoading()
          this.setData({ making: false })
          this.setData({ viewerUrls: [tempFilePath], viewerCurrent: 0, viewerShow: true })
        } catch (e) {
          wx.hideLoading()
          this.setData({ making: false })
          wx.showToast({ title: '海报暂时没生成，请重试', icon: 'none' })
        }
      })
  },

  copyNote(e) {
    const text = e.currentTarget.dataset.text
    if (!text) return
    wx.setClipboardData({ data: text, success: () => wx.showToast({ title: '已复制', icon: 'success' }) })
  },

  searchTag(e) {
    const tag = e.currentTarget.dataset.tag
    if (!tag) return
    wx.navigateTo({ url: `/pages/search/search?keyword=${encodeURIComponent(tag)}` })
  },

  askAi() {
    const city = (this.data.trip && this.data.trip.city) || ''
    wx.vibrateShort && wx.vibrateShort({ type: 'light' })
    wx.navigateTo({ url: `/pages/ai/ai?mode=scene&city=${encodeURIComponent(city)}` })
  },

  async shareCard() {
    if (this.data.sharing) return
    const trip = this.data.trip
    if (!trip) return
    this.setData({ sharing: true })
    wx.showLoading({ title: '生成卡片…', mask: true })
    wx.createSelectorQuery().in(this).select('#shareCanvas').fields({ node: true, size: true }).exec(async res => {
      try {
        const canvas = res && res[0] && res[0].node
        if (!canvas) throw new Error('no canvas')
        const dpr = wx.getWindowInfo ? wx.getWindowInfo().pixelRatio : 2
        const W = 300, H = 400
        canvas.width = W * dpr; canvas.height = H * dpr
        const ctx = canvas.getContext('2d')
        ctx.scale(dpr, dpr)
        // 导出画布并预览；失败时也要收尾，避免卡在 loading
        const finish = () => {
          wx.canvasToTempFilePath({
            canvas,
            success: r => {
              wx.hideLoading(); this.setData({ sharing: false })
              wx.previewImage({ urls: [r.tempFilePath], current: r.tempFilePath })
            },
            fail: () => {
              wx.hideLoading(); this.setData({ sharing: false })
              wx.showToast({ title: '卡片暂时没生成，可截图保存', icon: 'none' })
            },
          })
        }
        // 背景渐变
        const grad = ctx.createLinearGradient(0, 0, 0, H)
        grad.addColorStop(0, '#f4f1ea')
        grad.addColorStop(1, '#e8e3d8')
        ctx.fillStyle = grad
        ctx.fillRect(0, 0, W, H)
        // 如果有封面照片先绘制
        const photoUrl = trip.cover || (trip.photos && trip.photos[0] && trip.photos[0].imageUrl)
        const drawContent = () => {
          // 城市大字
          ctx.fillStyle = '#1b1712'
          ctx.font = 'bold 48px Georgia'
          ctx.textAlign = 'left'
          ctx.fillText(trip.city || '', 24, photoUrl ? 260 : 120)
          // 省份
          ctx.font = '14px Georgia'
          ctx.fillStyle = '#8c8475'
          ctx.fillText(trip.province || '', 24, photoUrl ? 280 : 145)
          // 日期
          ctx.fillText(String(trip.date || '').slice(0, 10), 24, photoUrl ? 300 : 168)
          // 手记第一句
          const note = trip.pullquote || ''
          if (note) {
            ctx.font = 'italic 13px Georgia'
            ctx.fillStyle = '#5a5248'
            const words = note.slice(0, 40)
            ctx.fillText('「' + words + (note.length > 40 ? '…' : '') + '」', 24, photoUrl ? 330 : 210)
          }
          // 底部签名
          ctx.font = '10px Georgia'
          ctx.fillStyle = '#8c8475'
          ctx.textAlign = 'right'
          ctx.fillText('Map of Us', W - 24, H - 20)
          // 顶部细线
          ctx.fillStyle = '#1b1712'
          ctx.fillRect(24, 24, 40, 1)
        }
        if (photoUrl) {
          const img = canvas.createImage()
          img.onload = () => {
            ctx.drawImage(img, 0, 0, W, 220)
            // 渐变遮罩
            const mask = ctx.createLinearGradient(0, 140, 0, 220)
            mask.addColorStop(0, 'rgba(244,241,234,0)')
            mask.addColorStop(1, 'rgba(244,241,234,1)')
            ctx.fillStyle = mask
            ctx.fillRect(0, 140, W, 80)
            drawContent()
            finish()
          }
          img.onerror = () => {
            drawContent()
            finish()
          }
          img.src = photoUrl
        } else {
          drawContent()
          finish()
        }
      } catch {
        wx.hideLoading(); this.setData({ sharing: false })
        wx.showToast({ title: '卡片暂时没生成', icon: 'none' })
      }
    })
  },
})
