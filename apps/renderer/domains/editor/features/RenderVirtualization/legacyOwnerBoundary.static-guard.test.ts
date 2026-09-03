import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { describe, expect, it } from 'vitest'

const editorRoot = join(process.cwd(), 'apps/renderer/domains/editor')
const sourceExtensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.vue'])

const implementationFiles = new Set([
  'features/RenderVirtualization/runtime/RootBlockRuntimeRegistry.ts',
  'features/RenderVirtualization/state/blockHeightCacheRegistry.ts',
  'features/RenderVirtualization/state/nodeViewLifecycle.ts',
  'features/RenderVirtualization/testing/legacyOwnerFallbackTestAdapter.ts',
])

const legacyOwnerlessCalls = [
  {
    label: 'getRootBlockRuntimeRegistry()',
    name: 'getRootBlockRuntimeRegistry',
    minimumArgumentCount: 1,
  },
  {
    label: 'getHydratedRootBlockRuntimeHandle(blockId)',
    name: 'getHydratedRootBlockRuntimeHandle',
    minimumArgumentCount: 2,
  },
  {
    label: 'subscribeRootBlockRuntimeHandles(listener)',
    name: 'subscribeRootBlockRuntimeHandles',
    minimumArgumentCount: 2,
  },
  {
    label: 'resetRootBlockRuntimeRegistry()',
    name: 'resetRootBlockRuntimeRegistry',
    minimumArgumentCount: 1,
  },
  {
    label: 'resetRootBlockNodeViewLifecycleRegistry()',
    name: 'resetRootBlockNodeViewLifecycleRegistry',
    minimumArgumentCount: 1,
  },
  {
    label: 'resetRenderVirtualizationBlockHeightCache()',
    name: 'resetRenderVirtualizationBlockHeightCache',
    minimumArgumentCount: 1,
  },
  {
    label: 'publishRootBlockNodeViewMounted(entry)',
    name: 'publishRootBlockNodeViewMounted',
    minimumArgumentCount: 2,
  },
  {
    label: 'publishRootBlockNodeViewUnmounted(entry)',
    name: 'publishRootBlockNodeViewUnmounted',
    minimumArgumentCount: 2,
  },
  {
    label: 'registerRootBlockRuntimeHandle(handle)',
    name: 'registerRootBlockRuntimeHandle',
    minimumArgumentCount: 2,
  },
  {
    label: 'recordRenderVirtualizationBlockHeight(blockId, element)',
    name: 'recordRenderVirtualizationBlockHeight',
    minimumArgumentCount: 3,
  },
  {
    label: 'getRenderVirtualizationBlockHeight(blockId)',
    name: 'getRenderVirtualizationBlockHeight',
    minimumArgumentCount: 2,
  },
] as const

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

function normalizeEditorPath(filePath: string): string {
  return relative(editorRoot, filePath).split(sep).join('/')
}

function shouldSkipFile(relativePath: string): boolean {
  if (implementationFiles.has(relativePath)) return true
  if (relativePath.includes('.test.') || relativePath.includes('.spec.')) return true
  if (relativePath.endsWith('.static-guard.test.ts')) return true
  return false
}

function findCallArgumentCounts(source: string, functionName: string): number[] {
  const counts: number[] = []
  const search = `${functionName}(`
  let searchFrom = 0

  while (searchFrom < source.length) {
    const callIndex = source.indexOf(search, searchFrom)
    if (callIndex < 0) break
    const previous = source[callIndex - 1] ?? ''
    if (/[\w$]/.test(previous)) {
      searchFrom = callIndex + search.length
      continue
    }

    const argsStart = callIndex + functionName.length + 1
    const argsEnd = findMatchingParenIndex(source, argsStart - 1)
    if (argsEnd < 0) {
      searchFrom = callIndex + search.length
      continue
    }

    counts.push(countTopLevelArguments(source.slice(argsStart, argsEnd)))
    searchFrom = argsEnd + 1
  }

  return counts
}

function findMatchingParenIndex(source: string, openParenIndex: number): number {
  let depth = 0
  let quote: '"' | "'" | '`' | null = null
  let escaped = false

  for (let index = openParenIndex; index < source.length; index += 1) {
    const char = source[index]
    if (quote) {
      if (escaped) {
        escaped = false
      } else if (char === '\\') {
        escaped = true
      } else if (char === quote) {
        quote = null
      }
      continue
    }

    if (char === '"' || char === "'" || char === '`') {
      quote = char
      continue
    }
    if (char === '(') depth += 1
    if (char === ')') {
      depth -= 1
      if (depth === 0) return index
    }
  }

  return -1
}

function countTopLevelArguments(argsSource: string): number {
  if (argsSource.trim().length === 0) return 0

  let depth = 0
  let quote: '"' | "'" | '`' | null = null
  let escaped = false
  let count = 1

  for (let index = 0; index < argsSource.length; index += 1) {
    const char = argsSource[index]
    if (quote) {
      if (escaped) {
        escaped = false
      } else if (char === '\\') {
        escaped = true
      } else if (char === quote) {
        quote = null
      }
      continue
    }

    if (char === '"' || char === "'" || char === '`') {
      quote = char
      continue
    }
    if (char === '(' || char === '[' || char === '{') depth += 1
    if (char === ')' || char === ']' || char === '}') depth -= 1
    if (char === ',' && depth === 0) count += 1
  }

  return count
}

describe('RenderVirtualization legacy owner boundary', () => {
  it('keeps ownerless runtime registry, lifecycle, and height cache calls out of production paths', () => {
    const offenders = readSourceFiles(editorRoot)
      .map((filePath) => {
        const relativePath = normalizeEditorPath(filePath)
        return {
          relativePath,
          content: readFileSync(filePath, 'utf8'),
        }
      })
      .filter(({ relativePath }) => !shouldSkipFile(relativePath))
      .flatMap(({ relativePath, content }) => (
        legacyOwnerlessCalls
          .filter(({ name, minimumArgumentCount }) => (
            findCallArgumentCounts(content, name)
              .some((argumentCount) => argumentCount < minimumArgumentCount)
          ))
          .map(({ label }) => `${relativePath}: ${label}`)
      ))

    // 中文说明：RenderVirtualization 新主路径必须显式传 owner，legacy 无 owner
    // 表只允许保留在实现文件和测试里，避免多 editor 运行态重新互相污染。
    expect(offenders).toEqual([])
  })
})
