import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react'
import { dateKey, localDate } from '../shared/model'
import type { Workload } from '../shared/model'
import { prettyDay } from './common'
export function Calendar({
  month,
  change,
  day,
  select,
  inspect,
  today,
  load,
  large = false,
  start
}: {
  month: string
  change: (m: string) => void
  day: string
  select: (s: string) => void
  inspect: () => void
  today: string
  load: Workload
  large?: boolean
  start: () => void
}) {
  const first = localDate(month + '-01'),
    offset = (first.getDay() + 6) % 7
  const last = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate()
  const jump = (n: number) => {
    const d = new Date(first)
    d.setMonth(d.getMonth() + n)
    const m = dateKey(d).slice(0, 7)
    change(m)
    select(m === today.slice(0, 7) ? today : m + '-01')
  }
  const total = Object.values(load.days).reduce((a, b) => a + b, 0)
  return (
    <section className={'panel calendar ' + (large ? 'large' : '')}>
      <div className="panel-head">
        <h2>
          <CalendarDays />
          Review calendar
        </h2>
        <div className="month-controls">
          <button
            className="icon"
            aria-label="Previous month"
            onClick={() => jump(-1)}
          >
            <ChevronLeft />
          </button>
          <strong>
            {prettyDay(month + '-01', { month: 'long', year: 'numeric' })}
          </strong>
          <button
            className="icon"
            aria-label="Next month"
            onClick={() => jump(1)}
          >
            <ChevronRight />
          </button>
        </div>
      </div>
      <div className="week">
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
          <span key={d}>{d}</span>
        ))}
      </div>
      <div className="dates">
        {Array.from({ length: Math.ceil((last + offset) / 7) * 7 }, (_, i) => {
          const n = i - offset + 1
          if (n < 1 || n > last) return <span className="outside" key={i} />
          const key = month + '-' + String(n).padStart(2, '0'),
            count = load.days[key] || 0
          return (
            <button
              aria-label={key + ', ' + count + ' scheduled cards'}
              aria-pressed={key === day}
              className={
                (key === day ? 'selected ' : '') +
                (key === today ? 'today' : '')
              }
              key={i}
              onClick={() => {
                select(key)
                inspect()
              }}
            >
              <span>{n}</span>
              {count > 0 ? (
                <small>{count}</small>
              ) : large ? (
                <small className="zero">0</small>
              ) : null}
            </button>
          )
        })}
      </div>
      <div className="calendar-foot">
        <span>
          <i className="dot" /> {day === today ? 'Today' : prettyDay(day)} ·{' '}
          {load.days[day] || 0} scheduled
        </span>
        <button
          className="textbtn"
          onClick={() => {
            change(today.slice(0, 7))
            select(today)
          }}
        >
          Today
        </button>
      </div>
      {large && (
        <div className="calendar-detail">
          <h3>
            {prettyDay(day, { weekday: 'long', month: 'long', day: 'numeric' })}
          </h3>
          {day === today ? (
            <>
              <div className="numbers">
                {[
                  ['Overdue', load.overdue],
                  ['Ready now', load.ready],
                  ['Later today', load.later],
                  ['New cards', load.fresh]
                ].map(([k, v]) => (
                  <div key={k}>
                    <b>{v}</b>
                    <span>{k}</span>
                  </div>
                ))}
              </div>
              <button className="primary" onClick={start}>
                Review cards
              </button>
            </>
          ) : (
            <p>
              {load.days[day] || 0} cards currently scheduled for this study
              day.
            </p>
          )}
          <p className="muted">
            {total} scheduled this month · Study days begin at 4 am local time.
          </p>
        </div>
      )}
    </section>
  )
}
