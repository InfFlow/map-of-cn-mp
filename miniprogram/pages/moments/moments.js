const app = getApp()
const api = require('../../utils/api')

Page({
  data: {
    moments: [],
    loading: false,
    uploading: false,
    hasMore: true,
    error: '',
  },

  onLoad() { this.loadMore() },
  onPullDownRefresh() {
    this.setData({ moments: [], hasMore: true })
    this.loadMore().then(() => wx.stopPullDownRefresh())
  },
  onReachBottom() { if (this.data.hasMore) this.loadMore() },

  async loadMore() {
    if (this.data.loading) return
    const user = this._user()
    if (!user) return
    this.setData({ loading: true, error: '' })
    const list = this.data.moments
    const before = list.length ? list[list.length - 1].createdAt : ''
    try {
      const data = await api.admin({ action: 'list_moments', openid: user.openid, limit: 20, before })
      const items = data.moments || []
      this.setData({ moments: [...list, ...items], hasMore: items.length === 20, loading: false })
    } catch {
      this.setData({ loading: false, error: '这次没翻到剪影，点击重试' })
      if (list.length) wx.showToast({ title: '剪影暂时没更新', icon: 'none' })
    }
  },

  choose() {
    wx.chooseMedia({
      count: 9,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      success: (res) => {
        res.tempFiles.forEach((f) => this.upload(f.tempFilePath))
      },
    })
  },

  async upload(filePath) {
    const user = this._user()
    if (!user) return
    this.setData({ uploading: true })
    try {
      // 1. 上传图片
      const up = await api.uploadImage(filePath, user.openid)
      const imageUrl = up.imageUrl
      await api.admin({
        action: 'add_moment',
        openid: user.openid,
        imageUrl,
        caption: '',
        tags: [],
      })
      wx.vibrateShort && wx.vibrateShort({ type: 'light' })
      // 重新加载第一页
      this.setData({ moments: [], hasMore: true, uploading: false })
      this.loadMore()
    } catch {
      this.setData({ uploading: false })
      wx.showToast({ title: '这张剪影暂时没传上去', icon: 'none' })
    }
  },

  onHold(e) {
    const id = e.currentTarget.dataset.id
    wx.showActionSheet({
      itemList: ['拿掉这张剪影'],
      success: async (res) => {
        if (res.tapIndex !== 0) return
        const user = this._user()
        if (!user) return
        try {
          await api.admin({ action: 'del_moment', openid: user.openid, id })
          this.setData({ moments: this.data.moments.filter((m) => m.id !== id) })
          wx.showToast({ title: '已拿掉', icon: 'success' })
        } catch {
          wx.showToast({ title: '暂时没拿掉', icon: 'none' })
        }
      },
    })
  },

  preview(e) {
    const url = e.currentTarget.dataset.url
    const urls = this.data.moments.map((m) => m.imageUrl)
    wx.previewImage({ urls, current: url })
  },

  _user() {
    const user = app.getUser && app.getUser()
    if (!user || !user.openid) {
      wx.showToast({ title: '请先登录', icon: 'none' })
      return null
    }
    return user
  },
})
