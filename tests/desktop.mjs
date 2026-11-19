import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import assert from 'node:assert/strict'
import { once } from 'node:events'

// The fixture server is shut down before the second launch. The real guest view,
// app profile, media cache, review controls and calendar all participate.
const profile = await mkdtemp(join(tmpdir(), 'philosophia-desktop-'))
const phrase = 'Leaves capture light.'
const fixture =
  '<html><head><title>Field notes on leaves</title></head><body><article><h1>Field notes on leaves</h1><p>' +
  phrase +
  '</p><p>These notes compare two samples under different light conditions. The second sample is the one we will return to after closing the browser.</p><p id="target">' +
  phrase +
  '</p><figure><img src="/leaf.png" alt="Leaf sample"><figcaption>Leaf sample</figcaption></figure></article><form><label id="aside">Observation outside the article</label></form></body></html>'
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aRPkAAAAASUVORK5CYII=',
  'base64'
)
const server = createServer((req, res) => {
  if (req.url === '/leaf.png') {
    res.writeHead(200, { 'Content-Type': 'image/png' })
    res.end(png)
  } else {
    res.writeHead(200, { 'Content-Type': 'text/html' })
    res.end(fixture)
  }
})
server.listen(0, '127.0.0.1')
await once(server, 'listening')
const url = 'http://127.0.0.1:' + server.address().port + '/'
let child, browser, page, debugOrigin
const binary = process.env.PHILOSOPHIA_EXECUTABLE
const executable = binary ? resolve(binary) : (await import('electron')).default
async function launch() {
  child = spawn(
    executable,
    [
      ...(binary ? [] : ['.']),
      '--remote-debugging-port=0',
      '--user-data-dir=' + join(profile, 'workspace')
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] }
  )
  const endpoint = await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(Error('Desktop startup timed out')),
      30000
    )
    child.stderr.on('data', (b) => {
      const msg = b.toString()
      const m = msg.match(/DevTools listening on (ws:\/\/[^\s]+)/)
      if (m) {
        clearTimeout(timer)
        resolve(m[1])
      } else if (msg.trim()) console.error(msg.trim())
    })
    child.once('error', reject)
    child.once('exit', (code) => {
      clearTimeout(timer)
      reject(Error('Desktop exited: ' + code))
    })
  })
  debugOrigin = 'http://' + new URL(endpoint).host
  browser = await chromium.connectOverCDP(endpoint)
  await until(() => {
    page = browser
      .contexts()
      .flatMap((c) => c.pages())
      .find((p) => p.url().startsWith('philosophia://app/'))
    return !!page
  }, 'opening the workspace')
  page.setDefaultTimeout(10000)
  page.on('pageerror', (e) => console.error('Renderer:', e.message))
  await page.getByRole('heading', { name: 'Study desk' }).waitFor()
}
async function close() {
  if (browser) await browser.close().catch(() => {})
  if (child && child.exitCode === null && !child.signalCode) {
    const stopped = once(child, 'exit')
    child.kill()
    await stopped
  }
  child = null
  browser = null
}
const button = (name) => page.getByRole('button', { name, exact: true })
async function guest(js) {
  const targets = await (await fetch(debugOrigin + '/json/list')).json()
  const target = targets.find((t) => t.url === url)
  if (!target) throw Error('Fixture browser has not loaded')
  const socket = new WebSocket(target.webSocketDebuggerUrl)
  try {
    await new Promise((ok, fail) => {
      socket.onopen = ok
      socket.onerror = fail
    })
    const reply = new Promise((ok, fail) => {
      socket.onmessage = (e) => {
        const msg = JSON.parse(e.data)
        if (msg.id === 1) {
          if (msg.error || msg.result.exceptionDetails)
            fail(Error(JSON.stringify(msg)))
          else ok(msg.result.result.value)
        }
      }
    })
    socket.send(
      JSON.stringify({
        id: 1,
        method: 'Runtime.evaluate',
        params: { expression: js, returnByValue: true }
      })
    )
    return await reply
  } finally {
    socket.close()
  }
}
async function chooseText(locator, start, end) {
  await locator.evaluate(
    (el, { start, end }) => {
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT),
        node = walker.nextNode()
      const r = document.createRange()
      r.setStart(node, start)
      r.setEnd(node, end)
      getSelection().removeAllRanges()
      getSelection().addRange(r)
      el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
    },
    { start, end }
  )
}
async function until(fn, description) {
  for (let i = 0; i < 80; i++) {
    if (await fn()) return
    await new Promise((r) => setTimeout(r, 100))
  }
  throw Error('Timed out: ' + description)
}
try {
  await launch()
  await mkdir('test-results', { recursive: true })
  await page.screenshot({ path: 'test-results/study-desk.png' })
  await button('Browse the web').click()
  await page.getByRole('textbox', { name: 'Web address' }).fill(url)
  await button('Go').click()
  await until(async () => {
    try {
      return await guest('document.readyState === "complete"')
    } catch {
      return false
    }
  }, 'loading the embedded page')
  assert.equal(
    await guest('typeof window.desk+":"+typeof window.require'),
    'undefined:undefined'
  )
  await button('Save article').click()
  await button('Open in reader').waitFor()
  await guest(
    'const r=document.createRange();r.selectNodeContents(document.querySelector("#target"));getSelection().removeAllRanges();getSelection().addRange(r)'
  )
  await button('Highlight selection').click()
  await page.getByText('Highlight saved to your library').waitFor()
  const extract = await page.evaluate(
    async () =>
      (await window.desk.invoke('library')).find((x) => x.kind === 'extract').id
  )
  await button('Save image').click()
  await page.getByText('Click an image on the page to save it.').waitFor()
  await until(async () => {
    await guest('document.querySelector("img").click()')
    return await page.getByText('Image saved to your library').isVisible()
  }, 'saving a selected image')
  await until(
    () =>
      page.evaluate(async () => {
        const all = await window.desk.invoke('library')
        const r = await window.desk.invoke(
          'reading',
          all.find((x) => x.kind === 'article').id
        )
        return r.blocks.some((b) => b.file)
      }),
    'caching image'
  )
  // This selection sits in a form that is removed by article extraction.
  await guest(
    'const other=document.createRange();other.selectNodeContents(document.querySelector("#aside"));getSelection().removeAllRanges();getSelection().addRange(other)'
  )
  await button('Highlight selection').click()
  await page.getByText('Highlight saved to your library').waitFor()
  const fallback = await page.evaluate(async () => {
    const all = await window.desk.invoke('library')
    const match = all.find((x) => x.title === 'Observation outside the article')
    return (await window.desk.invoke('reading', match.id)).quote
  })
  assert.equal(fallback, 'Observation outside the article')
  await close()
  server.close()
  await once(server, 'close')
  await launch()
  await button('Reading library').click()
  await page.locator('.entry-row').filter({ hasText: phrase }).click()
  await button('View in source').click()
  const mark = page.locator('mark[data-target=yes]').first()
  await mark.waitFor()
  assert.equal(await mark.textContent(), phrase)
  assert.equal(
    await mark.evaluate((el) =>
      Array.from(document.querySelectorAll('.prose p'))
        .filter((p) => p.textContent === el.textContent)
        .indexOf(el.closest('p'))
    ),
    1
  )
  await until(
    () =>
      page
        .locator('.prose img')
        .evaluate((el) => el.complete && el.naturalWidth > 0),
    'offline image'
  )
  await button('Save image extract').click()
  await page.getByText('Image extract saved', { exact: true }).waitFor()
  await chooseText(
    page.locator('.prose p').filter({ hasText: 'These notes' }),
    0,
    11
  )
  await button('Highlight selection').click()
  await page.getByText('Highlight saved', { exact: true }).waitFor()
  await button('Read later').click()
  await button('Save reading date').click()
  await page.getByRole('heading', { name: 'Reading library' }).waitFor()
  await page.locator('.entry-row').filter({ hasText: phrase }).click()
  await chooseText(page.locator('.prose p').first(), 0, 6)
  await button('Make cloze').click()
  const editor = page.getByRole('textbox', { name: 'Card text' })
  assert.equal(await editor.inputValue(), '{{c1::Leaves}} capture light.')
  await editor.fill('{{c1::Leaves}} capture {{c2::light}}.')
  await button('Save 2 cards').click()
  await page.getByText('Cards added to review', { exact: true }).waitFor()
  await button('Card review').click()
  await button('Show answer Space').waitFor()
  const summary = () =>
    page.evaluate(async () => {
      const now = new Date()
      if (now.getHours() < 4) now.setDate(now.getDate() - 1)
      const month =
        now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0')
      return window.desk.invoke('workload', month)
    })
  const before = await summary()
  assert.equal(before.fresh, 2)
  const first = await page.evaluate(() => window.desk.invoke('prompt'))
  assert.equal(first.extract, extract)
  await page.keyboard.press('Space')
  await page.getByRole('button', { name: /Again/ }).waitFor()
  await page.keyboard.press('1')
  await until(async () => (await summary()).fresh === 1, 'recording rating')
  const after = await summary()
  assert.equal(
    Object.values(after.days).reduce((a, b) => a + b, 0),
    1
  )
  const second = await page.evaluate(() => window.desk.invoke('prompt'))
  assert.notEqual(first.id, second.id)
  await button('Calendar').click()
  await page.getByRole('button', { name: /, 1 scheduled cards/ }).waitFor()
  await button('Card review').click()
  await button('Undo last rating').click()
  await until(async () => (await summary()).fresh === 2, 'restoring rating')
  assert.deepEqual(await summary(), before)
  await rm('test-results/failure.png', { force: true })
  console.log(
    'PASS: desktop capture, isolated guest, offline restart, exact passage, cached image, sibling cards, calendar, and undo.'
  )
} catch (error) {
  if (page && !page.isClosed()) {
    console.error((await page.locator('body').innerText()).slice(-4000))
    await page.screenshot({ path: 'test-results/failure.png' }).catch(() => {})
  }
  throw error
} finally {
  await close()
  if (server.listening) server.close()
  await rm(profile, {
    recursive: true,
    force: true,
    maxRetries: 4,
    retryDelay: 150
  })
}
