import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  Globe2,
  Highlighter,
  ImagePlus,
  LibraryBig,
  LoaderCircle,
  RefreshCw,
  X
} from 'lucide-react'
import { call, type Task } from './common'
import type { BrowserState, CaptureMode } from '../shared/model'
const blank: BrowserState = {
  url: '',
  title: '',
  busy: false,
  error: '',
  back: false,
  forward: false
}
export function Browser({
  initial,
  opened,
  refresh,
  task
}: {
  initial: string
  opened: (id: number) => void
  refresh: () => Promise<void>
  task: Task
}) {
  const [state, set] = useState(blank),
    [address, addr] = useState(initial),
    [mode, setMode] = useState<CaptureMode | null>(null)
  const [captureError, setError] = useState('')
  const [saved, setSaved] = useState<{ id: number; mode: CaptureMode } | null>(
    null
  )
  const surface = useRef<HTMLDivElement>(null)
  useEffect(() => {
    let active = true
    const off = window.desk.onBrowser(set)
    void call('browser').then((s) => {
      if (active) set(s)
    })
    if (initial) task(() => call('navigate', initial))
    return () => {
      active = false
      off()
    }
  }, [])
  useEffect(() => {
    if (state.url) addr(state.url)
    setSaved(null)
    setError('')
  }, [state.url])
  const visible = !!state.url && !state.error
  useLayoutEffect(() => {
    const el = surface.current
    if (!el || !visible) {
      void call('bounds', null)
      return
    }
    function place() {
      const { x, y, width, height } = el!.getBoundingClientRect()
      void call('bounds', { x, y, width, height })
    }
    place()
    const observer = new ResizeObserver(place)
    observer.observe(el)
    window.addEventListener('resize', place)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', place)
      void call('bounds', null)
    }
  }, [visible])
  function navigate(value: string) {
    let url = value.trim()
    if (!url) return
    if (!/^[\w+.-]+:/.test(url)) url = 'https://' + url
    task(() => call('navigate', url))
  }
  function capture(type: CaptureMode) {
    setMode(type)
    setSaved(null)
    setError('')
    task(async () => {
      try {
        const id = await call('capture', type)
        if (id !== null) {
          setSaved({ id, mode: type })
          await refresh()
        }
      } catch (error) {
        setError(
          String((error as Error).message).replace(
            /^Error invoking remote method 'desk': (Error: )?/,
            ''
          )
        )
      } finally {
        setMode(null)
      }
    })
  }
  return (
    <div className="browser-page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Capture</p>
          <h1>Web browser</h1>
        </div>
      </div>
      <div className="browser-shell">
        <form
          className="address"
          onSubmit={(e) => {
            e.preventDefault()
            navigate(address)
          }}
        >
          <button
            type="button"
            className="icon"
            aria-label="Back"
            disabled={!state.back}
            onClick={() => task(() => call('travel', 'back'))}
          >
            <ArrowLeft />
          </button>
          <button
            type="button"
            className="icon"
            aria-label="Forward"
            disabled={!state.forward}
            onClick={() => task(() => call('travel', 'forward'))}
          >
            <ArrowRight />
          </button>
          <button
            type="button"
            className="icon"
            aria-label="Reload"
            disabled={!state.url}
            onClick={() => task(() => call('travel', 'reload'))}
          >
            <RefreshCw />
          </button>
          <label>
            <Globe2 />
            <input
              aria-label="Web address"
              placeholder="Enter a web address"
              value={address}
              onChange={(e) => addr(e.target.value)}
            />
          </label>
          <button className="primary slim">
            Go <ArrowRight />
          </button>
        </form>
        <div className="capture-bar">
          {(
            [
              ['article', BookOpen, 'Save article'],
              ['highlight', Highlighter, 'Highlight selection'],
              ['image', ImagePlus, 'Save image']
            ] as const
          ).map(([k, I, t]) => (
            <button
              key={k}
              disabled={!visible || !!mode}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => capture(k)}
            >
              <I />
              {t}
            </button>
          ))}
        </div>
        {mode === 'image' && (
          <div className="inline-note">
            Click an image on the page to save it.
            <button onClick={() => task(() => call('cancelPick'))}>
              <X /> Cancel
            </button>
          </div>
        )}
        {mode && mode !== 'image' && (
          <div className="inline-note">
            <LoaderCircle size={16} /> Saving…
          </div>
        )}
        {captureError && (
          <div role="alert" className="inline-note">
            {captureError}
            <button onClick={() => setError('')}>Dismiss</button>
          </div>
        )}
        {saved && (
          <div className="inline-note">
            <span>
              <Check />{' '}
              {saved.mode === 'article'
                ? 'Article'
                : saved.mode === 'image'
                  ? 'Image'
                  : 'Highlight'}{' '}
              saved to your library
            </span>
            <button onClick={() => opened(saved.id)}>
              Open in reader <ArrowRight />
            </button>
          </div>
        )}
        {visible ? (
          <div className="guest-surface" ref={surface} />
        ) : (
          <div className="browser-empty">
            <div className="icon-tile">
              <Globe2 />
            </div>
            <h2>
              {state.error
                ? 'Page unavailable'
                : 'Find something worth keeping.'}
            </h2>
            <p>
              {state.error ||
                'Open a web page, then save an article, passage, or image to your library.'}
            </p>
            {state.error ? (
              <button onClick={() => navigate(address)}>Try again</button>
            ) : (
              <div className="suggestions">
                <button
                  onClick={() =>
                    navigate(
                      'https://en.wikipedia.org/wiki/Incremental_reading'
                    )
                  }
                >
                  <BookOpen />
                  Wikipedia
                </button>
                <button onClick={() => navigate('https://www.gutenberg.org/')}>
                  <LibraryBig />
                  Project Gutenberg
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
