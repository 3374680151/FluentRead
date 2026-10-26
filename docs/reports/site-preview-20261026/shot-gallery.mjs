import pw from '/Users/wang/.workbuddy-ai/binaries/node/workspace/node_modules/playwright-core/index.js'
const EXEC = `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`
const b = await pw.chromium.launch({ executablePath: EXEC })
const p = await b.newPage({ viewport: { width: 1440, height: 1000 } })
await p.goto('file:///Users/wang/worker/english/FluentRead/docs/reports/site-preview-20261026/index.html', { waitUntil: 'load' })
await p.waitForTimeout(1200)
await p.screenshot({ path: 'gallery-top.png' })
const broken = await p.evaluate(() => [...document.images].filter(i => !i.complete || i.naturalWidth === 0).map(i => i.src))
console.log('broken images:', broken)
await b.close()
