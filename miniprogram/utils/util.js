// tone -> 渐变色，照片没图时作占位，也用于卡片配色
const TONES = {
  'tone-spring': ['#ffd6e8', '#ff9ab5'],
  'tone-sea': ['#8fd3ff', '#4fa8e0'],
  'tone-water': ['#9ad9ff', '#5bb6e8'],
  'tone-lake': ['#a8e6cf', '#56c596'],
  'tone-island': ['#aef3e0', '#5fd1c4'],
  'tone-city': ['#cdbdf0', '#9b8cf0'],
  'tone-sunset': ['#ffb88c', '#ff7eb3'],
  'tone-warm': ['#ffd28f', '#ff9a76'],
  'tone-brick': ['#e0a899', '#c97b6a'],
  'tone-night': ['#4b4b73', '#7d7db0'],
  'tone-rain': ['#b8c6db', '#8fa3bf'],
  'tone-osmanthus': ['#ffe7a3', '#ffce5c'],
  'tone-paper': ['#f3ece0', '#ddccb0'],
  'tone-tea': ['#d8e6b8', '#a8c97f'],
}

function toneGradient(tone) {
  const c = TONES[tone] || ['#ffd6e8', '#ff9ab5']
  return `linear-gradient(135deg, ${c[0]} 0%, ${c[1]} 100%)`
}

// 把后端 "2024.04.05" 转成 "2024年4月5日"
function prettyDate(dotted) {
  if (!dotted) return ''
  const [y, m, d] = String(dotted).split('.')
  if (!y || !m || !d) return dotted
  return `${y}年${Number(m)}月${Number(d)}日`
}

module.exports = { toneGradient, prettyDate, TONES }
