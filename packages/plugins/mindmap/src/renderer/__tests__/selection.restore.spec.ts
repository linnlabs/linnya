/**
 * Selection 恢复策略回归测试
 *
 * 中文说明：
 * - 语义化恢复：目标不可见时回退到最近可见祖先
 * - 目标不存在时清空选区（不静默吞异常）
 */

import { describe, it, expect } from 'vitest'
import type { MindMapInstance, NodeObj } from '../domain/types/index'
import type { Topic } from '../domain/types/dom'
import { restoreSelectionFromSnapshot } from '../domain/operations/selectionRestore'

type MockTopic = Topic & { nodeObj: NodeObj }

function buildNode(id: string, children: NodeObj[] = [], parent?: NodeObj): NodeObj {
  const node: NodeObj = { id, topic: id, children, parent }
  for (const child of children) {
    child.parent = node
  }
  return node
}

function buildMockMind(
  root: NodeObj,
  findableNodeIds: Set<string>
): { mind: MindMapInstance; state: { selectedIds: string[]; cleared: boolean } } {
  const state = {
    selectedIds: [] as string[],
    cleared: false,
  }

  const mind = {
    nodeData: root,
    selectNodes(topics: Topic[]) {
      state.selectedIds.length = 0
      for (const topic of topics as MockTopic[]) {
        state.selectedIds.push(topic.nodeObj.id)
      }
    },
    clearSelection() {
      state.cleared = true
      state.selectedIds.length = 0
    },
    findEle(nodeId: string) {
      if (!findableNodeIds.has(nodeId)) {
        throw new Error(`Node DOM not found: ${nodeId}`)
      }
      const nodeObj = findNodeObjById(nodeId, root)
      if (!nodeObj) {
        throw new Error(`Node data not found: ${nodeId}`)
      }
      return { nodeObj } as MockTopic
    },
  } as unknown as MindMapInstance

  return { mind, state }
}

function findNodeObjById(nodeId: string, root: NodeObj): NodeObj | null {
  if (root.id === nodeId) return root
  if (root.children) {
    for (const child of root.children) {
      const found = findNodeObjById(nodeId, child)
      if (found) return found
    }
  }
  return null
}

describe('Selection restore', () => {
  it('目标不可见时回退到最近可见祖先', () => {
    const node1Child = buildNode('node1-1')
    const node1 = buildNode('node1', [node1Child])
    const root = buildNode('root', [node1])

    const { mind, state } = buildMockMind(root, new Set(['root', 'node1']))

    const result = restoreSelectionFromSnapshot(
      mind,
      {
        operation: 'addChild',
        currentTarget: { type: 'nodes', value: ['node1-1'] },
        currentSelected: ['node1-1'],
        commandMeta: { commandName: 'node.addChild', txId: 'tx_test' },
      },
      'redo'
    )

    expect(state.cleared).toBe(false)
    expect(state.selectedIds).toEqual(['node1'])
    expect(result.fallbackNodeIds).toEqual(['node1-1'])
  })

  it('目标不存在时清空选区', () => {
    const root = buildNode('root')
    const { mind, state } = buildMockMind(root, new Set(['root']))

    const result = restoreSelectionFromSnapshot(
      mind,
      {
        operation: 'addChild',
        currentTarget: { type: 'nodes', value: ['missing'] },
        currentSelected: ['missing'],
        commandMeta: { commandName: 'node.addChild', txId: 'tx_test' },
      },
      'redo'
    )

    expect(state.cleared).toBe(true)
    expect(state.selectedIds).toEqual([])
    expect(result.missingNodeIds).toEqual(['missing'])
  })
})

