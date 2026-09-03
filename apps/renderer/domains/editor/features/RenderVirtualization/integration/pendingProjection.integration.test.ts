// @vitest-environment jsdom

import type { Editor } from '@tiptap/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PendingRevisionDTO as WorkspacePendingRevisionDTO } from '../../../../../shared/ipc/workspaceGateway'
import { setFlag } from '../../../ui/services/editorFeatureFlags'
import { setupShellPendingProjectionBridge } from '../../Revision'
import { useRevisionStore } from '../../Revision/store/useRevisionStore'
import { applyPendingRevisionsToEditor } from '../../Revision/utils/pending/applyPendingRevisions'
import { createVirtualizationIntegrationHarness, type VirtualizationIntegrationHarness } from './virtualizationIntegrationHarness'

const mocks = vi.hoisted(() => {
  const fileStore = {
    currentFilePath: 'doc-pending-projection',
    setDirty: vi.fn(),
  }

  return {
    fileStore,
    requestSave: vi.fn(),
    applyAllPendingRevisions: vi.fn(),
    clearPendingRevision: vi.fn(),
    clearAllPendingRevisions: vi.fn(),
    applyPendingRevision: vi.fn(),
    setPendingRevisionsBatch: vi.fn(),
    readDocument: vi.fn(),
  }
})

vi.mock('../../../../../shared/stores/file', () => ({
  useFileStore: () => mocks.fileStore,
}))

vi.mock('../../../../../shared/ipc/workspaceGateway', () => ({
  workspaceGateway: {
    'apply-all-pending-revisions': mocks.applyAllPendingRevisions,
    'clear-pending-revision': mocks.clearPendingRevision,
    'clear-all-pending-revisions': mocks.clearAllPendingRevisions,
    'apply-pending-revision': mocks.applyPendingRevision,
    'set-pending-revisions-batch': mocks.setPendingRevisionsBatch,
    'read-document': mocks.readDocument,
  },
}))

vi.mock('../../../../workspace/services/file-manager/index', () => ({
  requestSave: mocks.requestSave,
}))

vi.mock('../../Revision/utils/pending/applyPendingRevisions', () => ({
  applyPendingRevisionsToEditor: vi.fn(),
}))

class IntegrationEventBus {
  private readonly listeners = new Map<string, Set<() => void>>()

  on(eventName: string, listener: () => void): void {
    const listeners = this.listeners.get(eventName) ?? new Set<() => void>()
    listeners.add(listener)
    this.listeners.set(eventName, listeners)
  }

  off(eventName: string, listener: () => void): void {
    this.listeners.get(eventName)?.delete(listener)
  }

  emit(eventName: string): void {
    this.listeners.get(eventName)?.forEach((listener) => listener())
  }
}

type RevisionIntegrationEditor = Editor & {
  eventBus: IntegrationEventBus
}

function installFrameQueue(): {
  flushAll: () => void
} {
  const callbacks: FrameRequestCallback[] = []
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    callbacks.push(callback)
    return callbacks.length
  })
  vi.stubGlobal('cancelAnimationFrame', vi.fn())

  return {
    flushAll() {
      for (let index = 0; index < 30 && callbacks.length > 0; index += 1) {
        callbacks.shift()?.(16)
      }
    },
  }
}

async function flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 6; index += 1) {
    await Promise.resolve()
  }
}

function createPendingDtos(count: number, blockIdPrefix: string): WorkspacePendingRevisionDTO[] {
  return Array.from({ length: count }, (_value, index) => {
    const blockId = `${blockIdPrefix}-${index}`
    return {
      id: `pending-${index}`,
      blockId,
      operation: 'update',
      newMarkdown: `AI pending content ${index}`,
      source: 'ai',
      metaJson: JSON.stringify({ operation: 'update' }),
      createdAt: index + 1,
      updatedAt: null,
    }
  })
}

function attachRevisionEditorRuntime(
  harness: VirtualizationIntegrationHarness,
  eventBus: IntegrationEventBus
): RevisionIntegrationEditor {
  const editor = harness.editor as unknown as RevisionIntegrationEditor
  editor.eventBus = eventBus
  editor.on = (eventName: string, listener: () => void) => {
    eventBus.on(eventName, listener)
    return editor
  }
  editor.off = (eventName: string, listener: () => void) => {
    eventBus.off(eventName, listener)
    return editor
  }
  Object.defineProperty(editor, 'commands', {
    configurable: true,
    value: {
      ...editor.commands,
      setContent: vi.fn(() => true),
      acceptAllRevisionsInBlock: vi.fn(() => true),
      rejectAllRevisionsInBlock: vi.fn(() => true),
      clearBlockRevisionMarks: vi.fn(() => true),
    },
  })
  return editor
}

