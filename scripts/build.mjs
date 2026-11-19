import { Resvg } from '@resvg/resvg-js'
import { build } from 'esbuild'
import { mkdir, copyFile, readFile, writeFile } from 'node:fs/promises'
await mkdir('dist', { recursive: true })
const icon = new Resvg(await readFile('build/icon.svg')).render().asPng()
await writeFile('build/icon.png', icon)
const base = { bundle: true, minify: false, logLevel: 'warning' }
await Promise.all([
  ...['main', 'preload'].map((name) =>
    build({
      ...base,
      entryPoints: ['src/desktop/' + name + '.ts'],
      platform: 'node',
      target: 'node22',
      format: 'cjs',
      external: ['electron'],
      outfile: 'dist/' + name + '.cjs'
    })
  ),
  build({
    ...base,
    entryPoints: ['src/desktop/capture.ts'],
    platform: 'browser',
    format: 'iife',
    globalName: 'PageCapture',
    outfile: 'dist/capture.js'
  }),
  build({
    ...base,
    entryPoints: ['src/ui/index.tsx'],
    platform: 'browser',
    target: 'chrome130',
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' },
    loader: { '.woff2': 'file', '.woff': 'file' },
    assetNames: 'fonts/[name]-[hash]',
    outfile: 'dist/ui.js'
  }),
  copyFile('src/ui/index.html', 'dist/index.html')
])
const notice = []
for (const pkg of [
  'react',
  'react-dom',
  'scheduler',
  'lucide-react',
  'ts-fsrs',
  '@mozilla/readability',
  '@fontsource/dm-sans',
  '@fontsource/spectral'
]) {
  const dir = 'node_modules/' + pkg + '/'
  const license = await readFile(dir + 'LICENSE', 'utf8').catch(() =>
    readFile(dir + 'LICENSE.md', 'utf8')
  )
  notice.push(pkg + '\n' + license)
}
await writeFile('dist/THIRD-PARTY.txt', notice.join('\n\n'))
