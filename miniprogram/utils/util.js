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

module.exports = { toneGradient, prettyDate, TONES }
