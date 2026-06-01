const puppeteer = require('puppeteer-core')

;(async () => {
  const url = process.argv[2] || 'http://127.0.0.1:8099/preview-menu.html'
  const out = process.argv[3] || 'C:/Users/Administrator/repos/map-of-intl-mp/shot.png'
  const browser = await puppeteer.connect({ browserURL: 'http://localhost:29229', defaultViewport: null })
  const page = await browser.newPage()
  await page.setViewport({ width: 1180, height: 900, deviceScaleFactor: 2 })
  await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 })
  await new Promise((r) => setTimeout(r, 400))
  await page.screenshot({ path: out, fullPage: true })
  await page.close()
  await browser.disconnect()
  console.log('shot ->', out)
})().catch((e) => {
  console.error(e)
  process.exit(1)
})
