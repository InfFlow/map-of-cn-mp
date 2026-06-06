function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function inlineMd(s) {
  return escapeHtml(s)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
}

function markdownToHtml(md) {
  const lines = String(md || '').replace(/\r\n/g, '\n').split('\n')
  const html = []
  let listOpen = false

  const closeList = () => {
    if (listOpen) {
      html.push('</ul>')
      listOpen = false
    }
  }

  lines.forEach((raw) => {
    const line = raw.trim()
    if (!line) {
      closeList()
      html.push('<p class="md-gap"></p>')
      return
    }

    const heading = line.match(/^(#{1,3})\s+(.+)$/)
    if (heading) {
      closeList()
      const level = Math.min(3, heading[1].length)
      html.push(`<h${level}>${inlineMd(heading[2])}</h${level}>`)
      return
    }

    const bracketHeading = line.match(/^【(.+?)】\s*(.*)$/)
    if (bracketHeading) {
      closeList()
      html.push(`<h3>${inlineMd(bracketHeading[1])}</h3>`)
      if (bracketHeading[2]) html.push(`<p>${inlineMd(bracketHeading[2])}</p>`)
      return
    }

    const list = line.match(/^[-*+·]\s*(.+)$/) || line.match(/^\d+[.)、]\s*(.+)$/)
    if (list) {
      if (!listOpen) {
        html.push('<ul>')
        listOpen = true
      }
      html.push(`<li>${inlineMd(list[1])}</li>`)
      return
    }

    closeList()
    html.push(`<p>${inlineMd(line)}</p>`)
  })

  closeList()
  return `<div class="md">${html.join('')}</div>`
}

function markdownToNodes(md) {
  const html = markdownToHtml(md)
  return [{ name: 'div', attrs: { class: 'md-root' }, children: [{ type: 'node', name: 'span', attrs: {}, children: [{ type: 'text', text: '' }] }], html }]
}

module.exports = { markdownToHtml, markdownToNodes }
