// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type {
  CreateEvidenceParams,
  MindMapEvidence,
  UpdateEvidenceParams,
} from '../../../../ipc/mindMapEvidenceGateway'

const hoisted = vi.hoisted(() => {
  const evidenceDb = new Map<string, MindMapEvidence[]>()
  let idSeq = 0

  function buildNodeKey(documentId: string, nodeId: string): string {
    return `${documentId}::${nodeId}`
  }

  function nextEvidenceId(): string {
    idSeq += 1
    return `ev-${idSeq}`
  }

  const mockGateway = {
    add: vi.fn(async (params: CreateEvidenceParams) => {
      const key = buildNodeKey(params.documentId, params.mindmapNodeId)
      const current = evidenceDb.get(key) ?? []
      const now = 1700000000000 + idSeq
      const orderIndex = params.orderIndex ?? current.length

      const item: MindMapEvidence = {
        id: nextEvidenceId(),
        documentId: params.documentId,
        mindmapNodeId: params.mindmapNodeId,
        sourceType: params.sourceType,
        sourceId: params.sourceId,
        ref: params.ref,
        title: params.title,
        snippet: params.snippet,
        url: params.url,
        authors: params.authors,
        date: params.date,
        containerTitle: params.containerTitle,
        note: params.note,
        orderIndex,
        createdAt: now,
        updatedAt: now,
      }

      evidenceDb.set(key, [...current, item])
      return { success: true, data: item }
    }),
    update: vi.fn(async (_params: UpdateEvidenceParams) => ({ success: true })),
    remove: vi.fn(async (_id: string) => ({ success: true })),
    list: vi.fn(async (documentId: string, nodeId: string) => {
      const key = buildNodeKey(documentId, nodeId)
      const list = evidenceDb.get(key) ?? []
      return { success: true, data: [...list].sort((a, b) => a.orderIndex - b.orderIndex) }
    }),
    batchRemove: vi.fn(async (_documentId: string, _nodeIds: string[]) => ({ success: true })),
    clone: vi.fn(async (_documentId: string, _sourceNodeId: string, _targetNodeId: string) => ({ success: true })),
    count: vi.fn(async (documentId: string, nodeIds: string[]) => {
      const counts: Record<string, number> = {}
      for (const nodeId of nodeIds) {
        const key = buildNodeKey(documentId, nodeId)
        counts[nodeId] = (evidenceDb.get(key) ?? []).length
      }
      return { success: true, data: counts }
    }),
    softDelete: vi.fn(async (_documentId: string, _nodeIds: string[]) => ({ success: true })),
    restore: vi.fn(async (_documentId: string, _nodeIds: string[]) => ({ success: true })),
    move: vi.fn(async (_documentId: string, _sourceNodeId: string, _targetNodeId: string) => ({ success: true })),
  }

  function resetMockState() {
    evidenceDb.clear()
    idSeq = 0
    for (const fn of Object.values(mockGateway)) {
      fn.mockClear()
    }
  }

  return {
    mockGateway,
    resetMockState,
  }
})

vi.mock('../../../../ipc/mindMapEvidenceGateway', () => ({
  mindMapEvidenceGateway: hoisted.mockGateway,
}))

import { useMindMapStore } from '../../../../domain/store/mindmapStore'
import { useMindMapEvidenceStore } from './evidenceStore'

describe('mindmap evidence store - web/manual list echo', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    hoisted.resetMockState()

    const mindMapStore = useMindMapStore()
    mindMapStore.currentDocumentId = 'doc-test-1'
  })

  it('插入 web/manual 后，列表回显并保留 containerTitle 语义', async () => {
    const store = useMindMapEvidenceStore()
    const nodeId = 'node-1'

    const webInserted = await store.addEvidence({
      mindmapNodeId: nodeId,
      sourceType: 'web',
      sourceId: 'https://example.com/article-a',
      title: '网页 A',
      snippet: '网页 A 的摘录',
      url: 'https://example.com/article-a',
      authors: ['Alice'],
      date: '2026-02-20',
      containerTitle: 'Example News',
    })

    const manualInserted = await store.addEvidence({
      mindmapNodeId: nodeId,
      sourceType: 'manual',
      sourceId: 'manual-ref-001',
      title: '手动资料 B',
      snippet: '手动资料 B 的摘录',
      authors: ['Bob'],
      date: '2025',
      containerTitle: '《测试手册》',
      note: '与节点假设直接相关',
    })

    expect(webInserted?.sourceType).toBe('web')
    expect(webInserted?.containerTitle).toBe('Example News')
    expect(webInserted?.note).toBeUndefined()

    expect(manualInserted?.sourceType).toBe('manual')
    expect(manualInserted?.containerTitle).toBe('《测试手册》')
    expect(manualInserted?.note).toBe('与节点假设直接相关')

    // 触发“从后端回读列表”，验证 UI 列表回显口径
    await store.loadEvidences(nodeId)
    const list = store.getList(nodeId)

    expect(list).not.toBeNull()
    expect(list).toHaveLength(2)
    expect(list?.map((item) => item.sourceType)).toEqual(['web', 'manual'])
    expect(list?.[0].containerTitle).toBe('Example News')
    expect(list?.[1].containerTitle).toBe('《测试手册》')
    expect(list?.[1].note).toBe('与节点假设直接相关')

    expect(store.getListStatus(nodeId)).toBe('loaded')
    expect(store.isCountKnown(nodeId)).toBe(true)
    expect(store.getCount(nodeId)).toBe(2)

    // 参数透传校验：containerTitle 已作为独立字段写入网关，不再借用 note
    const firstAddCall = hoisted.mockGateway.add.mock.calls[0]?.[0] as CreateEvidenceParams
    expect(firstAddCall.containerTitle).toBe('Example News')
    expect(firstAddCall.note).toBeUndefined()
  })
})
