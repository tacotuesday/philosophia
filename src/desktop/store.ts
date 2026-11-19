import { DatabaseSync } from 'node:sqlite'
import { createHash } from 'node:crypto'
import { fsrs, createEmptyCard, type CardInput } from 'ts-fsrs'
import {
  clozes,
  dateKey,
  flatText,
  groups,
  localDate,
  shiftDay,
  studyDay
} from '../shared/model'
import type {
  Anchor,
  Block,
  Detail,
  Entry,
  Grade,
  Prompt,
  Snapshot,
  Workload
} from '../shared/model'

const columns =
  'id,kind,title,source,parent,root,created,due,visits,priority,finished'
const hash = (value: string) => createHash('sha256').update(value).digest('hex')
const scheduler = fsrs({
  request_retention: 0.9,
  enable_fuzz: false,
  enable_short_term: true
})
type Saved = Entry & {
  blocks: string
  body: string
  quote: string
  start: number | null
  end: number | null
  position: number
}
type CardRow = {
  id: number
  state: string
  revision: number
  due: number | null
}
export class Store {
  db: DatabaseSync
  constructor(
    path: string,
    readonly clock = () => new Date()
  ) {
    this.db = new DatabaseSync(path)
    this.db.exec(
      'PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=4000;'
    )
    const version = Number(
      this.db.prepare('PRAGMA user_version').get()!.user_version
    )
    if (version > 1)
      throw Error('This library requires a newer version of Philosophia.')
    if (!version)
      this.db.exec(`BEGIN;
      CREATE TABLE reading(id INTEGER PRIMARY KEY, kind TEXT NOT NULL, title TEXT NOT NULL, source TEXT NOT NULL,
        parent INTEGER REFERENCES reading, root INTEGER REFERENCES reading, created INTEGER NOT NULL, due TEXT NOT NULL,
        visits INTEGER DEFAULT 0, priority INTEGER DEFAULT 1, finished INTEGER DEFAULT 0, position REAL DEFAULT 0,
        fingerprint TEXT UNIQUE, blocks TEXT DEFAULT '[]', body TEXT DEFAULT '', quote TEXT DEFAULT '', start INTEGER, end INTEGER);
      CREATE TABLE media(id TEXT PRIMARY KEY, url TEXT NOT NULL, file TEXT);
      CREATE TABLE note(id INTEGER PRIMARY KEY, extract INTEGER NOT NULL REFERENCES reading, text TEXT NOT NULL);
      CREATE TABLE card(id INTEGER PRIMARY KEY, note INTEGER NOT NULL REFERENCES note, num INTEGER NOT NULL,
        state TEXT NOT NULL, due INTEGER, revision INTEGER DEFAULT 0, UNIQUE(note,num));
      CREATE INDEX card_due ON card(due);
      CREATE TABLE history(id INTEGER PRIMARY KEY, card INTEGER NOT NULL REFERENCES card, grade INTEGER NOT NULL, time INTEGER NOT NULL,
        previous TEXT NOT NULL, previous_due INTEGER, next TEXT NOT NULL);
      CREATE INDEX history_time ON history(time);
      PRAGMA user_version=1; COMMIT;`)
  }
  transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const result = fn()
      this.db.exec('COMMIT')
      return result
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }
  library() {
    return this.db
      .prepare(
        'SELECT ' +
          columns +
          ' FROM reading ORDER BY finished, priority DESC, due, id DESC'
      )
      .all() as unknown as Entry[]
  }
  private row(id: number) {
    const row = this.db
      .prepare('SELECT * FROM reading WHERE id=?')
      .get(id) as unknown as Saved
    if (!row) throw Error('This reading could not be found.')
    return row
  }
  private mediaBlocks(json: string): Block[] {
    return (JSON.parse(json) as Block[]).map((b) => {
      if (b.kind !== 'image' || !b.asset) return b
      const file = this.db
        .prepare('SELECT file FROM media WHERE id=?')
        .get(b.asset)?.file
      return { ...b, file: typeof file === 'string' ? file : undefined }
    })
  }
  reading(id: number): Detail {
    const r = this.row(id)
    const children = this.db
      .prepare('SELECT ' + columns + ' FROM reading WHERE parent=? ORDER BY id')
      .all(id) as unknown as Entry[]
    const highlights = this.db
      .prepare(
        'SELECT start,end FROM reading WHERE root=? AND start IS NOT NULL ORDER BY start'
      )
      .all(id) as unknown as Anchor[]
    return {
      ...r,
      blocks: this.mediaBlocks(r.blocks),
      anchor: r.start == null ? null : { start: r.start, end: r.end! },
      children,
      highlights
    }
  }
  capture(s: Snapshot, mode: 'article' | 'image' | 'highlight') {
    return this.transaction(() => {
      if (!s.blocks.length)
        throw Error('This page has no readable text or images.')
      const fingerprint = hash(JSON.stringify([s.url, s.title, s.blocks]))
      const blocks = s.blocks.map((b) => {
        if (b.kind !== 'image') return b
        const asset = hash(s.url + '\n' + b.src)
        this.db
          .prepare('INSERT OR IGNORE INTO media(id,url) VALUES(?,?)')
          .run(asset, b.src)
        return { ...b, asset }
      })
      this.db
        .prepare(
          `INSERT OR IGNORE INTO reading(kind,title,source,created,due,fingerprint,blocks)
        VALUES('article',?,?,?,?,?,?)`
        )
        .run(
          s.title,
          s.url,
          +this.clock(),
          studyDay(this.clock()),
          fingerprint,
          JSON.stringify(blocks)
        )
      const root = Number(
        this.db
          .prepare('SELECT id FROM reading WHERE fingerprint=?')
          .get(fingerprint)!.id
      )
      let id = root
      if (mode === 'highlight') {
        if (!s.quote?.trim() || !s.anchor)
          throw Error('Select some text on the page first.')
        id = this.insertExtract(root, root, s.quote, s.anchor, s.url)
      }
      if (mode === 'image') {
        const n = s.imageIndex ?? -1
        const b = blocks[n]
        if (b?.kind !== 'image') throw Error('Select an image on the page.')
        const start = blocks
          .slice(0, n)
          .reduce((sum, b) => sum + b.text.length + 1, 0)
        id = this.insertExtract(
          root,
          root,
          b.text || 'Saved image',
          { start, end: start + b.text.length },
          s.url,
          [b]
        )
      }
      return {
        id,
        assets: blocks.flatMap((b) =>
          b.kind === 'image' && b.asset ? [b.asset] : []
        )
      }
    })
  }
  private insertExtract(
    parent: number,
    root: number,
    quote: string,
    anchor: Anchor,
    source: string,
    blocks: Block[] = []
  ) {
    const result = this.db
      .prepare(
        `INSERT INTO reading(kind,title,parent,root,source,created,due,body,quote,start,end,blocks)
      VALUES('extract',?,?,?,?,?,?,?,?,?,?,?)`
      )
      .run(
        quote.trim().replace(/\s+/g, ' ').slice(0, 100),
        parent,
        root,
        source,
        +this.clock(),
        studyDay(this.clock()),
        quote,
        quote,
        anchor.start,
        anchor.end,
        JSON.stringify(blocks)
      )
    return Number(result.lastInsertRowid)
  }
  extract(id: number, start: number, end: number, quote: string) {
    const r = this.row(id)
    const text = r.kind === 'article' ? flatText(JSON.parse(r.blocks)) : r.body
    if (
      !quote.trim() ||
      text.slice(start, end) !== quote ||
      start < 0 ||
      end <= start ||
      end > text.length
    )
      throw Error('Select a passage again before saving.')
    let anchor = { start, end }
    if (r.root !== null) {
      const rootText = flatText(JSON.parse(this.row(r.root).blocks))
      const original = rootText.slice(r.start!, r.end!)
      const offset = r.body === original ? start : original.indexOf(quote)
      const precise =
        r.body === original ||
        (offset >= 0 && original.lastIndexOf(quote) === offset)
      anchor = precise
        ? { start: r.start! + offset, end: r.start! + offset + quote.length }
        : { start: r.start!, end: r.end! }
    }
    return this.insertExtract(id, r.root ?? id, quote, anchor, r.source)
  }
  extractImage(id: number, index: number) {
    const r = this.row(id)
    const blocks = JSON.parse(r.blocks) as Block[]
    const image = blocks[index]
    if (r.kind !== 'article' || image?.kind !== 'image')
      throw Error('Choose an image in the saved article.')
    const start = blocks
      .slice(0, index)
      .reduce((sum, b) => sum + b.text.length + 1, 0)
    return this.insertExtract(
      id,
      id,
      image.text,
      { start, end: start + image.text.length },
      r.source,
      [image]
    )
  }
  edit(id: number, body: string) {
    if (!body.trim()) throw Error('A working copy needs some text.')
    this.db
      .prepare("UPDATE reading SET body=? WHERE kind='extract' AND id=?")
      .run(body, id)
  }
  position(id: number, position: number) {
    if (Number.isFinite(position))
      this.db
        .prepare('UPDATE reading SET position=? WHERE id=?')
        .run(Math.max(0, position), id)
  }
  defer(id: number, date: string) {
    if (
      !/^\d{4}-\d\d-\d\d$/.test(date) ||
      dateKey(localDate(date)) !== date ||
      date <= studyDay(this.clock())
    )
      throw Error('Choose a future study day.')
    this.db
      .prepare('UPDATE reading SET due=?,visits=visits+1,finished=0 WHERE id=?')
      .run(date, id)
  }
  priority(id: number, p: number) {
    if (![0, 1, 2].includes(p)) throw Error('Choose a priority.')
    this.db.prepare('UPDATE reading SET priority=? WHERE id=?').run(p, id)
  }
  finish(id: number) {
    this.db.prepare('UPDATE reading SET finished=1 WHERE id=?').run(id)
  }
  note(id: number, text: string) {
    if (this.row(id).kind !== 'extract')
      throw Error('Create the cloze from an extract.')
    const nums = groups(clozes(text))
    if (!nums.length) throw Error('Select at least one phrase to hide.')
    this.transaction(() => {
      const note = this.db
        .prepare('INSERT INTO note(extract,text) VALUES(?,?)')
        .run(id, text).lastInsertRowid
      const state = JSON.stringify(createEmptyCard(this.clock()))
      for (const n of nums)
        this.db
          .prepare('INSERT INTO card(note,num,state) VALUES(?,?,?)')
          .run(note, n, state)
    })
  }
  private outcomes(state: string, now: Date) {
    const result = scheduler.repeat(JSON.parse(state) as CardInput, now)
    for (const g of [1, 2, 3, 4] as const) {
      const card = result[g].card
      if (card.scheduled_days >= 1)
        card.due = localDate(shiftDay(studyDay(now), card.scheduled_days), 4)
    }
    return result
  }
  prompt(): Prompt | null {
    const now = this.clock()
    const row = this.db
      .prepare(
        `SELECT c.*, n.text,n.extract,r.root,r.title FROM card c JOIN note n ON n.id=c.note
      JOIN reading r ON r.id=n.extract WHERE c.due IS NULL OR c.due<=? ORDER BY c.due IS NULL,c.due,c.id LIMIT 1`
      )
      .get(+now) as unknown as
      | (CardRow & {
          num: number
          text: string
          extract: number
          root: number
          title: string
        })
      | undefined
    if (!row) return null
    const next = this.outcomes(row.state, now)
    const intervals = ([1, 2, 3, 4] as const).map((g) => {
      const c = next[g].card
      return c.scheduled_days
        ? c.scheduled_days + 'd'
        : Math.max(1, Math.round((+c.due - +now) / 60000)) + 'm'
    })
    return {
      id: row.id,
      revision: row.revision,
      group: row.num,
      text: row.text,
      extract: row.extract,
      root: row.root,
      title: row.title,
      intervals
    }
  }
  rate(id: number, revision: number, grade: Grade) {
    if (![1, 2, 3, 4].includes(grade)) throw Error('Choose a review rating.')
    const now = this.clock()
    this.transaction(() => {
      const row = this.db
        .prepare(
          'SELECT * FROM card WHERE id=? AND revision=? AND (due IS NULL OR due<=?)'
        )
        .get(id, revision, +now) as unknown as CardRow
      if (!row) throw Error('This card has already changed.')
      const next = this.outcomes(row.state, now)[grade].card
      const json = JSON.stringify(next)
      this.db
        .prepare('UPDATE card SET state=?,due=?,revision=revision+1 WHERE id=?')
        .run(json, +next.due, id)
      this.db
        .prepare(
          'INSERT INTO history(card,grade,time,previous,previous_due,next) VALUES(?,?,?,?,?,?)'
        )
        .run(id, grade, +now, row.state, row.due, json)
    })
  }
  undo() {
    this.transaction(() => {
      const h = this.db
        .prepare('SELECT * FROM history ORDER BY id DESC LIMIT 1')
        .get()
      if (!h) return
      this.db
        .prepare('UPDATE card SET state=?,due=?,revision=revision+1 WHERE id=?')
        .run(h.previous, h.previous_due, h.card)
      this.db.prepare('DELETE FROM history WHERE id=?').run(h.id)
    })
  }
  workload(month: string): Workload {
    if (!/^\d{4}-(0[1-9]|1[012])$/.test(month)) throw Error('Invalid month.')
    const now = this.clock(),
      today = studyDay(now),
      start = +localDate(today, 4),
      end = +localDate(shiftDay(today, 1), 4)
    const first = localDate(month + '-01', 4),
      after = new Date(first)
    after.setMonth(after.getMonth() + 1)
    const days: Record<string, number> = {}
    for (const r of this.db
      .prepare('SELECT due FROM card WHERE due>=? AND due<?')
      .iterate(+first, +after)) {
      const key = studyDay(new Date(Number(r.due)))
      days[key] = (days[key] || 0) + 1
    }
    const count = (sql: string, ...params: number[]) =>
      Number(this.db.prepare(sql).get(...params)!.n)
    return {
      days,
      overdue: count('SELECT COUNT(*) n FROM card WHERE due<?', start),
      ready: count(
        'SELECT COUNT(*) n FROM card WHERE due>=? AND due<=?',
        start,
        +now
      ),
      later: count(
        'SELECT COUNT(*) n FROM card WHERE due>? AND due<?',
        +now,
        end
      ),
      fresh: count('SELECT COUNT(*) n FROM card WHERE due IS NULL'),
      studied: count(
        'SELECT COUNT(DISTINCT card) n FROM history WHERE time>=? AND time<?',
        start,
        end
      ),
      canUndo: !!this.db.prepare('SELECT 1 FROM history LIMIT 1').get()
    }
  }
}
