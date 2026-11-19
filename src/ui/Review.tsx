import { useEffect, useRef, useState } from 'react'
import { ArrowRight, BookOpen, Check, Layers, RotateCcw } from 'lucide-react'
import { call, ClozeText, type Task } from './common'
import type { Grade, Prompt, Workload } from '../shared/model'
export function Review({
  work,
  refresh,
  open,
  home,
  task
}: {
  work: Workload
  refresh: () => Promise<void>
  open: (id: number) => void
  home: () => void
  task: Task
}) {
  const [card, set] = useState<Prompt | null>(null),
    [loading, spin] = useState(true),
    [shown, show] = useState(false)
  const locked = useRef(false)
  const load = async () => {
    set(await call('prompt'))
    show(false)
    spin(false)
  }
  useEffect(() => {
    task(load)
  }, [])
  useEffect(() => {
    if (card || loading) return
    const t = setInterval(() => task(load), 10000)
    return () => clearInterval(t)
  }, [card, loading])
  function change(fn: () => Promise<void>) {
    if (locked.current) return
    locked.current = true
    task(async () => {
      try {
        await fn()
        await load()
        await refresh()
      } finally {
        locked.current = false
      }
    })
  }
  function rate(n: Grade) {
    if (card && shown) change(() => call('rate', card.id, card.revision, n))
  }
  useEffect(() => {
    function key(e: KeyboardEvent) {
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || !card) return
      if (e.code === 'Space' && !shown) {
        e.preventDefault()
        show(true)
      } else if (shown && /^[1-4]$/.test(e.key)) {
        e.preventDefault()
        rate(Number(e.key) as Grade)
      }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [card, shown])
  return (
    <div className="review-page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Spaced repetition</p>
          <h1>Card review</h1>
        </div>
        <button
          disabled={!work.canUndo}
          onClick={() => change(() => call('undo'))}
        >
          <RotateCcw />
          Undo last rating
        </button>
      </div>
      <div className="review-stats">
        <span>
          <i className="dot" /> {work.overdue + work.ready} due
        </span>
        <span>{work.fresh} new</span>
        <span>{work.later} later today</span>
      </div>
      <section className="review-sheet">
        {loading ? (
          <p>Opening review…</p>
        ) : card ? (
          <>
            <div className="eyebrow">
              <Layers />
              Cloze card
            </div>
            <div className="question">
              <ClozeText text={card.text} group={card.group} reveal={shown} />
            </div>
            {shown ? (
              <>
                <div className="rate-buttons">
                  {(['Again', 'Hard', 'Good', 'Easy'] as const).map(
                    (name, i) => (
                      <button key={name} onClick={() => rate((i + 1) as Grade)}>
                        <small>{card.intervals[i]}</small>
                        <b>{name}</b>
                        <kbd>{i + 1}</kbd>
                      </button>
                    )
                  )}
                </div>
                <div className="review-links">
                  <button
                    className="textbtn"
                    onClick={() => open(card.extract)}
                  >
                    Open extract <ArrowRight />
                  </button>
                  <button className="textbtn" onClick={() => open(card.root)}>
                    Source article <ArrowRight />
                  </button>
                </div>
              </>
            ) : (
              <button className="primary reveal" onClick={() => show(true)}>
                Show answer <kbd>Space</kbd>
              </button>
            )}
          </>
        ) : (
          <div className="review-empty">
            <div className="icon-tile">
              <Check />
            </div>
            <h2>{work.studied ? 'Review complete' : 'No cards ready'}</h2>
            <p>
              {work.later
                ? 'More cards become available later today.'
                : 'Make a cloze card from a saved extract to study it here.'}
            </p>
            <button onClick={home}>
              <BookOpen />
              Return to study desk
            </button>
          </div>
        )}
      </section>
    </div>
  )
}
