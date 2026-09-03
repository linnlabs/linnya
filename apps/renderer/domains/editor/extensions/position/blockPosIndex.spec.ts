/**
 * @file blockPosIndex.spec.ts
 * @description blockPosIndex 单元测试
 *
 * 测试策略：用 mock ProseMirror Node 构造满足 doc.descendants 接口的对象，
 * 验证索引构建正确性和 WeakMap 缓存行为。
 * 不依赖真实 ProseMirror / Tiptap。
 */

import { describe, it, expect } from 'vitest'
import { getBlockPosIndex } from './blockPosIndex'

// ==================== Mock 工厂 ====================

/**
 * 创建 mock rootBlock 节点
 * @param id - 块 ID（传 undefined 模拟无 id 属性）
 * @param contentSize - 块内容大小（影响 nodeSize 计算）
 */
function createMockRootBlock(id: string | undefined, contentSize = 50): any {
  return {
    type: { name: 'rootBlock' },
    attrs: { id },
    nodeSize: contentSize + 2,
  }
}

/**
 * 创建 mock 非 rootBlock 节点（如 baseBlock、headingBlock）
 */
function createMockOtherNode(typeName: string, id: string, size = 30): any {
  return {
    type: { name: typeName },
    attrs: { id },
    nodeSize: size,
  }
}

/**
 * 创建 mock 文档节点，内部维护 rootBlock 列表并实现 descendants / nodeAt
 *
 * descendants 的行为模拟：
 * - 对每个顶层节点调用 callback(node, pos)
 * - 如果 callback 返回 false，跳过该节点的子节点（即不深入）
 * - 这里所有顶层节点都是"根级"的，模拟 ProseMirror doc 的第一层子节点
 */
function createMockDoc(
  topLevelNodes: Array<{ node: any; hasChildren?: boolean }>
): any {
  const entries: Array<{ node: any; pos: number; hasChildren: boolean }> = []
  let pos = 0
  for (const { node, hasChildren } of topLevelNodes) {
    entries.push({ node, pos, hasChildren: hasChildren ?? false })
    pos += node.nodeSize
  }

  return {
    type: { name: 'doc' },
    descendants(callback: (node: any, pos: number) => boolean | void) {
      for (const entry of entries) {
        const result = callback(entry.node, entry.pos)
        // 如果 callback 返回 false，不遍历子节点（模拟 ProseMirror 行为）
        if (result === false) continue
      }
    },
    nodeAt(targetPos: number) {
      return entries.find((e) => e.pos === targetPos)?.node ?? null
    },
  }
}

/**
 * 快捷创建：N 个 rootBlock 的 doc
 */
function createDocWithBlocks(count: number, contentSize = 50): any {
  const nodes = []
  for (let i = 0; i < count; i++) {
    nodes.push({ node: createMockRootBlock(`block-${i}`, contentSize) })
  }
  return createMockDoc(nodes)
}

// ==================== 测试用例 ====================

describe('blockPosIndex', () => {
  describe('索引构建正确性', () => {
    it('3 个 rootBlock → 返回 3 条映射，pos 值递增', () => {
      const doc = createDocWithBlocks(3, 50)
      const index = getBlockPosIndex(doc)

      expect(index.size).toBe(3)
      expect(index.get('block-0')).toBe(0)
      // nodeSize = 50 + 2 = 52
      expect(index.get('block-1')).toBe(52)
      expect(index.get('block-2')).toBe(104)
    })

    it('rootBlock 无 id 属性 → 跳过', () => {
      const doc = createMockDoc([
        { node: createMockRootBlock('valid-id') },
        { node: createMockRootBlock(undefined) },
        { node: createMockRootBlock('another-id') },
      ])
      const index = getBlockPosIndex(doc)

      expect(index.size).toBe(2)
      expect(index.has('valid-id')).toBe(true)
      expect(index.has('another-id')).toBe(true)
    })

    it('rootBlock id 为空字符串 → 跳过', () => {
      const doc = createMockDoc([
        { node: createMockRootBlock('') },
        { node: createMockRootBlock('real-id') },
      ])
      const index = getBlockPosIndex(doc)

      expect(index.size).toBe(1)
      expect(index.has('real-id')).toBe(true)
    })

    it('空文档（无 rootBlock）→ 返回空 Map', () => {
      const doc = createMockDoc([])
      const index = getBlockPosIndex(doc)

      expect(index.size).toBe(0)
    })

    it('非 rootBlock 节点不出现在索引中', () => {
      const doc = createMockDoc([
        { node: createMockRootBlock('root-1') },
        { node: createMockOtherNode('baseBlock', 'base-1') },
        { node: createMockOtherNode('headingBlock', 'heading-1') },
        { node: createMockRootBlock('root-2') },
      ])
      const index = getBlockPosIndex(doc)

      expect(index.size).toBe(2)
      expect(index.has('root-1')).toBe(true)
      expect(index.has('root-2')).toBe(true)
      expect(index.has('base-1')).toBe(false)
      expect(index.has('heading-1')).toBe(false)
    })

    it('100 个 rootBlock → 全部正确索引', () => {
      const doc = createDocWithBlocks(100, 80)
      const index = getBlockPosIndex(doc)

      expect(index.size).toBe(100)

      // nodeSize = 80 + 2 = 82
      for (let i = 0; i < 100; i++) {
        expect(index.get(`block-${i}`)).toBe(i * 82)
      }
    })

    it('不同大小的块 → pos 累加正确', () => {
      const doc = createMockDoc([
        { node: createMockRootBlock('small', 10) },   // nodeSize=12, pos=0
        { node: createMockRootBlock('medium', 100) },  // nodeSize=102, pos=12
        { node: createMockRootBlock('large', 500) },   // nodeSize=502, pos=114
      ])
      const index = getBlockPosIndex(doc)

      expect(index.get('small')).toBe(0)
      expect(index.get('medium')).toBe(12)
      expect(index.get('large')).toBe(114)
    })
  })

  describe('缓存行为', () => {
    it('同一 doc 对象调用两次 → 返回相同 Map 引用', () => {
      const doc = createDocWithBlocks(5)
      const index1 = getBlockPosIndex(doc)
      const index2 = getBlockPosIndex(doc)

      expect(index1).toBe(index2)
    })

    it('不同 doc 对象 → 返回不同 Map 引用', () => {
      const doc1 = createDocWithBlocks(3)
      const doc2 = createDocWithBlocks(3)
      const index1 = getBlockPosIndex(doc1)
      const index2 = getBlockPosIndex(doc2)

      expect(index1).not.toBe(index2)
      // 但内容相同
      expect(index1.size).toBe(index2.size)
    })

    it('缓存命中时不重新遍历', () => {
      let descendantsCallCount = 0
      const doc = createDocWithBlocks(3)
      const originalDescendants = doc.descendants.bind(doc)
      doc.descendants = (callback: any) => {
        descendantsCallCount++
        return originalDescendants(callback)
      }

      getBlockPosIndex(doc)
      expect(descendantsCallCount).toBe(1)

      getBlockPosIndex(doc)
      expect(descendantsCallCount).toBe(1) // 第二次不应再调用
    })
  })
})
