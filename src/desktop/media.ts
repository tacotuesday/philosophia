import { createHash, randomUUID } from 'node:crypto'
import { mkdir, rename, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Store } from './store'

export const mediaTypes: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
  'image/svg+xml': 'svg',
  'image/bmp': 'bmp',
  'image/x-icon': 'ico'
}
export class MediaCache {
  private active = new Map<string, Promise<void>>()
  constructor(
    readonly store: Store,
    readonly dir: string,
    readonly fetcher: typeof fetch
  ) {}
  async queue(ids: string[]) {
    const todo = [...new Set(ids)]
    await Promise.all(
      Array.from({ length: Math.min(3, todo.length) }, async () => {
        while (todo.length) await this.save(todo.pop()!).catch(() => {})
      })
    )
  }
  save(id: string) {
    const prev = this.active.get(id)
    if (prev) return prev
    const task = this.download(id).finally(() => this.active.delete(id))
    this.active.set(id, task)
    return task
  }
  private async download(id: string) {
    const row = this.store.db
      .prepare('SELECT url,file FROM media WHERE id=?')
      .get(id)
    if (!row) throw Error('Unknown image.')
    if (row.file) return
    const url = String(row.url)
    if (!/^(https?:\/\/|data:image\/)/i.test(url))
      throw Error('Unsupported image address.')
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 15000)
    try {
      const response = await this.fetcher(url, {
        signal: controller.signal,
        credentials: 'include'
      })
      if (!response.ok || !response.body)
        throw Error('Image unavailable. Retry when connected.')
      const mime =
        response.headers
          .get('content-type')
          ?.split(';')[0]
          ?.trim()
          .toLowerCase() || ''
      const ext = mediaTypes[mime]
      if (!ext) throw Error('Unsupported image format.')
      const max = 24 * 1024 * 1024
      if (Number(response.headers.get('content-length')) > max)
        throw Error('Image exceeds 24 MB.')
      const chunks: Uint8Array[] = []
      const reader = response.body.getReader()
      let size = 0
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        size += value.length
        if (size > max) {
          await reader.cancel()
          throw Error('Image exceeds 24 MB.')
        }
        chunks.push(value)
      }
      if (!size) throw Error('Image was empty.')
      const expected = response.headers.get('content-length')
      if (
        expected &&
        !response.headers.get('content-encoding') &&
        Number(expected) !== size
      )
        throw Error('Image download was interrupted.')
      const data = Buffer.concat(chunks)
      const file = createHash('sha256').update(data).digest('hex') + '.' + ext
      await mkdir(this.dir, { recursive: true })
      const tmp = join(this.dir, randomUUID() + '.part')
      try {
        await writeFile(tmp, data)
        await rename(tmp, join(this.dir, file))
      } finally {
        await unlink(tmp).catch(() => {})
      }
      this.store.db.prepare('UPDATE media SET file=? WHERE id=?').run(file, id)
    } finally {
      clearTimeout(timer)
      controller.abort()
    }
  }
}
