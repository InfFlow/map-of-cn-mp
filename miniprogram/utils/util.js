// tone -> 渐变色，照片没图时作占位，也用于卡片配色
// 低饱和、克制的高级色（去掉糖果粉），整体偏浅
const TONES = {
  'tone-spring': ['#e3e9da', '#bcc8aa'],
  'tone-sea': ['#d4e0e6', '#a6bcc7'],
  'tone-water': ['#d6e2e3', '#a8c2c4'],
  'tone-lake': ['#d7e4da', '#abc4b1'],
  'tone-island': ['#dae8e2', '#aecbc2'],
  'tone-city': ['#e0ddE6', '#b6afc4'],
  'tone-sunset': ['#eedcca', '#d6ad8b'],
  'tone-warm': ['#eedfc6', '#d7b98c'],
  'tone-brick': ['#e4cdbf', '#c39c87'],
  'tone-night': ['#d2d5de', '#9aa0b1'],
  'tone-rain': ['#d9dde2', '#aab2bc'],
  'tone-osmanthus': ['#f0e6c8', '#d9c38c'],
  'tone-paper': ['#ece7db', '#cbc1ab'],
  'tone-tea': ['#e0e4d2', '#b9c39e'],
}

function toneGradient(tone) {
  const c = TONES[tone] || ['#e6e3dd', '#c4bdb1']
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
