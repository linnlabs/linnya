import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const EDITOR_DOMAIN_ROOT = join(process.cwd(), 'apps/renderer/domains/editor')
const SOURCE_EXTENSIONS = new Set(['.ts', '.vue', '.js'])

const FORBIDDEN_STRING_INJECTION_PATTERNS = [
  /\b(?:provide|inject)(?:<[^>]+>)?\(\s*['"]editor['"]/,
  /\b(?:provide|inject)(?:<[^>]+>)?\(\s*['"]annotationStore['"]/,
  /\b(?:provide|inject)(?:<[^>]+>)?\(\s*['"]panelPositionManager['"]/,
  /\b(?:provide|inject)(?:<[^>]+>)?\(\s*['"]getAnnotationsByBlockId['"]/,
  /\b(?:provide|inject)(?:<[^>]+>)?\(\s*['"]triggerAnnotationCreate['"]/,
  /\b(?:provide|inject)(?:<[^>]+>)?\(\s*['"]observeBlock['"]/,
  /\b(?:provide|inject)(?:<[^>]+>)?\(\s*['"]unobserveBlock['"]/,
  /\b(?:provide|inject)(?:<[^>]+>)?\(\s*['"]getBlockVisibilityState['"]/,
  /\b(?:provide|inject)(?:<[^>]+>)?\(\s*['"]getBlockVisibilityRef['"]/,
  /\b(?:provide|inject)(?:<[^>]+>)?\(\s*['"]registerBlockVisibility['"]/,
  /\b(?:provide|inject)(?:<[^>]+>)?\(\s*['"]unregisterBlockVisibility['"]/,
  /\b(?:provide|inject)(?:<[^>]+>)?\(\s*['"]createRootBlock['"]/,
]

function readSourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = join(directory, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') return []
      return readSourceFiles(fullPath)
    }

    const extension = entry.name.slice(entry.name.lastIndexOf('.'))
    return SOURCE_EXTENSIONS.has(extension) ? [fullPath] : []
  })
}

describe('editor injection keys static guard', () => {
  it('keeps editor/annotation/visibility/root-block runtime dependencies on typed InjectionKey contracts', () => {
    const violations = readSourceFiles(EDITOR_DOMAIN_ROOT).flatMap((filePath) => {
      const source = readFileSync(filePath, 'utf8')
      if (!FORBIDDEN_STRING_INJECTION_PATTERNS.some((pattern) => pattern.test(source))) return []
      return [relative(process.cwd(), filePath)]
    })

    expect(violations).toEqual([])
  })
})
