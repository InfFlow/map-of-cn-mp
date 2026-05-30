// tone -> 渐变色，照片没图时作占位，也用于卡片配色
// 黑白杂志风：极低饱和的灰墨/暖灰单色系，彼此仅有细微冷暖差，整体安静
const TONES = {
  'tone-spring': ['#dfdcd2', '#b7b2a4'],
  'tone-sea': ['#d6d8d6', '#aab0b0'],
  'tone-water': ['#d8d9d6', '#acb0ac'],
  'tone-lake': ['#dad9d2', '#b1aea2'],
  'tone-island': ['#d9dad6', '#aeb2ac'],
  'tone-city': ['#d8d6d8', '#aeacb0'],
  'tone-sunset': ['#e0d8cd', '#bdb09e'],
  'tone-warm': ['#e1dacd', '#bdb39c'],
  'tone-brick': ['#ded4cc', '#b6a99c'],
  'tone-night': ['#d2d2d6', '#a4a4ab'],
  'tone-rain': ['#d6d7da', '#a9abae'],
  'tone-osmanthus': ['#e2dccb', '#bfb597'],
  'tone-paper': ['#e1dccf', '#bcb39f'],
  'tone-tea': ['#dcdbcf', '#b4b29c'],
  'tone-slate': ['#d7d8da', '#a8aab0'],
  'tone-sage': ['#d8dbd2', '#aab09f'],
  'tone-ink': ['#cfcdc9', '#9b958c'],
}

// 编辑器封面色可选列表
const TONE_LIST = Object.keys(TONES)

// 色调中文名（编辑器选色时显示）
const TONE_NAMES = {
  'tone-spring': '春',
  'tone-sea': '海',
  'tone-water': '水',
  'tone-lake': '湖',
  'tone-island': '屿',
  'tone-city': '城',
  'tone-sunset': '夕',
  'tone-warm': '暖',
  'tone-brick': '砖',
  'tone-night': '夜',
  'tone-rain': '雨',
  'tone-osmanthus': '桂',
  'tone-paper': '纸',
  'tone-tea': '茶',
  'tone-slate': '岩',
  'tone-sage': '苔',
  'tone-ink': '墨',
}

function toneGradient(tone) {
  const c = TONES[tone] || ['#ddd9cf', '#b4ac9c']
  return `linear-gradient(150deg, ${c[0]} 0%, ${c[1]} 100%)`
}

// 把后端 "2024.04.05" 转成 "2024年4月5日"
function prettyDate(dotted) {
  if (!dotted) return ''
  const [y, m, d] = String(dotted).split('.')
  if (!y || !m || !d) return dotted
  return `${y}年${Number(m)}月${Number(d)}日`
}

// 纪念日倒计时 / 正计时
// dotted: "2024.05.01"；repeatYearly: 是否每年循环（生日/周年）
// 返回 { text, days, kind }，kind: 'today' | 'countdown' | 'countup'
function anniversaryCount(dotted, repeatYearly) {
  if (!dotted) return { text: '', days: 0, kind: 'countup' }
  const [y, m, d] = String(dotted).split('.').map(Number)
  if (!y || !m || !d) return { text: '', days: 0, kind: 'countup' }
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  if (repeatYearly) {
    let next = new Date(today.getFullYear(), m - 1, d)
    if (next.getTime() < today.getTime()) {
      next = new Date(today.getFullYear() + 1, m - 1, d)
    }
    const days = Math.round((next.getTime() - today.getTime()) / 86400000)
    const years = next.getFullYear() - y
    if (days === 0) return { text: '就是今天', days: 0, kind: 'today' }
    return { text: `还有 ${days} 天`, days, kind: 'countdown', sub: years > 0 ? `第 ${years} 年` : '' }
  }

  const target = new Date(y, m - 1, d)
  const diff = Math.round((target.getTime() - today.getTime()) / 86400000)
  if (diff === 0) return { text: '就是今天', days: 0, kind: 'today' }
  if (diff > 0) return { text: `还有 ${diff} 天`, days: diff, kind: 'countdown' }
  return { text: `已 ${-diff} 天`, days: -diff, kind: 'countup' }
}

module.exports = { toneGradient, prettyDate, anniversaryCount, TONES, TONE_LIST, TONE_NAMES }
