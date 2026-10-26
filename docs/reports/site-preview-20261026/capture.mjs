// 站点截图脚本：抓取 read.thinkstu.com 的关键页面整页截图，用于人工查看站点现状。
import pw from '/Users/wang/.workbuddy-ai/binaries/node/workspace/node_modules/playwright-core/index.js'
const { chromium } = pw
import fs from 'node:fs/promises'
import path from 'node:path'

const OUT = '/Users/wang/worker/english/FluentRead/docs/reports/site-preview-20261026'
const EXEC = `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`

const targets = [
  { name: '01-home-zh', url: 'https://read.thinkstu.com/', w: 1440, h: 900 },
  { name: '02-docs-index', url: 'https://read.thinkstu.com/docs/', w: 1440, h: 900 },
  { name: '03-features', url: 'https://read.thinkstu.com/guide/features', w: 1440, h: 900 },
  { name: '04-getting-started', url: 'https://read.thinkstu.com/guide/getting-started', w: 1440, h: 900 },
  { name: '05-home-en', url: 'https://read.thinkstu.com/en/', w: 1440, h: 900 },
  { name: '06-home-mobile', url: 'https://read.thinkstu.com/', w: 390, h: 844 },
  { name: '07-webpage-translation', url: 'https://read.thinkstu.com/guide/webpage-translation', w: 1440, h: 900 },
  { name: '08-design-system', url: 'https://read.thinkstu.com/guide/design-system', w: 1440, h: 900 },
]

const browser = await chromium.launch({ executablePath: EXEC })
const results = []
for (const t of targets) {
  const ctx = await browser.newContext({
    viewport: { width: t.w, height: t.h },
    deviceScaleFactor: 1,
    isMobile: t.name.includes('mobile'),
    hasTouch: t.name.includes('mobile'),
  })
  const page = await ctx.newPage()
  await page.goto(t.url, { waitUntil: 'networkidle', timeout: 60000 })
  await page.evaluate(() => document.fonts.ready)
  // 滚动一遍触发进场动画，再回到顶部整页截图
  await page.evaluate(async () => {
    const step = window.innerHeight * 0.8
    for (let y = 0; y < document.body.scrollHeight; y += step) {
      window.scrollTo(0, y)
      await new Promise((r) => setTimeout(r, 120))
    }
    window.scrollTo(0, 0)
    await new Promise((r) => setTimeout(r, 600))
  })
  const file = path.join(OUT, `${t.name}.png`)
  await page.screenshot({ path: file, fullPage: true })
  const size = await page.evaluate(() => ({ h: document.body.scrollHeight, title: document.title }))
  results.push({ ...t, file, ...size })
  await ctx.close()
}
await browser.close()
await fs.writeFile(path.join(OUT, 'capture.json'), JSON.stringify(results, null, 2))
console.log(results.map((r) => `${r.name}\t${r.title}\t${r.w}x${r.h} -> full ${r.h}px`).join('\n'))
