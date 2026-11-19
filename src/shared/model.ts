export type Grade = 1 | 2 | 3 | 4
export type CaptureMode = 'article' | 'highlight' | 'image'
export type Anchor = { start: number; end: number }
export type TextBlock = { kind: 'text' | 'heading'; text: string }
export type ImageBlock = {
  kind: 'image'
  src: string
  text: string
  asset?: string
  file?: string
}
export type Block = TextBlock | ImageBlock
export type Snapshot = {
  title: string
  url: string
  blocks: Block[]
  anchor?: Anchor
  quote?: string
  imageIndex?: number
}
export type CaptureReply = { snapshot: Snapshot | null } | { error: string }
export type Entry = {
  id: number
  kind: 'article' | 'extract'
  title: string
  source: string
  parent: number | null
  root: number | null
  created: number
  due: string
  visits: number
  priority: number
  finished: number
}
export type Detail = Entry & {
  blocks: Block[]
  body: string
  quote: string
  anchor: Anchor | null
  position: number
  highlights: Anchor[]
  children: Entry[]
}
export type Workload = {
  days: Record<string, number>
  overdue: number
  ready: number
  later: number
  fresh: number
  studied: number
  canUndo: boolean
}
export type Prompt = {
  id: number
  revision: number
  extract: number
  root: number
  title: string
  text: string
  group: number
  intervals: string[]
}
export type BrowserState = {
  url: string
  title: string
  back: boolean
  forward: boolean
  busy: boolean
  error: string
}
export type Bounds = { x: number; y: number; width: number; height: number }
export type Commands = {
  library: [[], Entry[]]
  reading: [[id: number], Detail]
  extract: [[id: number, start: number, end: number, quote: string], number]
  extractImage: [[id: number, index: number], number]
  edit: [[id: number, body: string], void]
  position: [[id: number, position: number], void]
  defer: [[id: number, date: string], void]
  priority: [[id: number, priority: number], void]
  finish: [[id: number], void]
  note: [[id: number, text: string], void]
  workload: [[month: string], Workload]
  prompt: [[], Prompt | null]
  rate: [[id: number, revision: number, grade: Grade], void]
  undo: [[], void]
  bounds: [[bounds: Bounds | null], void]
  navigate: [[url: string], void]
  travel: [[action: 'back' | 'forward' | 'reload'], void]
  browser: [[], BrowserState]
  capture: [[mode: CaptureMode], number | null]
  cancelPick: [[], void]
  retry: [[asset: string], void]
}
export type Command = keyof Commands
export type Invoke = <K extends Command>(
  command: K,
  ...args: Commands[K][0]
) => Promise<Commands[K][1]>
declare global {
  interface Window {
    desk: {
      invoke: Invoke
      onBrowser: (cb: (state: BrowserState) => void) => () => void
    }
  }
}

export const flatText = (blocks: Block[]) =>
  blocks.map((b) => b.text).join('\n')
export function dateKey(date: Date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0')
  ].join('-')
}
export function localDate(day: string, hour = 12) {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(y, m - 1, d, hour)
}
export function studyDay(date: Date) {
  const day = new Date(date)
  if (day.getHours() < 4) day.setDate(day.getDate() - 1)
  return dateKey(day)
}
export function shiftDay(day: string, offset: number) {
  const date = localDate(day)
  date.setDate(date.getDate() + offset)
  return dateKey(date)
}
export function proposedDate(visits: number, now = new Date()) {
  return shiftDay(studyDay(now), [1, 3, 7, 14, 30][Math.min(visits, 4)])
}
export type ClozePart = { text: string; group?: number; hint?: string }
export function clozes(input: string): ClozePart[] {
  const result: ClozePart[] = []
  let last = 0
  for (const match of input.matchAll(/\{\{c([1-9]\d{0,3})::([^{}]+?)\}\}/g)) {
    if (match.index! > last)
      result.push({ text: input.slice(last, match.index) })
    const [text, ...hint] = match[2].split('::')
    if (!text.trim()) throw Error('Give each deletion an answer.')
    result.push({ text, group: Number(match[1]), hint: hint.join('::') })
    last = match.index! + match[0].length
  }
  result.push({ text: input.slice(last) })
  if (result.some((p) => !p.group && /\{\{|\}\}/.test(p.text)))
    throw Error('Check the numbered cloze brackets.')
  return result
}
export const groups = (parts: ClozePart[]) =>
  [...new Set(parts.flatMap((p) => (p.group ? [p.group] : [])))].sort(
    (a, b) => a - b
  )
export function webURL(value: string) {
  const url = new URL(value)
  if (
    !['https:', 'http:'].includes(url.protocol) ||
    url.username ||
    url.password
  )
    throw Error('Enter an HTTP or HTTPS address.')
  return url.href
}
