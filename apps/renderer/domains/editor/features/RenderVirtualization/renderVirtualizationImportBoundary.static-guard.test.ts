import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const editorRoot = join(process.cwd(), 'apps/renderer/domains/editor')
const sourceExtensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.vue'])
const allowedInternalImportFiles = new Set([
  'features/RenderVirtualization/renderVirtualizationImportBoundary.static-guard.test.ts',
  'services/editorService.js',
  'ui/services/editorPerfBenchmark.ts',
])

function readSourceFiles(dir: string): string[] {
  const result: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue
    const entryPath = join(dir, entry.name)
    if (entry.isDirectory()) {
      result.push(...readSourceFiles(entryPath))
      continue
    }
    const dotIndex = entry.name.lastIndexOf('.')
    const extension = dotIndex >= 0 ? entry.name.slice(dotIndex) : ''
    if (sourceExtensions.has(extension)) result.push(entryPath)
  }
  return result
}

describe('RenderVirtualization internal import boundary', () => {
  it('keeps feature internals out of ordinary editor business modules', () => {
    const offenders = readSourceFiles(editorRoot)
      .map((filePath) => {
        const relativePath = relative(editorRoot, filePath)
        const source = readFileSync(filePath, 'utf8')
        return {
          relativePath,
          importsInternal: source.includes('RenderVirtualization/internal'),
        }
      })
      .filter((item) => item.importsInternal)
      .map((item) => item.relativePath)
      .filter((relativePath) => !allowedInternalImportFiles.has(relativePath))

    expect(offenders).toEqual([])
  })

  it('keeps raw DOM keep-alive events behind the public KeepAlivePort contract', () => {
    const offenders = readSourceFiles(editorRoot)
      .map((filePath) => {
        const relativePath = relative(editorRoot, filePath)
        const source = readFileSync(filePath, 'utf8')
        return {
          relativePath,
          importsRawKeepAliveEvent:
            source.includes('RenderVirtualization/state/keepAliveEvents') ||
            (
              /from\s+['"][^'"]*RenderVirtualization['"]/.test(source) &&
              source.includes('dispatchRenderVirtualizationKeepAlive')
            ),
        }
      })
      .filter((item) => item.importsRawKeepAliveEvent)
      .map((item) => item.relativePath)
      .filter((relativePath) => !relativePath.startsWith('features/RenderVirtualization/'))
      .filter((relativePath) => !relativePath.endsWith('.test.ts'))
      .filter((relativePath) => !relativePath.endsWith('.test.js'))
      .filter((relativePath) => !relativePath.endsWith('.spec.ts'))
      .filter((relativePath) => !relativePath.endsWith('.spec.js'))

    expect(offenders).toEqual([])
  })
})
