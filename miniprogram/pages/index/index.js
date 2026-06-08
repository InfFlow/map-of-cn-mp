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

function validCoord(lat, lng) {
  const latitude = Number(lat)
  const longitude = Number(lng)
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null
  return { latitude, longitude }
}

function isLocationDenied(err) {
  const msg = String((err && err.errMsg) || '').toLowerCase()
  return msg.indexOf('deny') >= 0 || msg.indexOf('denied') >= 0 || msg.indexOf('auth') >= 0 || msg.indexOf('permission') >= 0
}

function locationFailMessage(err) {
  const msg = String((err && err.errMsg) || '').toLowerCase()
  if (msg.indexOf('system permission denied') >= 0 || msg.indexOf('system') >= 0) return '手机系统定位没打开'
  if (isLocationDenied(err)) return '还没打开位置权限'
  if (msg.indexOf('timeout') >= 0) return '定位超时了，稍后再试'
  return '暂时没找到当前位置'
}

function ensureLocationPrivacy() {
  return new Promise((resolve, reject) => {
    if (!wx.requirePrivacyAuthorize) {
      resolve()
      return
    }
    wx.requirePrivacyAuthorize({
      success: resolve,
      fail: reject,
    })
  })
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
    upcomingPlan: null,
    weather: null,
    weatherDenied: false,
    locationBusy: false,
    mapCaption: '',
    loading: true,
    showTop: false,
    error: '',
    todayMemory: null,
    dailyMemory: null,
    markerPreview: null,
    showMemory: false,
    todayAnniversary: null,
    showAnniversary: false,
    dailyQuote: '',
    nextAnniversary: null,
    nextAnnDays: 0,
  },

  onLoad() {
    this.loadAll()
    this.useLocation()
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 0 })
    }
    this.checkTodayMemory()
    this.loadDailyQuote()
  },

  onShareAppMessage() {
    return {
      title: '我们一起走过的中国地图',
      path: '/pages/index/index',
    }
  },

  onShareTimeline() {
    return { title: '我们一起走过的中国地图' }
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

  // 数字从0缓动到目标值，key 支持 'stats.cityCount' 这种路径
  animateNumber(key, target, duration) {
    target = Number(target) || 0
    if (target <= 0) { this.setData({ [key]: 0 }); return }
    const start = Date.now()
    const d = duration || 700
    const ease = (t) => 1 - Math.pow(1 - t, 3) // easeOutCubic
    const tick = () => {
      const p = Math.min(1, (Date.now() - start) / d)
      const val = Math.round(target * ease(p))
      this.setData({ [key]: val })
      if (p < 1) setTimeout(tick, 32)
    }
    tick()
  },

  // 获取当前定位：把地图中心移到当前位置，并拉取当地天气
  useLocation(opts) {
    const recenter = !!(opts && opts.recenter)
    const interactive = !!(opts && opts.interactive)
    const fromPermissionFlow = !!(opts && opts.fromPermissionFlow)
    if (interactive && this.data.locationBusy && !fromPermissionFlow) return
    if (interactive) this.setData({ locationBusy: true })
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
          locationBusy: false,
        })
        if (recenter) {
          wx.createMapContext('map', this).moveToLocation({
            latitude: r.latitude,
            longitude: r.longitude,
          })
        }
        if (interactive) wx.showToast({ title: recenter ? '已回到你的位置' : '位置已打开', icon: 'none' })
        api
          .getWeather({ location: `${r.longitude},${r.latitude}` })
          .then((w) => {
            if (w && w.ok) this.setData({ weather: w })
          })
          .catch(() => {})
      },
      fail: (err) => {
        // 没有定位权限：回退到「全部足迹」自适应视野
        if (!this.data.userLocated) {
          this.setData({ weatherDenied: true, includePoints: this._allPoints || [], locationBusy: false })
        } else {
          this.setData({ locationBusy: false })
        }
        if (interactive) {
          if (isLocationDenied(err)) {
            wx.showModal({
              title: '还没打开位置权限',
              content: '打开后就能把地图移到你所在的位置。',
              confirmText: '去设置',
              cancelText: '先不了',
              success: (res) => {
                if (!res.confirm) return
                wx.openSetting({
                  success: (setting) => {
                    if (setting.authSetting && setting.authSetting['scope.userLocation'] !== false) {
                      this.useLocation({ recenter: true, interactive: true })
                    }
                  },
                })
              },
            })
          } else {
            wx.showToast({ title: locationFailMessage(err), icon: 'none' })
          }
        }
      },
    })
  },

  // 地图上「我的位置」按钮：重新定位并平移到当前位置
  locateMe() {
    wx.vibrateShort && wx.vibrateShort({ type: 'light' })
    this.requestLocationAccess({ recenter: true })
  },

  // 地图上「全部足迹」按钮：恢复成自适应显示全部去过的城市
  fitAllFootprints() {
    wx.vibrateShort && wx.vibrateShort({ type: 'light' })
    this.setData({ userLocated: false, includePoints: (this._allPoints || []).slice() })
  },

  enableWeather() {
    wx.vibrateShort && wx.vibrateShort({ type: 'light' })
    if (this.data.locationBusy) return
    this.requestLocationAccess({ recenter: false })
  },

  requestLocationAccess(opts) {
    const recenter = !!(opts && opts.recenter)
    this.setData({ locationBusy: true })
    ensureLocationPrivacy().then(() => {
      wx.authorize({
        scope: 'scope.userLocation',
        success: () => {
          this.useLocation({ recenter, interactive: true, fromPermissionFlow: true })
        },
        fail: (err) => {
          this.setData({ locationBusy: false, weatherDenied: true })
          wx.showModal({
            title: locationFailMessage(err),
            content: '打开后就能看到你们所在地的天气，也能把地图移到当前位置。',
            confirmText: '去设置',
            cancelText: '先不了',
            success: (res) => {
              if (!res.confirm) return
              wx.openSetting({
                success: (setting) => {
                  if (setting.authSetting && setting.authSetting['scope.userLocation']) {
                    this.useLocation({ recenter, interactive: true })
                  }
                },
              })
            },
          })
        },
      })
    }).catch(() => {
      this.setData({ locationBusy: false, weatherDenied: true })
      wx.showModal({
        title: '需要同意隐私授权',
        content: '同意后才能读取当前位置，用来展示所在地天气和地图位置。',
        confirmText: '知道了',
        showCancel: false,
      })
    })
  },

  async loadAll() {
    try {
      const [data, polys, planData] = await Promise.all([
        api.getJourneys(),
        api.getProvincePolygons(),
        api.getPlans().catch(() => ({ plans: [] })),
      ])
      const journeys = data.journeys || []
      const plans = planData.plans || []

      const markers = journeys
        .map((j, i) => ({ j, i, coord: validCoord(j.latitude, j.longitude) }))
        .filter((row) => row.coord)
        .map(({ j, i, coord }) => ({
          id: i,
          journeyId: j.id,
          latitude: coord.latitude,
          longitude: coord.longitude,
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
      const polygons = polys
        .map((p) => {
          const points = (p.points || [])
            .map((pt) => validCoord(pt.latitude, pt.longitude))
            .filter(Boolean)
          if (points.length < 3) return null
          const key = (p.province || '').replace(/省|市|自治区|特别行政区|壮族|回族|维吾尔/g, '')
          const c = provCount[key] || 0
          return {
            points,
            strokeWidth: c > 0 ? 2 : 1,
            strokeColor: c > 0 ? '#1b1712' : '#1b171266',
            fillColor: '#1b1712' + heatAlpha(c),
          }
        })
        .filter(Boolean)

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
        .map((j) => ({ ...j, coord: validCoord(j.latitude, j.longitude) }))
        .filter((j) => j.coord)
        .sort((a, b) => String(a.date).localeCompare(String(b.date)))
        .map((j) => j.coord)
      const polyline =
        routePoints.length > 1
          ? [
              {
                points: routePoints,
                color: '#1b1712B3',
                width: 2,
                dottedLine: true,
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

      const todayISO = new Date().toISOString().slice(0, 10)
      const upcomingPlan = [...plans]
        .filter((p) => p.visible !== false)
        .sort((a, b) => String(a.planDateISO || a.planDate || '').localeCompare(String(b.planDateISO || b.planDate || '')))
        .find((p) => {
          const d = String(p.planDateISO || p.planDate || '').slice(0, 10)
          return d && d >= todayISO
        }) || plans[0] || null
      const upcomingPlanCard = upcomingPlan
        ? {
            title: upcomingPlan.title || '未命名行程',
            date: String(upcomingPlan.planDateText || upcomingPlan.planDate || '').slice(0, 20),
            stops: (upcomingPlan.stops || []).length,
          }
        : null

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

      const memoryPool = [...journeys].filter((j) => j.city || j.title)
      const dailySource = onThisDay.find((x) => x.type === 'journey')
        || memoryPool[(now.getDate() + now.getMonth()) % Math.max(1, memoryPool.length)]
        || null
      const dailyMemory = dailySource
        ? {
            id: dailySource.id,
            city: dailySource.city || '某一站',
            title: dailySource.title || '那天的回忆',
            imageUrl: ((dailySource.photos || []).find((p) => p.imageUrl) || {}).imageUrl || '',
            text: dailySource.yearsAgo > 0
              ? `${dailySource.yearsAgo} 年前的今天，适合重看 ${dailySource.city} 那天`
              : `今天适合重看 ${dailySource.city || '我们走过'} 那天`,
          }
        : nextAnniv
          ? {
              id: '',
              city: nextAnniv.label,
              title: nextAnniv.today ? '今天就是纪念日' : nextAnniv.text,
              imageUrl: '',
              text: nextAnniv.today ? `今天是 ${nextAnniv.label}` : `距离 ${nextAnniv.label} ${nextAnniv.text}`,
            }
          : null

      this._markers = markers
      this._allPoints = includePoints
      this._journeys = journeys

      const anniversaries = data.anniversaries || []
      this._anniversaries = anniversaries
      this.checkTodayAnniversary()

      // 计算距下一个纪念日
      const anns = anniversaries
      const nowAnn = new Date()
      let nextAnn = null
      let minDays = 999
      anns.forEach(a => {
        if (!a.repeatYearly && !a.repeat_yearly) return
        const d = String(a.date || a.event_date || '')
        if (!d) return
        const md = d.slice(5) // MM-DD
        const thisYear = new Date(`${nowAnn.getFullYear()}-${md}T00:00:00`)
        const nextYear = new Date(`${nowAnn.getFullYear() + 1}-${md}T00:00:00`)
        const target = thisYear > nowAnn ? thisYear : nextYear
        const diff = Math.ceil((target - nowAnn) / 86400000)
        if (diff < minDays) { minDays = diff; nextAnn = { label: a.label || a.name || '', days: diff } }
      })

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
        upcomingPlan: upcomingPlanCard,
        days: daysTogether(data.anniversaries),
        stats,
        mapCaption: `FIG.01 — 已点亮 ${stats.provinceCount} / 34 省 · ${stats.cityCount} 城${routePoints.length > 1 ? ' · 足迹连线' : ''}`,
        heatCaption: `颜色越深 · 去得越多 ｜ 已点亮 ${stats.cityCount} 城 · 共 ${stats.journeyCount} 个足迹`,
        dailyMemory,
        loading: false,
        error: '',
        nextAnniversary: nextAnn,
        nextAnnDays: nextAnn ? nextAnn.days : 0,
      })

      // 首次加载：在一起天数 + 三个统计数字从0滚动到真实值，下拉刷新不再滚动
      if (!this._animated) {
        this._animated = true
        this.setData({
          days: 0,
          stats: { provinceCount: 0, cityCount: 0, journeyCount: 0 },
        })
        this.animateNumber('days', daysTogether(data.anniversaries), 900)
        this.animateNumber('stats.provinceCount', stats.provinceCount, 650)
        this.animateNumber('stats.cityCount', stats.cityCount, 750)
        this.animateNumber('stats.journeyCount', stats.journeyCount, 800)
      }
    } catch (e) {
      this.setData({ loading: false, error: '这次没翻到地图，请稍后再试' })
    }
  },

  onMarkerTap(e) {
    const marker = (this._markers || []).find((m) => m.id === e.detail.markerId)
    if (marker) {
      const journey = (this._journeys || []).find((j) => String(j.id) === String(marker.journeyId)) || {}
      const photo = (journey.photos || []).find((p) => p.imageUrl)
      wx.vibrateShort && wx.vibrateShort({ type: 'light' })
      this.setData({
        markerPreview: {
          id: marker.journeyId,
          city: journey.city || '',
          title: journey.title || '',
          date: String(journey.date || ''),
          imageUrl: photo ? photo.imageUrl : '',
          intro: journey.intro || (journey.notes && journey.notes[0]) || '',
        },
      })
    }
  },

  closeMarkerPreview() {
    this.setData({ markerPreview: null })
  },

  openMarkerPreview() {
    const p = this.data.markerPreview
    if (!p || !p.id) return
    wx.navigateTo({ url: `/pages/detail/detail?id=${p.id}` })
    this.setData({ markerPreview: null })
  },

  openDetail(e) {
    const id = e.currentTarget.dataset.id
    wx.vibrateShort && wx.vibrateShort({ type: 'light' })
    if (!id) {
      wx.switchTab({ url: '/pages/timeline/timeline' })
      return
    }
    wx.navigateTo({ url: `/pages/detail/detail?id=${id}` })
  },

  goTimeline() {
    wx.switchTab({ url: '/pages/timeline/timeline' })
  },

  goPlans() {
    wx.switchTab({ url: '/pages/plans/plans' })
  },

  checkTodayMemory() {
    const journeys = this._journeys || []
    if (!journeys.length) return
    const now = new Date()
    const mm = String(now.getMonth() + 1).padStart(2, '0')
    const dd = String(now.getDate()).padStart(2, '0')
    const today = `${mm}-${dd}`
    // 找N年前同月同日的旅行（排除今年）
    const thisYear = String(now.getFullYear())
    const matches = journeys.filter(j => {
      const d = String(j.date || '')
      const year = d.slice(0, 4)
      if (year === thisYear) return false
      // 日期格式为 "2024.05.01"，取月日并转成 "05-01"
      const md = d.slice(5, 10).replace('.', '-')
      return md === today
    })
    if (!matches.length) return
    // 取最近一条
    const j = matches.sort((a, b) => String(b.date).localeCompare(String(a.date)))[0]
    const yearsAgo = now.getFullYear() - parseInt(String(j.date).slice(0, 4))
    const photo = (j.photos || []).find(p => p.imageUrl)
    this.setData({
      todayMemory: {
        city: j.city || '',
        title: j.title || '',
        date: String(j.date || ''),
        yearsAgo,
        imageUrl: photo ? photo.imageUrl : '',
        id: j.id,
      },
      showMemory: true,
    })
  },

  closeMemory() {
    this.setData({ showMemory: false })
  },

  checkTodayAnniversary() {
    const anns = this._anniversaries || []
    if (!anns.length) return
    const now = new Date()
    const mm = String(now.getMonth() + 1).padStart(2, '0')
    const dd = String(now.getDate()).padStart(2, '0')
    const today = `${mm}-${dd}`
    const match = anns.find(a => {
      const d = String(a.date || a.event_date || '')
      return d.slice(5) === today
    })
    if (!match) return
    const label = match.label || match.name || '纪念日'
    const year = match.date ? parseInt(match.date.slice(0, 4)) : 0
    const yearsCount = year > 0 ? now.getFullYear() - year : 0
    this.setData({
      todayAnniversary: { label, yearsCount, date: match.date || '' },
      showAnniversary: true,
    })
  },

  closeAnniversary() { this.setData({ showAnniversary: false }) },

  openMemoryDetail() {
    const m = this.data.todayMemory
    if (m && m.id) wx.navigateTo({ url: `/pages/detail/detail?id=${m.id}` })
    this.setData({ showMemory: false })
  },

  loadDailyQuote() {
    // 每天只请求一次，缓存到当天
    const today = new Date().toISOString().slice(0, 10)
    const cached = wx.getStorageSync('daily_quote_date')
    if (cached === today) {
      const q = wx.getStorageSync('daily_quote')
      if (q) { this.setData({ dailyQuote: q }); return }
    }
    const user = app.getUser && app.getUser()
    if (!user || !user.openid) return
    api.admin({ action: 'ai_daily_inspiration', openid: user.openid }).then(r => {
      if (r.quote) {
        wx.setStorageSync('daily_quote_date', today)
        wx.setStorageSync('daily_quote', r.quote)
        this.setData({ dailyQuote: r.quote })
      }
    }).catch(() => {})
  },

  // 跳转到旅行故事
  goToStory() {
    wx.navigateTo({ url: '/pages/story/story' })
  },

  // 跳转到年度回顾
  goToRecap() {
    wx.navigateTo({ url: '/pages/recap/recap' })
  },
})
