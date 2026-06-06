const app = getApp()
const api = require('../../utils/api')
const { markdownToHtml } = require('../../utils/markdown')

Page({
  data: {
    loading: false,
    story: '',
    storyHtml: '',
    year: '',
    years: [],
    count: 0,
    aiEnabled: false,
    exporting: false,
  },

  async onLoad() {
    const user = app.getUser()
    if (!user || !user.openid) {
      wx.showToast({ title: '请先登录', icon: 'none' })
      return
    }
    this.openid = user.openid
    // 从足迹列表提取年份
    try {
      const data = await api.getJourneys()
      const journeys = data.journeys || []
      const yearSet = new Set()
      journeys.forEach((j) => {
        const y = String(j.date || j.travel_date || '').slice(0, 4)
        if (y && y.length === 4) yearSet.add(y)
      })
      const years = ['全部', ...Array.from(yearSet).sort().reverse()]
      this.setData({ years })
    } catch (e) {}
    this.genStory()
  },

  onShow() {
    app.syncAiEnabled(this)
  },

  onShareAppMessage() {
    return {
      title: 'AI 写给我们的旅行故事',
      path: '/pages/story/story',
    }
  },

  onShareTimeline() {
    return { title: 'AI 写给我们的旅行故事' }
  },

  async genStory() {
    const user = app.getUser()
    if (!user || !user.openid) return
    const year = this.data.year
    this.setData({ loading: true, story: '', storyHtml: '' })
    try {
      const data = await api.admin({
        action: 'ai_story',
        openid: user.openid,
        year: year || '',
      })
      const story = data.story || ''
      this.setData({ story, storyHtml: markdownToHtml(story), count: data.count || 0, loading: false })
    } catch (e) {
      this.setData({ loading: false })
      const msg = (e && e.data && e.data.message) || '生成失败，请稍后重试'
      wx.showToast({ title: msg, icon: 'none', duration: 3000 })
    }
  },

  selectYear(e) {
    const y = e.currentTarget.dataset.year
    const year = y === '全部' ? '' : y
    if (year === this.data.year) return
    this.setData({ year })
    this.genStory()
  },

  copyStory() {
    const story = this.data.story
    if (!story) return
    wx.setClipboardData({
      data: story,
      success: () => wx.showToast({ title: '已复制', icon: 'success' }),
    })
  },

  retry() {
    this.genStory()
  },

  onPullDownRefresh() {
    this.genStory().finally(() => wx.stopPullDownRefresh())
  },

  async exportStory() {
    if (this.data.exporting || !this.data.story) return
    this.setData({ exporting: true })
    wx.showLoading({ title: '生成长图…', mask: true })
    try {
      wx.createSelectorQuery().in(this).select('#storyCanvas').fields({ node: true, size: true }).exec(async res => {
        try {
          const canvas = res && res[0] && res[0].node
          if (!canvas) throw new Error('no canvas')
          const dpr = wx.getWindowInfo ? wx.getWindowInfo().pixelRatio : 2
          const W = 320  // 逻辑px
          const story = this.data.story || ''
          const lines = story.split('\n').filter(l => l.trim())
          // 估算高度：每行约20px，标题50px，页眉页脚各60px
          const lineH = 22
          const totalLines = lines.reduce((acc, l) => acc + Math.ceil(l.length / 24), 0)
          const H = Math.min(2400, 120 + totalLines * lineH + 80)
          canvas.width = W * dpr
          canvas.height = H * dpr
          const ctx = canvas.getContext('2d')
          ctx.scale(dpr, dpr)
          // 背景
          ctx.fillStyle = '#f4f1ea'
          ctx.fillRect(0, 0, W, H)
          // 顶部装饰线
          ctx.fillStyle = '#1b1712'
          ctx.fillRect(24, 24, W - 48, 1)
          // 标题
          ctx.font = 'bold 13px Georgia'
          ctx.fillStyle = '#1b1712'
          ctx.textAlign = 'center'
          ctx.fillText('MAP OF US · 旅行故事', W / 2, 50)
          ctx.font = '11px Georgia'
          ctx.fillStyle = '#8c8475'
          ctx.fillText(this.data.year ? this.data.year + ' 年' : '全部', W / 2, 68)
          // 分割线
          ctx.fillStyle = '#d4cfc8'
          ctx.fillRect(24, 80, W - 48, 1)
          // 正文
          ctx.font = '13px Georgia'
          ctx.fillStyle = '#1b1712'
          ctx.textAlign = 'left'
          let y = 104
          const maxW = W - 48
          lines.forEach(line => {
            if (line.startsWith('「') || line.startsWith('【') || line.match(/^[一二三四五六七八九十]/)) {
              // 小标题
              y += 8
              ctx.font = 'bold 14px Georgia'
              ctx.fillText(line, 24, y)
              ctx.font = '13px Georgia'
              y += lineH + 4
            } else {
              // 普通段落自动换行
              let chars = line
              while (chars.length > 0) {
                let chunk = ''
                let w = 0
                for (let i = 0; i < chars.length; i++) {
                  const cw = chars.charCodeAt(i) > 127 ? 13 : 7
                  if (w + cw > maxW) break
                  chunk += chars[i]; w += cw
                }
                ctx.fillText(chunk, 24, y)
                y += lineH
                chars = chars.slice(chunk.length)
              }
              y += 4
            }
          })
          // 底部
          ctx.fillStyle = '#d4cfc8'
          ctx.fillRect(24, H - 36, W - 48, 1)
          ctx.font = '10px Georgia'
          ctx.fillStyle = '#8c8475'
          ctx.textAlign = 'center'
          ctx.fillText('Map of Us · ' + (this.data.year || ''), W / 2, H - 18)
          // 导出
          const tempPath = await new Promise((resolve, reject) => {
            wx.canvasToTempFilePath({ canvas, x: 0, y: 0, width: W * dpr, height: H * dpr, destWidth: W * dpr, destHeight: H * dpr, success: r => resolve(r.tempFilePath), fail: reject })
          })
          wx.hideLoading()
          this.setData({ exporting: false })
          wx.previewImage({ urls: [tempPath], current: tempPath })
        } catch(e) {
          wx.hideLoading(); this.setData({ exporting: false })
          wx.showToast({ title: '生成失败', icon: 'none' })
        }
      })
    } catch(e) {
      wx.hideLoading(); this.setData({ exporting: false })
      wx.showToast({ title: '生成失败', icon: 'none' })
    }
  },
})
