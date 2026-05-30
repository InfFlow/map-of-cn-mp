const api = require('../../utils/api')
const { anniversaryCount } = require('../../utils/util')

const app = getApp()

// 把 "2024.05.01" 解析为 {y,m,d}
function parseMD(s) {
  const p = String(s || '').split('.')
  if (p.length < 3) return null
  const y = Number(p[0]), m = Number(p[1]), d = Number(p[2])
  if (!y || !m || !d) return null
  return { y, m, d }
}

function daysTogether(anniversaries) {
  // 从形如「第 100 天」的纪念日反推在一起的起点
  for (const a of anniversaries || []) {
    const m = /第\s*(\d+)\s*天/.exec(a.label || '')
    if (m && a.date) {
      const n = Number(m[1])
      const [y, mo, d] = a.date.split('.').map(Number)
      const start = new Date(y, mo - 1, d)
      start.setDate(start.getDate() - (n - 1))
      return Math.max(0, Math.floor((Date.now() - start.getTime()) / 86400000) + 1)
    }
  }
  return 0
}

Page({
  data: {
    title: app.globalData.title,
    subtitle: app.globalData.subtitle,
    days: 0,
    stats: { provinceCount: 0, cityCount: 0, journeyCount: 0 },
    center: { latitude: 31.5, longitude: 112 },
    scale: 4,
    markers: [],
    polygons: [],
    polyline: [],
    includePoints: [],
    userLocated: false,
    ledger: [],
    recent: [],
    badges: [],
    unlocked: 0,
    anniv: [],
    nextAnniv: null,
    heatCaption: '',
    onThisDay: [],
    weather: null,
    weatherDenied: false,
    mapCaption: '',
    loading: true,
    showTop: false,
    error: '',
  },

  onLoad() {
    this.loadAll()
    this.useLocation()
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 0 })
    }
  },

  onPullDownRefresh() {
    this.loadAll().then(() => wx.stopPullDownRefresh())
  },

  onPageScroll(e) {
    const show = e.scrollTop > 480
    if (show !== this.data.showTop) this.setData({ showTop: show })
  },

  backToTop() {
    wx.pageScrollTo({ scrollTop: 0, duration: 300 })
  },

  // 获取当前定位：把地图中心移到当前位置，并拉取当地天气
  useLocation(opts) {
    const recenter = !!(opts && opts.recenter)
    wx.getLocation({
      type: 'gcj02',
      success: (r) => {
        this._myLoc = { latitude: r.latitude, longitude: r.longitude }
        this.setData({
          center: { latitude: r.latitude, longitude: r.longitude },
          scale: 11,
          userLocated: true,
          includePoints: [],
          weatherDenied: false,
        })
        if (recenter) {
          wx.createMapContext('map', this).moveToLocation({
            latitude: r.latitude,
            longitude: r.longitude,
          })
        }
        api
          .getWeather({ location: `${r.longitude},${r.latitude}` })
          .then((w) => {
            if (w && w.ok) this.setData({ weather: w })
          })
          .catch(() => {})
      },
      fail: () => {
        // 没有定位权限：回退到「全部足迹」自适应视野
        if (!this.data.userLocated) {
          this.setData({ weatherDenied: true, includePoints: this._allPoints || [] })
        }
      },
    })
  },

  // 地图上「我的位置」按钮：重新定位并平移到当前位置
  locateMe() {
    wx.vibrateShort && wx.vibrateShort({ type: 'light' })
    this.useLocation({ recenter: true })
  },

  // 地图上「全部足迹」按钮：恢复成自适应显示全部去过的城市
  fitAllFootprints() {
    wx.vibrateShort && wx.vibrateShort({ type: 'light' })
    this.setData({ userLocated: false, includePoints: (this._allPoints || []).slice() })
  },

  enableWeather() {
    // 用户此前拒绝过定位：引导到设置重新授权
    wx.vibrateShort && wx.vibrateShort({ type: 'light' })
    wx.getSetting({
      success: (res) => {
        if (res.authSetting['scope.userLocation'] === false) {
          wx.openSetting({ success: () => this.useLocation() })
        } else {
          this.useLocation()
        }
      },
      fail: () => this.useLocation(),
    })
  },

  async loadAll() {
    try {
      const [data, polys] = await Promise.all([
        api.getJourneys(),
        api.getProvincePolygons(),
      ])
      const journeys = data.journeys || []

      const markers = journeys.map((j, i) => ({
        id: i,
        journeyId: j.id,
        latitude: j.latitude,
        longitude: j.longitude,
        iconPath: '/assets/pin.png',
        width: 26,
        height: 32,
        anchor: { x: 0.5, y: 1 },
        label: {
          content: String(i + 1).padStart(2, '0'),
          color: '#1b1712',
          fontSize: 10,
          anchorX: -8,
          anchorY: -34,
          bgColor: '#faf8f3',
          borderColor: '#1b1712',
          borderWidth: 1,
          borderRadius: 8,
          padding: 3,
        },
        callout: {
          content: `${String(i + 1).padStart(2, '0')} · ${j.city} · ${j.title}`,
          color: '#1f1d1b',
          fontSize: 12,
          borderRadius: 10,
          borderWidth: 1,
          borderColor: '#00000014',
          padding: 8,
          bgColor: '#ffffff',
          display: 'BYCLICK',
        },
      }))

      // 省份访问次数 -> 热力深浅着色：去得越多颜色越深
      const provCount = {}
      journeys.forEach((j) => {
        const p = (j.province || '').replace(/省|市|自治区|特别行政区|壮族|回族|维吾尔/g, '')
        if (p) provCount[p] = (provCount[p] || 0) + 1
      })
      const heatAlpha = (c) => {
        if (c >= 4) return '8C'
        if (c === 3) return '6E'
        if (c === 2) return '52'
        if (c === 1) return '36'
        return '12'
      }
      const polygons = polys.map((p) => {
        const key = (p.province || '').replace(/省|市|自治区|特别行政区|壮族|回族|维吾尔/g, '')
        const c = provCount[key] || 0
        return {
          points: p.points,
          strokeWidth: c > 0 ? 1.5 : 1,
          strokeColor: c > 0 ? '#1b1712' : '#1b171266',
          fillColor: '#1b1712' + heatAlpha(c),
        }
      })

      const ledger = journeys.map((j, i) => ({
        no: String(i + 1).padStart(2, '0'),
        city: j.city,
      }))

      const includePoints = markers.map((m) => ({
        latitude: m.latitude,
        longitude: m.longitude,
      }))

      // 足迹连线：按日期顺序把走过的城市连成一条墨色虚线路径
      const routePoints = [...journeys]
        .filter((j) => j.latitude && j.longitude)
        .sort((a, b) => String(a.date).localeCompare(String(b.date)))
        .map((j) => ({ latitude: j.latitude, longitude: j.longitude }))
      const polyline =
        routePoints.length > 1
          ? [
              {
                points: routePoints,
                color: '#1b1712B3',
                width: 2,
                dottedLine: true,
                arrowLine: true,
              },
            ]
          : []

      const recent = [...journeys]
        .sort((a, b) => String(b.date).localeCompare(String(a.date)))
        .slice(0, 6)
        .map((j, i) => ({
          id: j.id,
          no: String(i + 1).padStart(2, '0'),
          city: j.city,
          title: j.title,
          season: j.season,
          dateShort: String(j.date),
        }))

      const provinceCount = new Set(journeys.map((j) => j.province).filter(Boolean)).size
      const cityCount = new Set(journeys.map((j) => j.city).filter(Boolean)).size
      const stats = {
        provinceCount,
        cityCount,
        journeyCount: journeys.length,
      }

      const badgeDefs = [
        { need: 3, type: 'province', name: '三省通行' },
        { need: 5, type: 'province', name: '五省点亮' },
        { need: 10, type: 'province', name: '十省纵横' },
        { need: 5, type: 'city', name: '五城打卡' },
        { need: 10, type: 'city', name: '十城足迹' },
        { need: 20, type: 'city', name: '廿城漫游' },
      ]
      const badges = badgeDefs.map((b) => ({
        name: b.name,
        on: (b.type === 'province' ? provinceCount : cityCount) >= b.need,
      }))
      const unlocked = badges.filter((b) => b.on).length

      // 纪念日轮播：今天 → 临近 → 已过，取前若干个
      const anniv = (data.anniversaries || [])
        .map((a) => {
          const c = anniversaryCount(a.date, a.repeatYearly)
          const sortKey =
            c.kind === 'today' ? -1 : c.kind === 'countdown' ? c.days : 100000 + c.days
          return {
            label: a.label || '',
            dateShort: String(a.date),
            countText: c.text,
            countKind: c.kind,
            countSub: c.sub || '',
            sortKey,
          }
        })
        .sort((x, y) => x.sortKey - y.sortKey)
        .slice(0, 8)

      // 顶部小组件：距下一个纪念日（最近的「就是今天 / 倒数」）
      const upcoming = anniv.find((a) => a.countKind === 'today' || a.countKind === 'countdown')
      const nextAnniv = upcoming
        ? { label: upcoming.label, text: upcoming.countText, today: upcoming.countKind === 'today' }
        : null

      // 今天的回忆：历年「今天」走过的城 / 纪念日
      const now = new Date()
      const tm = now.getMonth() + 1
      const td = now.getDate()
      const onThisDay = []
      journeys.forEach((j) => {
        const k = parseMD(j.date)
        if (k && k.m === tm && k.d === td) {
          onThisDay.push({
            type: 'journey',
            id: j.id,
            city: j.city,
            title: j.title,
            dateShort: String(j.date),
            yearsAgo: Math.max(0, now.getFullYear() - k.y),
          })
        }
      })
      ;(data.anniversaries || []).forEach((a) => {
        const k = parseMD(a.date)
        if (k && k.m === tm && k.d === td) {
          onThisDay.push({
            type: 'anniv',
            label: a.label || '',
            dateShort: String(a.date),
            yearsAgo: Math.max(0, now.getFullYear() - k.y),
          })
        }
      })

      this._markers = markers
      this._allPoints = includePoints
      this.setData({
        markers,
        polygons,
        polyline,
        includePoints: this.data.userLocated ? [] : includePoints,
        ledger,
        recent,
        badges,
        unlocked,
        anniv,
        nextAnniv,
        onThisDay,
        days: daysTogether(data.anniversaries),
        stats,
        mapCaption: `FIG.01 — 已点亮 ${stats.provinceCount} / 34 省 · ${stats.cityCount} 城${routePoints.length > 1 ? ' · 足迹连线' : ''}`,
        heatCaption: `颜色越深 · 去得越多 ｜ 已点亮 ${stats.cityCount} 城 · 共 ${stats.journeyCount} 个足迹`,
        loading: false,
        error: '',
      })
    } catch (e) {
      this.setData({ loading: false, error: '加载失败，请检查网络或后端地址' })
    }
  },

  onMarkerTap(e) {
    const marker = (this._markers || []).find((m) => m.id === e.detail.markerId)
    if (marker) {
      wx.vibrateShort && wx.vibrateShort({ type: 'light' })
      wx.navigateTo({ url: `/pages/detail/detail?id=${marker.journeyId}` })
    }
  },

  openDetail(e) {
    const id = e.currentTarget.dataset.id
    wx.vibrateShort && wx.vibrateShort({ type: 'light' })
    wx.navigateTo({ url: `/pages/detail/detail?id=${id}` })
  },

  goTimeline() {
    wx.switchTab({ url: '/pages/timeline/timeline' })
  },
})
