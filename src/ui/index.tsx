import { createRoot } from 'react-dom/client'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ArrowRight,
  ArrowUpRight,
  BookMarked,
  BookOpen,
  CalendarDays,
  Check,
  ChevronRight,
  CircleAlert,
  Feather,
  Globe2,
  Highlighter,
  Layers,
  LayoutDashboard,
  LibraryBig,
  Monitor,
  Search,
  X
} from 'lucide-react'
import {
  studyDay,
  type Anchor,
  type Entry,
  type Workload
} from '../shared/model'
import { Browser } from './Browser'
import { Calendar } from './Calendar'
import { Reader } from './Reader'
import { Review } from './Review'
import { call, domain, Empty, prettyDay, type Task } from './common'
import '@fontsource/dm-sans/latin-400.css'
import '@fontsource/dm-sans/latin-500.css'
import '@fontsource/dm-sans/latin-600.css'
import '@fontsource/spectral/latin-500.css'
import '@fontsource/spectral/latin-400-italic.css'
import './style.css'
type Page = 'home' | 'library' | 'browser' | 'review' | 'calendar' | 'reader'
const nav = [
  ['home', 'Study desk', LayoutDashboard],
  ['browser', 'Web browser', Globe2],
  ['library', 'Reading library', LibraryBig],
  ['review', 'Card review', Layers],
  ['calendar', 'Calendar', CalendarDays]
] as const
const zero: Workload = {
  days: {},
  overdue: 0,
  ready: 0,
  later: 0,
  fresh: 0,
  studied: 0,
  canUndo: false
}
function EntryRow({
  entry,
  open
}: {
  entry: Entry
  open: (id: number) => void
}) {
  const Icon = entry.kind === 'article' ? BookOpen : Highlighter
  return (
    <button className="entry-row" onClick={() => open(entry.id)}>
      <span className={'entry-icon ' + entry.kind}>
        <Icon />
      </span>
      <span className="entry-main">
        <strong>{entry.title}</strong>
        <small>
          {domain(entry.source)} ·{' '}
          {entry.kind === 'article' ? 'Article' : 'Extract'}
        </small>
      </span>
      <ChevronRight size={15} />
    </button>
  )
}
function Library({
  entries,
  open,
  browse,
  today
}: {
  entries: Entry[]
  open: (id: number) => void
  browse: () => void
  today: string
}) {
  const [tab, setTab] = useState('All'),
    [query, search] = useState('')
  const list = entries.filter(
    (e) =>
      (tab === 'All' ||
        (tab === 'Due to read' && !e.finished && e.due <= today) ||
        (tab === 'Articles' && e.kind === 'article') ||
        (tab === 'Extracts' && e.kind === 'extract') ||
        (tab === 'Finished' && e.finished)) &&
      (e.title + ' ' + e.source).toLowerCase().includes(query.toLowerCase())
  )
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">Collection</p>
          <h1>Reading library</h1>
        </div>
        <button className="primary" onClick={browse}>
          <Globe2 />
          Browse the web
        </button>
      </div>
      <div className="library-tools">
        <div className="tabs">
          {['All', 'Due to read', 'Articles', 'Extracts', 'Finished'].map(
            (t) => (
              <button
                className={tab === t ? 'active' : ''}
                key={t}
                onClick={() => setTab(t)}
              >
                {t}
              </button>
            )
          )}
        </div>
        <label className="search">
          <Search />
          <input
            placeholder="Search library"
            aria-label="Search library"
            value={query}
            onChange={(e) => search(e.target.value)}
          />
        </label>
      </div>
      <section className="panel library-list">
        {list.length ? (
          list.map((e) => <EntryRow key={e.id} entry={e} open={open} />)
        ) : (
          <Empty
            title={
              entries.length ? 'No matching readings' : 'Your library is ready'
            }
          >
            <p>
              {entries.length
                ? 'Try another filter or search.'
                : 'Save an article in the web browser to begin reading offline.'}
            </p>
            {!entries.length && (
              <button onClick={browse}>
                Open web browser <ArrowRight />
              </button>
            )}
          </Empty>
        )}
      </section>
    </>
  )
}
function App() {
  const [page, route] = useState<Page>('home'),
    [entries, setEntries] = useState<Entry[]>([]),
    [work, setWork] = useState(zero)
  const [today, setToday] = useState(() => studyDay(new Date())),
    [month, setMonth] = useState(today.slice(0, 7)),
    [day, setDay] = useState(today)
  const [reading, setReading] = useState<{ id: number; jump?: Anchor }>({
      id: 0
    }),
    [browserURL, url] = useState('')
  const [toast, message] = useState<{ value: string; error?: boolean } | null>(
      null
    ),
    timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const epoch = useRef(0)
  const notify = useCallback((value: string, error = false) => {
    clearTimeout(timer.current)
    message({ value, error })
    timer.current = setTimeout(() => message(null), 6500)
  }, [])
  const task: Task = useCallback(
    (fn) => {
      void fn().catch((e) =>
        notify(
          String(e?.message || e).replace(
            /^Error invoking remote method 'desk': Error: /,
            ''
          ),
          true
        )
      )
    },
    [notify]
  )
  const refresh = useCallback(async () => {
    const seq = ++epoch.current
    const [items, w] = await Promise.all([
      call('library'),
      call('workload', month)
    ])
    if (seq === epoch.current) {
      setEntries(items)
      setWork(w)
    }
  }, [month])
  useEffect(() => {
    task(refresh)
    const t = setInterval(() => {
      const now = studyDay(new Date())
      if (now !== today) {
        setToday(now)
        if (day === today) {
          setDay(now)
          setMonth(now.slice(0, 7))
        }
      }
      task(refresh)
    }, 15000)
    return () => {
      clearInterval(t)
      epoch.current++
    }
  }, [refresh, today, day])
  const queue = entries.filter((e) => !e.finished && e.due <= today)
  const due = work.ready + work.overdue
  function go(p: Page) {
    if (p === 'browser') url('')
    route(p)
  }
  function open(id: number, jump?: Anchor) {
    setReading({ id, jump })
    route('reader')
  }
  function browse(value = '') {
    url(value)
    route('browser')
  }
  const calendar = (large = false) => (
    <Calendar
      {...{ month, day, today, large }}
      load={work}
      change={setMonth}
      select={setDay}
      inspect={() => {
        if (!large) route('calendar')
      }}
      start={() => go('review')}
    />
  )
  const pageTitle = nav.find((n) => n[0] === page)?.[1] || 'Reader'
  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <i>
            <Feather size={23} />
          </i>
          <span>Philosophia</span>
        </div>
        <div className="nav-heading">Workspace</div>
        <nav>
          {nav.map(([key, label, Icon]) => (
            <button
              key={key}
              className={
                page === key || (page === 'reader' && key === 'library')
                  ? 'active'
                  : ''
              }
              onClick={() => go(key)}
            >
              <Icon />
              <span>{label}</span>
              {key === 'review' && due > 0 && <small>{due}</small>}
            </button>
          ))}
        </nav>
        <div className="sidebar-end">
          <div className="local-mark">
            <Monitor />
          </div>
          <div>
            <strong>Local workspace</strong>
            <small>
              <i className="dot" /> On this device
            </small>
          </div>
        </div>
      </aside>
      <main>
        <header className="topline">
          <div>
            <span>Workspace</span>
            <ChevronRight />
            {pageTitle}
          </div>
          <span className="top-date">
            <CalendarDays />
            {prettyDay(today, {
              weekday: 'short',
              month: 'short',
              day: 'numeric',
              year: 'numeric'
            })}
          </span>
        </header>
        <div
          className={
            'content ' +
            (page === 'browser' || page === 'reader' ? 'fixed-content' : '')
          }
          key={page}
        >
          {page === 'home' && (
            <>
              <div className="page-heading">
                <div>
                  <p className="eyebrow">
                    <span className="line" />
                    Daily overview
                  </p>
                  <h1>Study desk</h1>
                </div>
                <button className="primary" onClick={() => browse()}>
                  <Globe2 />
                  Browse the web <ArrowUpRight />
                </button>
              </div>
              <div className="session-cards">
                <section className="session review-tile">
                  <div className="art card-art" aria-hidden="true">
                    <i />
                    <i />
                    <i>
                      <b />
                      <b />
                      <b />
                    </i>
                  </div>
                  <div className="session-label">
                    <Layers />
                    Spaced repetition
                  </div>
                  <h2>Card review</h2>
                  <p>
                    <b>{due}</b> due now <span /> <b>{work.fresh}</b> new
                  </p>
                  <button onClick={() => go('review')}>
                    Review cards <ArrowRight />
                  </button>
                </section>
                <section className="session reading-tile">
                  <div className="art book-art" aria-hidden="true">
                    <i />
                    <i />
                  </div>
                  <div className="session-label">
                    <BookOpen />
                    Incremental reading
                  </div>
                  <h2>Reading queue</h2>
                  <p>
                    <b>{queue.length}</b>{' '}
                    {queue.length === 1 ? 'reading' : 'readings'} ready to
                    revisit
                  </p>
                  <button
                    onClick={() =>
                      queue.length ? open(queue[0].id) : go('library')
                    }
                  >
                    Continue reading <ArrowRight />
                  </button>
                </section>
              </div>
              <div className="desk-grid">
                {calendar()}
                <section className="panel recent">
                  <div className="panel-head">
                    <h2>
                      <LibraryBig />
                      Recent readings
                    </h2>
                    <button className="textbtn" onClick={() => go('library')}>
                      View all <ArrowUpRight />
                    </button>
                  </div>
                  {entries.length ? (
                    <div>
                      {[...entries]
                        .sort((a, b) => b.id - a.id)
                        .slice(0, 5)
                        .map((e) => (
                          <EntryRow key={e.id} entry={e} open={open} />
                        ))}
                    </div>
                  ) : (
                    <div className="recent-empty">
                      <div className="shelf-icon">
                        <BookMarked />
                        <BookOpen />
                      </div>
                      <h3>Your first reading starts here</h3>
                      <p>
                        Save a page or highlight a passage as you browse. Your
                        readings will appear here.
                      </p>
                      <button className="textbtn" onClick={() => browse()}>
                        Open web browser <ArrowRight />
                      </button>
                    </div>
                  )}
                </section>
              </div>
            </>
          )}
          {page === 'library' && (
            <Library
              entries={entries}
              today={today}
              open={open}
              browse={() => browse()}
            />
          )}
          {page === 'calendar' && (
            <>
              <div className="page-heading">
                <div>
                  <p className="eyebrow">Review schedule</p>
                  <h1>Calendar</h1>
                </div>
              </div>
              {calendar(true)}
            </>
          )}
          {page === 'browser' && (
            <Browser
              initial={browserURL}
              opened={open}
              refresh={refresh}
              task={task}
            />
          )}
          {page === 'reader' && (
            <Reader
              key={reading.id + ':' + (reading.jump?.start ?? '')}
              {...reading}
              open={open}
              back={() => go('library')}
              browse={browse}
              refresh={refresh}
              task={task}
              notify={notify}
            />
          )}
          {page === 'review' && (
            <Review
              work={work}
              open={open}
              refresh={refresh}
              task={task}
              home={() => go('home')}
            />
          )}
        </div>
      </main>
      {toast && (
        <div
          role={toast.error ? 'alert' : 'status'}
          className={'toast ' + (toast.error ? 'error' : '')}
        >
          {toast.error ? <CircleAlert /> : <Check />}
          {toast.value}
          <button
            className="icon"
            aria-label="Dismiss message"
            onClick={() => message(null)}
          >
            <X />
          </button>
        </div>
      )}
    </div>
  )
}
createRoot(document.getElementById('root')!).render(<App />)
