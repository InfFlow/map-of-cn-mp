const app = getApp()
const { markdownToHtml } = require('../../utils/markdown')

Page({
  data: {
    groups: [],
    highlights: [],
    amazingPlaces: [],
    travelNote: '',
    travelNoteHtml: '',
    loading: false,
    activeTab: 'overview' // overview/groups/highlights/places
  },

  onLoad(options) {
    if (options.data) {
      try {
        const result = JSON.parse(decodeURIComponent(options.data))
        this.setData({
          groups: result.groups || [],
          highlights: result.highlights || [],
          amazingPlaces: result.amazingPlaces || [],
          travelNote: result.travelNote || '',
          travelNoteHtml: markdownToHtml(result.travelNote || '')
        })
      } catch (err) {
        console.error('[Analysis] 解析数据失败', err)
        wx.showToast({ title: '回忆暂时没翻到', icon: 'none' })
      }
    }
  },

  switchTab(e) {
    const tab = e.currentTarget.dataset.tab
    wx.vibrateShort && wx.vibrateShort({ type: 'light' })
    this.setData({ activeTab: tab })
  },

  previewPhoto(e) {
    const url = e.currentTarget.dataset.url
    if (!url) return
    wx.previewImage({
      current: url,
      urls: [url]
    })
  },

  shareNote() {
    const { travelNote } = this.data
    if (!travelNote) return

    wx.showModal({
      title: '旅行手记',
      content: travelNote,
      showCancel: true,
      confirmText: '复制',
      success: (res) => {
        if (res.confirm) {
          wx.setClipboardData({
            data: travelNote,
            success: () => {
              wx.showToast({ title: '已复制', icon: 'success' })
            }
          })
        }
      }
    })
  }
})
