/**
 * Phase 3 最小回归集
 *
 * 中文说明：
 * - 验证 TxRecorder 聚合（steps / operations / reflow reasons）
 * - 验证拖拽命令化的关键链路（node.move 注入 meta + history 可撤回）
 */

// @vitest-environment jsdom

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import MindMap from '../core'
import { useMindMapStore } from '../domain/store/mindmapStore'
import { installTxRecorder } from '../domain/transaction'
import type { MindMapData, MindMapInstance, Options } from '../domain/types/index'
import type { Operation, OperationMeta } from '../shared/utils/events/eventBus'
import type { TxRecord } from '../domain/transaction/types'

describe('Phase 3 Regression', () => {
  let container: HTMLElement
  let mindMap: MindMapInstance | null

  beforeEach(() => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation(query => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    })

    // 中文说明：MindMapEngine 依赖 Pinia，需要提前激活
    setActivePinia(createPinia())

    container = document.createElement('div')
    container.id = 'map'
    container.style.width = '1000px'
    container.style.height = '800px'
    document.body.appendChild(container)
  })

  afterEach(() => {
    if (mindMap) {
      mindMap.destroy()
      mindMap = null
    }
    document.body.removeChild(container)
    container.remove()
  })

  function createMindMapWithData(data: MindMapData): MindMapInstance {
    const options: Options = { el: container, direction: 1 }
    const instance = new MindMap(options)
    const store = useMindMapStore()
    store.setMind(instance)
    store.setDocumentSession({
      documentId: 'test-doc',
      name: 'Phase3 Regression',
      content: data,
    })
    return instance
  }

  it('TxRecorder 应聚合 steps / operations / reflow reasons', () => {
    const data: MindMapData = {
      nodeData: {
        id: 'root',
        topic: 'Root',
        children: [
          { id: 'node1', topic: 'Node 1' },
          { id: 'node2', topic: 'Node 2' },
        ],
      },
    }
    mindMap = createMindMapWithData(data)

    const recorder = installTxRecorder(mindMap, { debug: false })

    // 执行插入兄弟节点（会触发 operation + reflow.request）
    const result = mindMap.commands.node.insertSiblingAfter(
      { nodeId: 'node1', edit: false },
      { source: 'test' }
    )
    expect(result.ok).toBe(true)

    // 强制 flush，确保 geometryFlushed 触发
    mindMap.reflowScheduler.flush()

    const record = recorder.getRecord(result.txId)
    expect(record).toBeTruthy()

    const txRecord = record as TxRecord
    expect(txRecord.meta.commandName).toBe('node.insertSiblingAfter')

    // steps：命令语义 + operation + reflow
    const hasCommandStep = txRecord.steps.some(
      step => step.kind === 'command' && step.type === 'node.add' && step.payload.subType === 'insertSiblingAfter'
    )
    const hasOperationStep = txRecord.steps.some(
      step => step.kind === 'operation' && step.operationType === 'insertSibling'
    )
    const hasReflowStep = txRecord.steps.some(
      step => step.kind === 'reflow' && step.reasons.includes('node-operation:dom-changed')
    )

    expect(hasCommandStep).toBe(true)
    expect(hasOperationStep).toBe(true)
    expect(hasReflowStep).toBe(true)

    // operation meta 必须带 txId
    const hasOperationMeta = txRecord.operationMetas.some(meta => meta.txId === result.txId)
    expect(hasOperationMeta).toBe(true)

    // reflow reasons 必须包含 dom-changed
    expect(txRecord.reflowReasons).toContain('node-operation:dom-changed')
  })

  it('node.move 应注入 meta 且支持 undo', () => {
    const data: MindMapData = {
      nodeData: {
        id: 'root',
        topic: 'Root',
        children: [
          { id: 'node1', topic: 'Node 1' },
          { id: 'node2', topic: 'Node 2' },
        ],
      },
    }
    mindMap = createMindMapWithData(data)

    let capturedOperation: (Operation & { meta?: OperationMeta }) | null = null
    const handler = (op: Operation) => {
      if (op.name === 'moveNodeIn' || op.name === 'moveNodeBefore' || op.name === 'moveNodeAfter') {
        capturedOperation = op as Operation & { meta?: OperationMeta }
      }
    }
    mindMap.bus.addListener('operation', handler)

    // 执行 node.move（模拟拖拽命令化入口）
    const result = mindMap.commands.node.move(
      { fromNodeIds: ['node2'], toNodeId: 'node1', position: 'in' },
      { source: 'mouse' }
    )
    expect(result.ok).toBe(true)

    // 结构验证：node2 移动到 node1 下
    const rootChildren = mindMap.nodeData.children ?? []
    expect(rootChildren.length).toBe(1)
    expect(rootChildren[0].id).toBe('node1')
    expect(rootChildren[0].children?.[0].id).toBe('node2')

    // operation meta 注入验证
    expect(capturedOperation).not.toBeNull()
    expect(capturedOperation?.meta?.txId).toBe(result.txId)
    expect(capturedOperation?.meta?.commandName).toBe('node.move')
    expect(capturedOperation?.meta?.source).toBe('mouse')

    // undo 验证（history 可撤回）
    mindMap.undo()
    const afterUndoChildren = mindMap.nodeData.children ?? []
    expect(afterUndoChildren.length).toBe(2)
    expect(afterUndoChildren.some(child => child.id === 'node2')).toBe(true)

    mindMap.bus.removeListener('operation', handler)
  })

  it('node.removeSelected 应记录语义 step 且过滤 root', () => {
    const data: MindMapData = {
      nodeData: {
        id: 'root',
        topic: 'Root',
        children: [
          {
            id: 'node1',
            topic: 'Node 1',
            children: [{ id: 'node1-1', topic: 'Node 1-1' }],
          },
          { id: 'node2', topic: 'Node 2' },
        ],
      },
    }
    mindMap = createMindMapWithData(data)

    const recorder = installTxRecorder(mindMap, { debug: false })

    const rootEl = container.querySelector('mm-root > mm-topic') as HTMLElement
    const node1El = mindMap.findEle('node1')

    // 中文说明：模拟选区包含 root + 普通节点
    mindMap.currentNodes = [rootEl, node1El]

    const result = mindMap.commands.node.removeSelected({}, { source: 'test' })
    expect(result.ok).toBe(true)

    // 强制 flush，确保 geometryFlushed 触发
    mindMap.reflowScheduler.flush()

    const record = recorder.getRecord(result.txId)
    expect(record).toBeTruthy()

    const txRecord = record as TxRecord
    const removeStep = txRecord.steps.find(
      step => step.kind === 'command' && step.type === 'node.remove'
    )
    expect(removeStep).toBeTruthy()
    expect(removeStep?.payload.nodeIds).toEqual(['node1'])

    const hasOperationStep = txRecord.steps.some(
      step => step.kind === 'operation' && step.operationType === 'removeNodes'
    )
    expect(hasOperationStep).toBe(true)
    expect(txRecord.reflowReasons).toContain('node-operation:dom-changed')
  })

  it('node.move 应禁止移动到自身子树', () => {
    const data: MindMapData = {
      nodeData: {
        id: 'root',
        topic: 'Root',
        children: [
          {
            id: 'node1',
            topic: 'Node 1',
            children: [{ id: 'node1-1', topic: 'Node 1-1' }],
          },
          { id: 'node2', topic: 'Node 2' },
        ],
      },
    }
    mindMap = createMindMapWithData(data)

    const result = mindMap.commands.node.move(
      { fromNodeIds: ['node1'], toNodeId: 'node1-1', position: 'in' },
      { source: 'test' }
    )

    expect(result.ok).toBe(false)
    expect(result.reason).toBe('forbidden')
  })

  it('node.toggleExpand 应记录语义 step 且关联 reflow reasons', () => {
    const data: MindMapData = {
      nodeData: {
        id: 'root',
        topic: 'Root',
        children: [
          {
            id: 'node1',
            topic: 'Node 1',
            children: [{ id: 'node1-1', topic: 'Node 1-1' }],
          },
        ],
      },
    }
    mindMap = createMindMapWithData(data)

    const recorder = installTxRecorder(mindMap, { debug: false })

    const result = mindMap.commands.node.toggleExpand(
      { nodeId: 'node1' },
      { source: 'test' }
    )
    expect(result.ok).toBe(true)

    const record = recorder.getRecord(result.txId)
    expect(record).toBeTruthy()

    const txRecord = record as TxRecord
    const toggleStep = txRecord.steps.find(
      step => step.kind === 'command' && step.type === 'node.toggleExpand'
    )
    expect(toggleStep).toBeTruthy()

    // reflow reasons 必须包含 node-expansion:toggle
    expect(txRecord.reflowReasons).toContain('node-expansion:toggle')
  })
})
