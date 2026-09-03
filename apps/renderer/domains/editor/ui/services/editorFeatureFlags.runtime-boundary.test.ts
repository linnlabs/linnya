import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const EDITOR_ROOT = path.join(process.cwd(), 'apps/renderer/domains/editor')
const SOURCE_EXTENSIONS = new Set(['.js', '.ts', '.vue'])
const LEGACY_GLOBAL_RUNTIME_CALLS =
  /\b(?:shouldUse(?:VirtualRootBlockRendering|RootBlockShell)|setVirtualRootBlockRenderingActive|setLargeDocumentShellMode)\s*\(/

const allowedProductionFiles = new Set([
  'ui/services/editorFeatureFlags.ts',
])

function collectSourceFiles(dir: string, result: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const absolutePath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      collectSourceFiles(absolutePath, result)
      continue
    }
    if (!SOURCE_EXTENSIONS.has(path.extname(entry.name))) continue
    if (entry.name.includes('.test.') || entry.name.includes('.spec.')) continue
    result.push(absolutePath)
  }
  return result
}

function normalizeEditorPath(filePath: string): string {
  return path.relative(EDITOR_ROOT, filePath).split(path.sep).join('/')
}

describe('editorFeatureFlags runtime boundary', () => {
  it('keeps legacy global runtime reads out of editor-scoped production paths', () => {
    const offenders = collectSourceFiles(EDITOR_ROOT)
      .map((filePath) => ({
        filePath: normalizeEditorPath(filePath),
        content: fs.readFileSync(filePath, 'utf8'),
      }))
      .filter(({ filePath }) => !allowedProductionFiles.has(filePath))
      .filter(({ content }) => LEGACY_GLOBAL_RUNTIME_CALLS.test(content))
      .map(({ filePath }) => filePath)

    expect(offenders).toEqual([])
  })
})
