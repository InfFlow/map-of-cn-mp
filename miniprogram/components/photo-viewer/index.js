// 全屏照片查看器：左右滑动 + 一键保存到相册
Component({
  properties: {
    show: { type: Boolean, value: false },
    urls: { type: Array, value: [] },
    current: { type: Number, value: 0 },
  },

  data: {
    idx: 0,
    saving: false,
  },

  observers: {
    current(v) {
      this.setData({ idx: Number(v) || 0 })
    },
  },

  methods: {
    onChange(e) {
      this.setData({ idx: e.detail.current })
    },

    close() {
      this.triggerEvent('close')
    },

    noop() {},

    save() {
      if (this.data.saving) return
      const url = this.data.urls[this.data.idx]
      if (!url) return
      this.setData({ saving: true })
      wx.vibrateShort && wx.vibrateShort({ type: 'light' })
      const doSave = () => {
        wx.downloadFile({
          url,
          success: (r) => {
            if (r.statusCode !== 200) {
              this.setData({ saving: false })
              wx.showToast({ title: '下载失败', icon: 'none' })
              return
            }
            wx.saveImageToPhotosAlbum({
              filePath: r.tempFilePath,
              success: () => {
                this.setData({ saving: false })
                wx.showToast({ title: '已保存到相册', icon: 'success' })
              },
              fail: () => {
                this.setData({ saving: false })
                wx.showToast({ title: '保存失败', icon: 'none' })
              },
            })
          },
          fail: () => {
            this.setData({ saving: false })
            wx.showToast({ title: '下载失败', icon: 'none' })
          },
        })
      }
      wx.getSetting({
        success: (res) => {
          if (res.authSetting['scope.writePhotosAlbum'] === false) {
            // 之前拒绝过：引导去设置
            wx.showModal({
              title: '需要相册权限',
              content: '请在设置中允许保存到相册',
              confirmText: '去设置',
              success: (m) => {
                if (m.confirm) {
                  wx.openSetting({
                    success: (s) => {
                      if (s.authSetting['scope.writePhotosAlbum']) doSave()
                      else this.setData({ saving: false })
                    },
                    fail: () => this.setData({ saving: false }),
                  })
                } else {
                  this.setData({ saving: false })
                }
              },
            })
          } else {
            doSave()
          }
        },
        fail: () => doSave(),
      })
    },
  },
})
