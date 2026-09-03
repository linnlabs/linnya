/**
 * @file blockPosIndex.bench.ts
 * @description blockPosIndex 微基准测试
 *
 * 对比两种 blockId → pos 查找方式的性能：
 * - 旧方式：doc.descendants 全遍历（每次查找 O(N)）
 * - 新方式：getBlockPosIndex 索引查找（首次 O(N)，后续 O(1)）
 *
 * 运行：npx vitest bench apps/renderer/domains/editor/extensions/position/blockPosIndex.bench.ts
 */

import { bench, describe } from 'vitest'
import { getBlockPosIndex } from './blockPosIndex'

// ==================== Mock 工厂 ====================

function createMockRootBlock(id: string, contentSize = 50): any {
  return {
    type: { name: 'rootBlock' },
    attrs: { id },
    nodeSize: contentSize + 2,
  }
}

function createMockDoc(count: number, contentSize = 50): any {
  const entries: Array<{ node: any; pos: number }> = []
  let pos = 0
  for (let i = 0; i < count; i++) {
    const node = createMockRootBlock(`block-${i}`, contentSize)
    entries.push({ node, pos })
    pos += node.nodeSize
  }
  return {
    type: { name: 'doc' },
    descendants(callback: (node: any, pos: number) => boolean | void) {
      for (const entry of entries) {
        const result = callback(entry.node, entry.pos)
        if (result === false) continue
      }
    },
    nodeAt(targetPos: number) {
      return entries.find((e) => e.pos === targetPos)?.node ?? null
    },
  }
}

/**
 * 模拟旧的全遍历查找：遍历 doc.descendants 直到找到匹配的 blockId
 */
function oldFullScanLookup(doc: any, targetBlockId: string): number | null {
  let foundPos: number | null = null
  doc.descendants((node: any, pos: number) => {
    if (node.type.name === 'rootBlock' && node.attrs.id === targetBlockId) {
      foundPos = pos
      return false
    }
  })
  return foundPos
}

// ==================== Bench ====================

describe('N=10, 单次查找', () => {
  const doc = createMockDoc(10)
  const targetId = 'block-7'

  bench('旧方式: fullScan', () => {
    oldFullScanLookup(doc, targetId)
  })

  bench('新方式: indexLookup', () => {
    // 每次用新 doc 避免缓存命中（测索引构建 + 查找的完整成本）
    const freshDoc = createMockDoc(10)
    getBlockPosIndex(freshDoc).get(targetId)
  })
})

describe('N=100, 单次查找', () => {
  const targetId = 'block-73'

  bench('旧方式: fullScan', () => {
    const doc = createMockDoc(100)
    oldFullScanLookup(doc, targetId)
  })

  bench('新方式: indexLookup', () => {
    const doc = createMockDoc(100)
    getBlockPosIndex(doc).get(targetId)
  })
})

describe('N=100, 20 次查找同一 doc（模拟编辑时可见块查询）', () => {
  const lookupIds = Array.from({ length: 20 }, (_, i) => `block-${i * 5}`)

  bench('旧方式: 20x fullScan', () => {
    const doc = createMockDoc(100)
    for (const id of lookupIds) {
      oldFullScanLookup(doc, id)
    }
  })

  bench('新方式: 20x indexLookup（缓存命中）', () => {
    const doc = createMockDoc(100)
    for (const id of lookupIds) {
      getBlockPosIndex(doc).get(id)
    }
  })
})

describe('N=500, 100 次查找同一 doc（模拟大文档全文 pending）', () => {
  const lookupIds = Array.from({ length: 100 }, (_, i) => `block-${i * 5}`)

  bench('旧方式: 100x fullScan', () => {
    const doc = createMockDoc(500)
    for (const id of lookupIds) {
      oldFullScanLookup(doc, id)
    }
  })

  bench('新方式: 100x indexLookup（缓存命中）', () => {
    const doc = createMockDoc(500)
    for (const id of lookupIds) {
      getBlockPosIndex(doc).get(id)
    }
  })
})
