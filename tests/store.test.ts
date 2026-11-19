import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Store } from '../src/desktop/store'
import { MediaCache } from '../src/desktop/media'
import {
  clozes,
  flatText,
  groups,
  localDate,
  proposedDate,
  shiftDay,
  studyDay,
  type Snapshot
} from '../src/shared/model'
process.env.TZ = 'America/New_York'
const page: Snapshot = {
  title: 'Field notes',
  url: 'https://example.org/leaves',
  blocks: [
    { kind: 'text', text: 'Light changes leaves.' },
    { kind: 'text', text: 'Light changes leaves.' },
    { kind: 'image', text: 'A leaf', src: 'https://example.org/leaf.png' }
  ],
  quote: 'Light changes leaves.',
  anchor: { start: 21 + 1, end: 21 + 1 + 21 }
}
function fixture() {
  let now = new Date(2026, 10, 18, 12)
  const db = new Store(':memory:', () => new Date(now))
  const extract = db.capture(page, 'highlight').id
  db.note(
    extract,
    '{{c1::Light}} changes {{c2::leaves::what}}. {{c1::Light}} returns.'
  )
  return {
    db,
    extract,
    advance: (date: Date) => {
      now = date
    }
  }
}
test('four ratings, atomic grading, independent siblings and undo survive reopening', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'philosophia-state-')),
    path = join(dir, 'library.sqlite')
  const now = new Date(2026, 10, 18, 12),
    clock = () => now
  try {
    const db = new Store(path, clock),
      { id } = db.capture(page, 'highlight'),
      article = db.reading(id).root!
    assert.equal(db.capture(page, 'article').id, article)
    assert.equal(
      flatText(db.reading(article).blocks).slice(
        page.anchor!.start,
        page.anchor!.end
      ),
      page.quote
    )
    const child = db.extract(id, 6, 13, 'changes')
    assert.equal(db.reading(child).anchor!.start, page.anchor!.start + 6)
    db.edit(id, 'The light changes a leaf.')
    assert.equal(db.reading(id).quote, page.quote)
    db.position(article, 360)
    db.finish(article)
    db.note(id, '{{c1::Light}} changes {{c2::leaves}}. {{c1::Light}} returns.')
    db.db.close()
    const restored = new Store(path, clock),
      before = restored.workload('2026-11')
    assert.equal(restored.reading(article).position, 360)
    assert.equal(restored.reading(id).finished, 0)
    assert.equal(before.fresh, 2)
    for (const grade of [1, 2, 3, 4] as const) {
      const first = restored.prompt()!
      assert.equal(first.intervals.length, 4)
      restored.rate(first.id, first.revision, grade)
      assert.throws(() => restored.rate(first.id, first.revision, grade))
      assert.notEqual(restored.prompt()!.id, first.id)
      const w = restored.workload('2026-11')
      assert.equal(w.fresh, 1)
      assert.equal(w.studied, 1)
      assert.equal(
        Object.values(w.days).reduce((a, b) => a + b, 0),
        1
      )
      restored.undo()
      assert.deepEqual(restored.workload('2026-11'), before)
    }
    restored.db.close()
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
test('reading dates and priority leave independently scheduled children accessible', () => {
  const { db, extract } = fixture(),
    root = db.reading(extract).root!
  db.priority(root, 2)
  db.defer(root, '2026-11-19')
  assert.equal(db.reading(root).visits, 1)
  assert.equal(db.reading(root).priority, 2)
  assert.equal(db.reading(extract).due, '2026-11-18')
  assert.throws(() => db.defer(root, '2026-02-30'))
  assert.throws(() => db.defer(root, '2026-11-01'))
  assert.deepEqual(
    [0, 1, 2, 3, 4, 5].map((n) => proposedDate(n, localDate('2026-11-18'))),
    [
      '2026-11-19',
      '2026-11-21',
      '2026-11-25',
      '2026-12-02',
      '2026-12-18',
      '2026-12-18'
    ]
  )
  db.db.close()
})
test('review lapses reappear the same day and overdue reviews take priority over new cards', () => {
  const { db, advance } = fixture()
  const p = db.prompt()!
  db.rate(p.id, p.revision, 4)
  const due = Number(
    db.db.prepare('SELECT due FROM card WHERE id=?').get(p.id)!.due
  )
  advance(new Date(due + 28 * 3600000))
  const late = db.prompt()!
  assert.equal(late.id, p.id)
  assert.equal(db.workload('2026-11').overdue, 1)
  db.rate(late.id, late.revision, 1)
  assert.equal(db.workload('2026-11').later, 1)
  const retry = Number(
    db.db.prepare('SELECT due FROM card WHERE id=?').get(p.id)!.due
  )
  advance(new Date(retry))
  assert.equal(db.workload('2026-11').ready, 1)
  assert.equal(db.prompt()!.id, p.id)
  db.db.close()
})
test('study-day boundaries follow local wall time through both DST transitions', () => {
  for (const [eve, next, hours] of [
    ['2026-03-07', '2026-03-08', 23],
    ['2026-10-31', '2026-11-01', 25]
  ] as const) {
    assert.equal(shiftDay(eve, 1), next)
    assert.equal(+localDate(next, 4) - +localDate(eve, 4), hours * 3600000)
    assert.equal(studyDay(new Date(+localDate(next, 4) - 1)), eve)
    assert.equal(studyDay(localDate(next, 4)), next)
    const db = new Store(':memory:', () => localDate(next, 4))
    const id = db.capture(page, 'highlight').id
    db.note(id, '{{c1::A}} {{c2::B}}')
    db.db
      .prepare('UPDATE card SET due=? WHERE num=1')
      .run(+localDate(next, 4) - 1)
    db.db.prepare('UPDATE card SET due=? WHERE num=2').run(+localDate(next, 4))
    const w = db.workload(next.slice(0, 7))
    assert.equal(w.ready, 1)
    assert.equal(w.overdue, 1)
    assert.equal(w.days[next], 1)
    db.db.close()
  }
})
test('cloze numbers group answers, preserve hints, and reject malformed notes', () => {
  assert.deepEqual(
    groups(clozes('{{c2::a}} and {{c1::b::hint}} and {{c2::c}}')),
    [1, 2]
  )
  assert.equal(clozes('{{c1::word::hint}}')[0].hint, 'hint')
  for (const s of ['{{c0::x}}', '{{c1::}}', '{{c2::oops'])
    assert.throws(() => clozes(s))
})
test('interrupted image capture keeps the article and can retry without a partial file', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'philosophia-media-')),
    db = new Store(':memory:')
  try {
    const { id, assets } = db.capture(page, 'article')
    let failing = true
    const cache = new MediaCache(
      db,
      dir,
      async () =>
        new Response(
          new ReadableStream({
            start(c) {
              c.enqueue(new Uint8Array([1, 2, 3]))
              if (failing) c.error(Error('Connection lost'))
              else c.close()
            }
          }),
          { headers: { 'Content-Type': 'image/png' } }
        )
    )
    await assert.rejects(cache.save(assets[0]))
    assert.equal(db.reading(id).blocks[0].text, page.quote)
    assert.equal(db.db.prepare('SELECT file FROM media').get()!.file, null)
    failing = false
    await Promise.all([cache.save(assets[0]), cache.save(assets[0])])
    const file = String(db.db.prepare('SELECT file FROM media').get()!.file)
    assert.deepEqual([...(await readFile(join(dir, file)))], [1, 2, 3])
  } finally {
    db.db.close()
    await rm(dir, { recursive: true, force: true })
  }
})
