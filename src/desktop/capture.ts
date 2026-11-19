import { Readability } from '@mozilla/readability'
import { ipcRenderer, webFrame } from 'electron'
import type { Block, CaptureMode, CaptureReply, Snapshot } from '../shared/model'

// This sandboxed guest preload accepts capture requests only from the main process.
let cancelPicker: (() => void) | undefined
function rememberSelection(range: Range) {
  const saved = CSS.highlights.get('philosophia-saved') ?? new Highlight()
  if (!saved.size)
    webFrame.insertCSS(
      '::highlight(philosophia-saved){background-color:#e6dc9a;color:#253526}'
    )
  saved.add(range)
  CSS.highlights.set('philosophia-saved', saved)
}
function pickImage(): Promise<number | null> {
  cancelPicker?.()
  return new Promise((resolve) => {
    const old = document.documentElement.style.cursor
    document.documentElement.style.cursor = 'crosshair'
    function done(value: number | null) {
      document.removeEventListener('click', click, true)
      document.removeEventListener('keydown', key, true)
      document.documentElement.style.cursor = old
      cancelPicker = undefined
      resolve(value)
    }
    function click(e: MouseEvent) {
      e.preventDefault()
      e.stopImmediatePropagation()
      const img = e.composedPath().find((el) => el instanceof HTMLImageElement)
      if (img instanceof HTMLImageElement)
        done(Array.from(document.images).indexOf(img))
    }
    function key(e: KeyboardEvent) {
      if (e.key === 'Escape') done(null)
    }
    cancelPicker = () => done(null)
    document.addEventListener('click', click, true)
    document.addEventListener('keydown', key, true)
  })
}
function twin(original: Node, copy: Document): Node | null {
  const path: number[] = []
  for (let n: Node | null = original; n && n !== document; n = n.parentNode) {
    if (!n.parentNode) return null
    path.unshift(Array.prototype.indexOf.call(n.parentNode.childNodes, n))
  }
  return path.reduce<Node | null>(
    (node, i) => node?.childNodes[i] ?? null,
    copy
  )
}
function snapshot(mode: CaptureMode, chosen = -1): Snapshot {
  const selection = window.getSelection()
  const quote = mode === 'highlight' ? selection?.toString() : undefined
  if (mode === 'highlight' && (!quote?.trim() || !selection?.rangeCount))
    throw Error('Select the passage you want to save.')
  const copy = document.cloneNode(true) as Document
  const token = 'PHI' + crypto.getRandomValues(new Uint32Array(2)).join('X')
  const a = token + 'START',
    z = token + 'END'
  if (quote && selection) {
    const range = selection.getRangeAt(0),
      start = twin(range.startContainer, copy),
      end = twin(range.endContainer, copy)
    if (start && end) {
      const rr = copy.createRange()
      rr.setStart(start, range.startOffset)
      rr.setEnd(end, range.endOffset)
      const tail = rr.cloneRange()
      tail.collapse(false)
      tail.insertNode(copy.createTextNode(z))
      rr.collapse(true)
      rr.insertNode(copy.createTextNode(a))
    }
  }
  const imageCopies = Array.from(copy.images)
  for (const [i, el] of Array.from(document.images).entries()) {
    const target = imageCopies[i]
    if (!target) continue
    const raw =
      el.currentSrc || el.getAttribute('data-src') || el.getAttribute('src')
    if (!raw) continue
    try {
      target.setAttribute('src', new URL(raw, document.baseURI).href)
    } catch {
      continue
    }
    target.removeAttribute('srcset')
    if (i === chosen) target.setAttribute('data-philosophia-selected', token)
  }
  // Mark hidden elements on the detached copy before extracting text. Site
  // stylesheets and responsive visibility rules no longer apply to that copy.
  const originals = document.querySelectorAll('*')
  const copies = copy.querySelectorAll('*')
  for (let i = 0; i < originals.length; i++) {
    const style = getComputedStyle(originals[i])
    if (style.display === 'none' || style.visibility === 'hidden')
      copies[i]?.setAttribute('hidden', '')
  }
  copy
    .querySelectorAll(
      'script,style,noscript,template,iframe,form,[hidden],[aria-hidden="true"]'
    )
    .forEach((e) => e.remove())
  const container = copy.createElement('div')
  const article = new Readability(copy.cloneNode(true) as Document, {
    charThreshold: 50
  }).parse()
  container.innerHTML = article?.content || ''
  let root: Element = container
  if (!root.textContent?.trim() && !root.querySelector('img')) root = copy.body
  if (
    quote &&
    (!root.textContent?.includes(a) || !root.textContent?.includes(z))
  )
    root = copy.body
  if (mode === 'image' && !root.querySelector('[data-philosophia-selected]'))
    root = copy.body
  const blocks: Block[] = []
  let content = '',
    style: 'heading' | 'text' = 'text',
    imageIndex: number | undefined
  const flush = () => {
    const text = content.replace(/\s+/g, ' ').trim()
    if (text) blocks.push({ kind: style, text })
    content = ''
  }
  const visit = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      content += node.textContent
      return
    }
    if (!(node instanceof Element)) return
    const tag = node.tagName
    if (tag === 'IMG') {
      const src = node.getAttribute('src') || ''
      if (!/^(https?:|data:image\/)/i.test(src)) return
      flush()
      const text =
        node
          .closest('figure')
          ?.querySelector('figcaption')
          ?.textContent?.trim() ||
        node.getAttribute('alt') ||
        'Image'
      if (node.getAttribute('data-philosophia-selected') === token)
        imageIndex = blocks.length
      blocks.push({ kind: 'image', src, text })
      return
    }
    if (tag === 'FIGCAPTION' && node.parentElement?.querySelector('img')) return
    const line =
      /^(DIV|P|H[1-6]|SECTION|ARTICLE|MAIN|ASIDE|LI|BLOCKQUOTE|FIGURE|BR|TR|PRE|HR)$/.test(
        tag
      )
    if (line) flush()
    const previous = style
    if (/^H[1-6]$/.test(tag)) style = 'heading'
    for (const child of node.childNodes) visit(child)
    if (line) flush()
    style = previous
  }
  visit(root)
  flush()
  let start = -1,
    end = -1,
    cursor = 0
  for (const b of blocks) {
    const x = b.text.indexOf(a)
    if (x >= 0) {
      start = cursor + x
      b.text = b.text.replace(a, '')
    }
    const y = b.text.indexOf(z)
    if (y >= 0) {
      end = cursor + y
      b.text = b.text.replace(z, '')
    }
    cursor += b.text.length + 1
  }
  if (quote && (start < 0 || end <= start)) {
    start = cursor
    end = start + quote.length
    blocks.push({ kind: 'text', text: quote })
  }
  if (mode === 'image' && imageIndex === undefined)
    throw Error('This image could not be captured. Try another image.')
  return {
    url: location.href,
    title: article?.title || document.title || location.hostname,
    blocks,
    quote,
    anchor: quote ? { start, end } : undefined,
    imageIndex
  }
}

ipcRenderer.on('cancel-image-pick', () => cancelPicker?.())
ipcRenderer.on('capture-page', async ({ ports: [port] }, mode: CaptureMode) => {
  let reply: CaptureReply
  try {
    const index = mode === 'image' ? await pickImage() : -1
    reply = { snapshot: index === null ? null : snapshot(mode, index) }
    if (mode === 'highlight') {
      const range = window.getSelection()!.getRangeAt(0).cloneRange()
      // The main process acknowledges this particular range after committing it.
      port.onmessage = () => rememberSelection(range)
    }
  } catch (error) {
    reply = { error: error instanceof Error ? error.message : String(error) }
  }
  port.postMessage(reply)
})
