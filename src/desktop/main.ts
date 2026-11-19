import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  protocol,
  session,
  WebContentsView
} from 'electron'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Store } from './store'
import { MediaCache, mediaTypes } from './media'
import {
  webURL,
  type BrowserState,
  type CaptureMode,
  type Commands,
  type Command,
  type Bounds,
  type Snapshot
} from '../shared/model'

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'philosophia',
    privileges: { standard: true, secure: true, supportFetchAPI: true }
  }
])
const ui = 'philosophia://app/index.html'
app.commandLine.removeSwitch('no-sandbox')
app.enableSandbox()
app.setName('Philosophia')
let store: Store
let cache: MediaCache
async function windowForStudy() {
  const win = new BrowserWindow({
    width: 1350,
    height: 890,
    minWidth: 940,
    minHeight: 660,
    backgroundColor: '#f6f5ee',
    title: 'Philosophia',
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  const guest = new WebContentsView({
    webPreferences: {
      partition: 'persist:philosophia-browser',
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true
    }
  })
  const web = guest.webContents
  const browserSession = web.session
  browserSession.setPermissionRequestHandler((_wc, _permission, done) =>
    done(false)
  )
  browserSession.setPermissionCheckHandler(() => false)
  browserSession.on('will-download', (e) => e.preventDefault())
  const allowed = (url: string) => {
    try {
      webURL(url)
      return true
    } catch {
      return false
    }
  }
  web.on('will-navigate', (e) => {
    if (!allowed(e.url)) e.preventDefault()
  })
  web.on('will-redirect', (e) => {
    if (!allowed(e.url)) e.preventDefault()
  })
  web.setWindowOpenHandler(({ url }) => {
    if (allowed(url)) void navigate(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e) => e.preventDefault())
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  let error = '',
    requested = '',
    attached = false,
    generation = 0
  const state = (): BrowserState => ({
    url:
      web.getURL() && web.getURL() !== 'chrome-error://chromewebdata/'
        ? web.getURL()
        : requested,
    title: web.getTitle(),
    back: web.navigationHistory.canGoBack(),
    forward: web.navigationHistory.canGoForward(),
    busy: web.isLoading(),
    error
  })
  const publish = () => {
    if (!win.isDestroyed() && !web.isDestroyed())
      win.webContents.send('browser-state', state())
  }
  async function navigate(value: string) {
    const url = webURL(value)
    requested = url
    error = ''
    publish()
    try {
      await web.loadURL(url)
    } catch (e) {
      if ((e as { code?: string }).code !== 'ERR_ABORTED') {
        error =
          'Could not load this page. Check the address or your connection.'
        publish()
      }
    }
  }
  web.on('did-navigate', publish)
  web.on('did-navigate-in-page', publish)
  web.on('did-stop-loading', publish)
  web.on('page-title-updated', publish)
  web.on('did-start-navigation', (_e, _url, inPlace, main) => {
    if (main && !inPlace) {
      generation++
      error = ''
    }
    publish()
  })
  web.on('did-fail-load', (_e, code, description, url, isMain) => {
    if (isMain && code !== -3) {
      requested = url
      error = description
      publish()
    }
  })
  const code = await readFile(join(__dirname, 'capture.js'), 'utf8')
  const runGuest = (js: string) =>
    web.executeJavaScriptInIsolatedWorld(1001, [{ code: js }])
  function bounds(rect: Bounds | null) {
    if (!rect) {
      if (attached) {
        win.contentView.removeChildView(guest)
        attached = false
        void runGuest('globalThis.PageCapture?.cancel()').catch(() => {})
      }
      return
    }
    if (![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite))
      throw Error('Invalid browser size.')
    if (!attached) {
      win.contentView.addChildView(guest)
      attached = true
    }
    guest.setBounds({
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.max(1, Math.round(rect.width)),
      height: Math.max(1, Math.round(rect.height))
    })
  }
  async function capture(mode: CaptureMode) {
    if (
      !['article', 'image', 'highlight'].includes(mode) ||
      !allowed(web.getURL()) ||
      error
    )
      throw Error('Open a web page first.')
    const version = generation
    await runGuest(code)
    let index = -1
    if (mode === 'image') {
      const choice = await runGuest('PageCapture.pickImage()')
      if (choice == null) return null
      index = Number(choice)
    }
    if (generation !== version)
      throw Error('The page changed. Select the passage again.')
    const snap: Snapshot = await runGuest(
      'PageCapture.snapshot(' + JSON.stringify(mode) + ',' + index + ')'
    )
    if (generation !== version || snap.url !== web.getURL())
      throw Error('The page changed during capture.')
    const saved = store.capture(snap, mode)
    if (mode === 'highlight' && generation === version) {
      await web
        .insertCSS(
          '::highlight(philosophia-saved){background-color:#e6dc9a;color:#253526}'
        )
        .catch(() => {})
      await runGuest('PageCapture.rememberSelection()').catch(() => {})
    }
    void cache.queue(saved.assets)
    return saved.id
  }
  const commands: {
    [K in Command]: (
      ...args: Commands[K][0]
    ) => Commands[K][1] | Promise<Commands[K][1]>
  } = {
    library: () => store.library(),
    reading: (id) => store.reading(id),
    extract: (...args) => store.extract(...args),
    extractImage: (...args) => store.extractImage(...args),
    edit: (...args) => store.edit(...args),
    position: (...args) => store.position(...args),
    defer: (...args) => store.defer(...args),
    priority: (...args) => store.priority(...args),
    finish: (id) => store.finish(id),
    note: (...args) => store.note(...args),
    workload: (m) => store.workload(m),
    prompt: () => store.prompt(),
    rate: (...args) => store.rate(...args),
    undo: () => store.undo(),
    bounds,
    navigate,
    travel: (a) => {
      if (a === 'back' && web.navigationHistory.canGoBack())
        web.navigationHistory.goBack()
      if (a === 'forward' && web.navigationHistory.canGoForward())
        web.navigationHistory.goForward()
      if (a === 'reload') web.reload()
    },
    browser: state,
    capture,
    cancelPick: async () => {
      await runGuest('globalThis.PageCapture?.cancel()')
    },
    retry: (id) => cache.save(id)
  }
  ipcMain.handle('desk', (event, key: Command, ...args: unknown[]) => {
    if (
      event.sender !== win.webContents ||
      event.senderFrame !== win.webContents.mainFrame ||
      event.senderFrame.url !== ui ||
      !Object.hasOwn(commands, key)
    )
      throw Error('Unavailable command.')
    return (commands[key] as (...values: unknown[]) => unknown)(...args)
  })
  win.on('closed', () => {
    ipcMain.removeHandler('desk')
    if (!web.isDestroyed()) web.close()
  })
  await win.loadURL(ui)
}
app
  .whenReady()
  .then(async () => {
    store = new Store(join(app.getPath('userData'), 'library.sqlite'))
    const profile = session.fromPartition('persist:philosophia-browser')
    const dir = join(app.getPath('userData'), 'media')
    cache = new MediaCache(store, dir, (url, options) =>
      profile.fetch(url instanceof URL ? url.href : url, options)
    )
    const types: Record<string, string> = {
      html: 'text/html',
      js: 'text/javascript',
      css: 'text/css',
      woff2: 'font/woff2',
      woff: 'font/woff',
      ...Object.fromEntries(Object.entries(mediaTypes).map(([k, v]) => [v, k]))
    }
    protocol.handle('philosophia', async (req) => {
      const url = new URL(req.url),
        path = url.pathname.slice(1)
      if (url.hostname !== 'app') return new Response(null, { status: 404 })
      const media =
        /^media\/([a-f0-9]{64}\.(?:png|jpg|gif|avif|webp|svg|bmp|ico))$/.exec(
          path
        )
      if (
        !media &&
        !/^(index\.html|ui\.(css|js)|fonts\/[\w.-]+\.(?:woff|woff2))$/.test(
          path
        )
      )
        return new Response(null, { status: 404 })
      try {
        const data = await readFile(
          media ? join(dir, media[1]) : join(__dirname, path)
        )
        return new Response(new Uint8Array(data), {
          headers: {
            'Content-Type':
              types[path.split('.').pop()!] || 'application/octet-stream',
            'X-Content-Type-Options': 'nosniff',
            ...(media
              ? { 'Content-Security-Policy': "sandbox; default-src 'none'" }
              : {})
          }
        })
      } catch {
        return new Response(null, { status: 404 })
      }
    })
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        ...(process.platform === 'darwin'
          ? [{ role: 'appMenu' as const }]
          : []),
        { role: 'editMenu' },
        { role: 'windowMenu' }
      ])
    )
    await windowForStudy()
    app.on('activate', () => {
      if (!BrowserWindow.getAllWindows().length) void windowForStudy()
    })
  })
  .catch((error) => {
    console.error(error)
    app.exit(1)
  })
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