describe('RenderVirtualization pending projection integration', () => {
  let harness: VirtualizationIntegrationHarness | null = null
  let cleanupBridge: (() => void) | null = null

  beforeEach(() => {
    setFlag('rootBlockShellEnabled', true)
    setFlag('deferPendingProjectionForLargeDocuments', true)
    mocks.fileStore.currentFilePath = 'doc-pending-projection'
    vi.mocked(applyPendingRevisionsToEditor).mockImplementation(async (editor, pendingRevisions) => {
      const store = useRevisionStore(editor)
      for (const pending of pendingRevisions) {
        if (!pending.blockId) continue
        store.startRevision({
          blockId: pending.blockId,
          revisionId: `ai-${pending.id}`,
          operation: pending.operation,
          createdAt: pending.createdAt,
          diffStats: { insertCount: 1, deleteCount: 0 },
        })
      }
      return {
        successIds: pendingRevisions.map((pending) => pending.id),
        failedIds: [],
        details: pendingRevisions.map((pending) => ({
          id: pending.id,
          success: true,
          operation: pending.operation,
          blockId: pending.blockId,
        })),
      }
    })
  })

  afterEach(() => {
    cleanupBridge?.()
    cleanupBridge = null
    harness?.cleanup()
    harness = null
    setFlag('rootBlockShellEnabled', false)
    setFlag('deferPendingProjectionForLargeDocuments', false)
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('projects hydrated pending windows through the real RevisionStore canonical layer', async () => {
    const frameQueue = installFrameQueue()
    const eventBus = new IntegrationEventBus()
    const blockIdPrefix = 'pending-block'
    harness = createVirtualizationIntegrationHarness({
      blockCount: 120,
      blockIdPrefix,
      maxWindowBlockCount: 8,
      clientHeight: 240,
      estimatedDocumentHeight: 14400,
    })
    const editor = attachRevisionEditorRuntime(harness, eventBus)
    const store = useRevisionStore(editor)

    cleanupBridge = setupShellPendingProjectionBridge({
      getEditor: () => editor,
      renderVirtualizationEngine: harness.engine,
    })

    harness.flushAllFrames()
    frameQueue.flushAll()
    await flushMicrotasks()
    expect(applyPendingRevisionsToEditor).not.toHaveBeenCalled()

    store.setWorkspacePendingRevisions(createPendingDtos(120, blockIdPrefix))
    expect(store.canonicalPendingBlockCount.value).toBe(120)
    expect(store.activeRevisionCount.value).toBe(0)
    expect(store.pendingProjectionDeferred.value).toBe(true)

    eventBus.emit('pending-revisions-loaded')
    harness.flushAllFrames()
    frameQueue.flushAll()
    await flushMicrotasks()

    expect(applyPendingRevisionsToEditor).toHaveBeenCalledTimes(1)
    const firstProjectedDtos = vi.mocked(applyPendingRevisionsToEditor).mock.calls[0]?.[1] ?? []
    const firstProjectedBlockIds = firstProjectedDtos
      .map((dto) => dto.blockId)
      .filter((blockId): blockId is string => typeof blockId === 'string')
    expect(firstProjectedBlockIds).toEqual(harness.engine.getSnapshot().hydratedBlockIds.slice(0, 8))
    expect(store.activeRevisionCount.value).toBe(firstProjectedBlockIds.length)
    expect(firstProjectedBlockIds.every((blockId) => store.getRevisionState(blockId)?.status === 'pending')).toBe(true)

    harness.setScrollTop(9600)
    const secondSnapshot = harness.engine.refreshNow({ type: 'scroll', source: 'native' })
    expect(secondSnapshot.hydratedBlockIds.some((blockId) => firstProjectedBlockIds.includes(blockId))).toBe(false)
    await flushMicrotasks()
    frameQueue.flushAll()
    await flushMicrotasks()

    expect(applyPendingRevisionsToEditor).toHaveBeenCalledTimes(2)
    const secondProjectedDtos = vi.mocked(applyPendingRevisionsToEditor).mock.calls[1]?.[1] ?? []
    const secondProjectedBlockIds = secondProjectedDtos
      .map((dto) => dto.blockId)
      .filter((blockId): blockId is string => typeof blockId === 'string')
    expect(secondProjectedBlockIds.length).toBeGreaterThan(0)
    expect(secondProjectedBlockIds.some((blockId) => firstProjectedBlockIds.includes(blockId))).toBe(false)
    expect(store.activeRevisionCount.value).toBe(firstProjectedBlockIds.length + secondProjectedBlockIds.length)
  })
})
