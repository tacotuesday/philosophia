import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  Clock3,
  ExternalLink,
  Highlighter,
  ImagePlus,
  Layers,
  Pencil,
  Quote,
  Scissors
} from 'lucide-react'
import {
  clozes,
  flatText,
  groups,
  proposedDate,
  shiftDay,
  studyDay,
  type Anchor,
  type Detail,
  type ImageBlock
} from '../shared/model'
import { call, ClozeText, domain, Modal, prettyDay, type Task } from './common'
function marked(
  text: string,
  start: number,
  highlights: Anchor[],
  jump?: Anchor
) {
  const end = start + text.length
  const ranges = [...highlights, ...(jump ? [jump] : [])].filter(
    (r) => r.start < end && r.end > start
  )
  const edges = [
    ...new Set([
      start,
      end,
      ...ranges.flatMap((r) => [Math.max(start, r.start), Math.min(end, r.end)])
    ])
  ].sort((a, b) => a - b)
  return edges.slice(0, -1).map((a, i) => {
    const part = text.slice(a - start, edges[i + 1] - start)
    return ranges.some((r) => r.start <= a && r.end > a) ? (
      <mark
        key={a}
        data-target={
          !!jump && a >= jump.start && a < jump.end ? 'yes' : undefined
        }
      >
        {part}
      </mark>
    ) : (
      <span key={a}>{part}</span>
    )
  })
}
function selectionOffset(node: Node, offset: number) {
  const el = (
    node instanceof Element ? node : node.parentElement
  )?.closest<HTMLElement>('[data-offset]')
  if (!el) return null
  const range = document.createRange()
  range.selectNodeContents(el)
  range.setEnd(node, offset)
  return Number(el.dataset.offset) + range.toString().length
}
function ClozeEditor({
  body,
  selected,
  save,
  close
}: {
  body: string
  selected: Anchor
  save: (s: string) => void
  close: () => void
}) {
  const [text, set] = useState(
    body.slice(0, selected.start) +
      '{{c1::' +
      body.slice(selected.start, selected.end) +
      '}}' +
      body.slice(selected.end)
  )
  const [group, show] = useState(1),
    ref = useRef<HTMLTextAreaElement>(null)
  let nums: number[] = [],
    error = ''
  try {
    nums = groups(clozes(text))
    if (!nums.length) error = 'Add a numbered deletion to create a card.'
  } catch (e) {
    error = (e as Error).message
  }
  function wrap(same: boolean) {
    const el = ref.current!
    if (el.selectionStart === el.selectionEnd) return
    const n = same ? group : (nums.at(-1) || 0) + 1
    set(
      text.slice(0, el.selectionStart) +
        '{{c' +
        n +
        '::' +
        text.slice(el.selectionStart, el.selectionEnd) +
        '}}' +
        text.slice(el.selectionEnd)
    )
    show(n)
  }
  return (
    <Modal title="Create cloze cards" close={close}>
      <label className="field">
        Card text
        <textarea
          ref={ref}
          rows={5}
          value={text}
          onChange={(e) => set(e.target.value)}
        />
      </label>
      <div className="row">
        <button
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => wrap(false)}
        >
          Hide another phrase
        </button>
        <button
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => wrap(true)}
        >
          Hide with this group
        </button>
      </div>
      <div className="preview">
        <div className="row">
          <strong>Card preview</strong>
          {nums.map((n) => (
            <button
              className={
                n === (nums.includes(group) ? group : nums[0]) ? 'current' : ''
              }
              key={n}
              onClick={() => show(n)}
            >
              c{n}
            </button>
          ))}
        </div>
        <p>
          {error || (
            <ClozeText
              text={text}
              group={nums.includes(group) ? group : nums[0]}
            />
          )}
        </p>
      </div>
      <div className="modal-actions">
        <button onClick={close}>Cancel</button>
        <button
          className="primary"
          disabled={!!error}
          onClick={() => save(text)}
        >
          Save {nums.length} {nums.length === 1 ? 'card' : 'cards'}
        </button>
      </div>
    </Modal>
  )
}
export function Reader({
  id,
  jump,
  open,
  back,
  browse,
  refresh,
  task,
  notify
}: {
  id: number
  jump?: Anchor
  open: (id: number, jump?: Anchor) => void
  back: () => void
  browse: (url: string) => void
  refresh: () => Promise<void>
  task: Task
  notify: (s: string) => void
}) {
  const [data, set] = useState<Detail | null>(null),
    [selected, select] = useState<Anchor | null>(null),
    [modal, setModal] = useState(''),
    [working, edit] = useState(''),
    [date, choose] = useState('')
  const pane = useRef<HTMLDivElement>(null),
    latestPosition = useRef<number | null>(null),
    restored = useRef(false)
  const load = async () => set(await call('reading', id))
  useEffect(() => {
    let live = true
    task(async () => {
      const result = await call('reading', id)
      if (live) set(result)
    })
    return () => {
      live = false
    }
  }, [id])
  useEffect(() => {
    if (!data?.blocks.some((b) => b.kind === 'image' && !b.file)) return
    const timer = setInterval(() => {
      void load()
    }, 2000)
    return () => clearInterval(timer)
  }, [data?.blocks.some((b) => b.kind === 'image' && !b.file), id])
  useLayoutEffect(() => {
    if (!data || !pane.current || restored.current) return
    restored.current = true
    const target = pane.current.querySelector<HTMLElement>(
      '[data-target="yes"]'
    )
    if (target) target.scrollIntoView({ block: 'center' })
    else pane.current.scrollTop = data.position
  }, [data, jump])
  useEffect(() => {
    const flush = () => {
      if (latestPosition.current !== null) {
        void call('position', id, latestPosition.current)
        latestPosition.current = null
      }
    }
    const timer = setInterval(flush, 350)
    window.addEventListener('pagehide', flush)
    return () => {
      clearInterval(timer)
      window.removeEventListener('pagehide', flush)
      flush()
    }
  }, [id])
  if (!data) return <p className="muted">Opening reader…</p>
  const isArticle = data.kind === 'article',
    body = isArticle ? flatText(data.blocks) : data.body
  function captureSelection() {
    const sel = window.getSelection()
    if (!sel?.rangeCount || sel.isCollapsed) {
      select(null)
      return
    }
    const r = sel.getRangeAt(0),
      start = selectionOffset(r.startContainer, r.startOffset),
      end = selectionOffset(r.endContainer, r.endOffset)
    select(
      start !== null &&
        end !== null &&
        end > start &&
        body.slice(start, end).trim()
        ? { start, end }
        : null
    )
  }
  async function mutate(fn: () => Promise<unknown>, message: string) {
    await fn()
    setModal('')
    await load()
    await refresh()
    notify(message)
  }
  function figure(b: ImageBlock, i: number, offset?: number) {
    return (
      <figure key={i}>
        {b.file ? (
          <img alt={b.text} src={'philosophia://app/media/' + b.file} />
        ) : (
          <div className="missing">
            Image unavailable offline{' '}
            <button
              onClick={() =>
                task(() =>
                  mutate(() => call('retry', b.asset!), 'Image saved offline')
                )
              }
            >
              Retry image
            </button>
          </div>
        )}
        <figcaption data-offset={offset}>
          {offset !== undefined
            ? marked(b.text, offset, data!.highlights, jump)
            : b.text}
        </figcaption>
        {isArticle && (
          <button
            className="textbtn"
            onClick={() =>
              task(() =>
                mutate(() => call('extractImage', id, i), 'Image extract saved')
              )
            }
          >
            <ImagePlus />
            Save image extract
          </button>
        )}
      </figure>
    )
  }
  let offset = 0
  return (
    <div className="reader-page">
      <div className="reader-top">
        <button className="textbtn" onClick={back}>
          <ArrowLeft />
          Library
        </button>
        <span>{isArticle ? 'Article' : 'Extract'}</span>
        <button className="textbtn" onClick={() => browse(data.source)}>
          {domain(data.source)} <ExternalLink />
        </button>
      </div>
      <div className="reader-tools">
        <button
          disabled={!selected}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() =>
            task(async () => {
              if (!selected) return
              await mutate(
                () =>
                  call(
                    'extract',
                    id,
                    selected.start,
                    selected.end,
                    body.slice(selected.start, selected.end)
                  ),
                'Highlight saved'
              )
              select(null)
              window.getSelection()?.removeAllRanges()
            })
          }
        >
          <Highlighter />
          Highlight selection
        </button>
        {!isArticle && (
          <>
            <button
              disabled={!selected}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setModal('cloze')}
            >
              <Scissors />
              Make cloze
            </button>
            <button
              onClick={() => {
                edit(data.body)
                setModal('edit')
              }}
            >
              <Pencil />
              Edit
            </button>
          </>
        )}
        <div className="spacer" />
        <button
          onClick={() => {
            choose(proposedDate(data.visits))
            setModal('later')
          }}
        >
          <Clock3 />
          Read later
        </button>
        <button
          disabled={!!data.finished}
          onClick={() =>
            task(async () => {
              await call('finish', id)
              await refresh()
              notify('Reading finished')
              back()
            })
          }
        >
          <Check />
          {data.finished ? 'Finished' : 'Finish'}
        </button>
      </div>
      <div
        className="reader-scroll"
        ref={pane}
        onScroll={(e) => {
          latestPosition.current = e.currentTarget.scrollTop
        }}
      >
        <article className="reading-paper">
          <p className="eyebrow">
            {isArticle ? <BookOpen /> : <Quote />}
            {isArticle ? 'Saved article' : 'Working extract'}
          </p>
          <h1>{isArticle ? data.title : 'Reading extract'}</h1>
          <div className="source-line">
            {domain(data.source)} <span>·</span> Saved{' '}
            {new Date(data.created).toLocaleDateString(undefined, {
              month: 'short',
              day: 'numeric',
              year: 'numeric'
            })}
          </div>
          <div
            className="prose"
            onMouseUp={captureSelection}
            onKeyUp={captureSelection}
          >
            {isArticle ? (
              data.blocks.map((b, i) => {
                const start = offset
                offset += b.text.length + 1
                if (b.kind === 'image') return figure(b, i, start)
                const Tag = b.kind === 'heading' ? 'h3' : 'p'
                return (
                  <Tag key={i} data-offset={start}>
                    {marked(b.text, start, data.highlights, jump)}
                  </Tag>
                )
              })
            ) : (
              <>
                <p data-offset={0}>{data.body}</p>
                {data.blocks.map((b, i) => b.kind === 'image' && figure(b, i))}
              </>
            )}
          </div>
          {!isArticle && (
            <aside className="quotation">
              <p className="eyebrow">
                <Quote />
                Original passage
              </p>
              <blockquote>{data.quote}</blockquote>
              <button
                className="textbtn"
                onClick={() => open(data.root!, data.anchor ?? undefined)}
              >
                View in source <ArrowRight />
              </button>
            </aside>
          )}
          <div className="reader-settings">
            <label>
              Reading priority{' '}
              <select
                value={data.priority}
                onChange={(e) => {
                  const v = +e.target.value
                  task(() =>
                    mutate(() => call('priority', id, v), 'Priority updated')
                  )
                }}
              >
                <option value={2}>High</option>
                <option value={1}>Normal</option>
                <option value={0}>Low</option>
              </select>
            </label>
            <span>
              {data.finished
                ? 'Finished'
                : 'Next reading · ' + prettyDay(data.due)}
            </span>
          </div>
          {!!data.children.length && (
            <section className="children">
              <h2>Saved extracts</h2>
              {data.children.map((c) => (
                <button key={c.id} onClick={() => open(c.id)}>
                  <Layers />
                  {c.title}
                  <ArrowRight />
                </button>
              ))}
            </section>
          )}
        </article>
      </div>
      {modal === 'cloze' && selected && (
        <ClozeEditor
          body={body}
          selected={selected}
          close={() => setModal('')}
          save={(text) =>
            task(() =>
              mutate(() => call('note', id, text), 'Cards added to review')
            )
          }
        />
      )}
      {modal === 'edit' && (
        <Modal title="Edit working copy" close={() => setModal('')}>
          <label className="field">
            Passage
            <textarea
              rows={7}
              value={working}
              onChange={(e) => edit(e.target.value)}
            />
          </label>
          <div className="modal-actions">
            <button onClick={() => setModal('')}>Cancel</button>
            <button
              className="primary"
              onClick={() =>
                task(() =>
                  mutate(() => call('edit', id, working), 'Working copy saved')
                )
              }
            >
              Save changes
            </button>
          </div>
        </Modal>
      )}
      {modal === 'later' && (
        <Modal title="Read later" close={() => setModal('')}>
          <label className="field">
            Return to this reading on
            <input
              type="date"
              min={shiftDay(studyDay(new Date()), 1)}
              value={date}
              onChange={(e) => choose(e.target.value)}
            />
          </label>
          <div className="modal-actions">
            <button onClick={() => setModal('')}>Cancel</button>
            <button
              className="primary"
              onClick={() =>
                task(async () => {
                  await call('defer', id, date)
                  await refresh()
                  notify('Reading moved to ' + prettyDay(date))
                  back()
                })
              }
            >
              Save reading date
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}
