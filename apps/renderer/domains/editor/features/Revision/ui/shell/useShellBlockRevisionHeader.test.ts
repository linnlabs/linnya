// @vitest-environment jsdom

import type { Editor } from '@tiptap/core'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import { computed, createApp, defineComponent, h, nextTick, ref, type App, type Ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearLocalizationRegistryForTest,
  registerMessageCatalogs,
  useLocalizationStore,
} from '@app/localization'
import { EDITOR_MESSAGE_CATALOG } from '../../../../definitions/editorMessageCatalog'
import type {
  RenderVirtualizationEngine,
  RenderVirtualizationKeepAlivePort,
  RenderVirtualizationEngineSnapshot,
} from '../../../RenderVirtualization'
import { setFlag } from '../../../../ui/services/editorFeatureFlags'
import type {
  BlockRevisionState,
  CanonicalPendingSession,
  PendingProjectionResult,
  RevisionStore,
} from '../../store/types'
import { useRevisionStore } from '../../store/useRevisionStore'
import {
  ROOT_BLOCK_SHELL_REVISION_HEADER_ACTIVE_ATTR,
  ROOT_BLOCK_SHELL_REVISION_HEADER_ATTR,
} from './shellBlockRevisionHeaderDom'
import { useShellBlockRevisionHeader } from './useShellBlockRevisionHeader'

vi.mock('../../store/useRevisionStore', () => ({
  useRevisionStore: vi.fn(),
}))

interface EditorEventBusLike {
  on: (eventName: string, listener: () => void) => void
  off: (eventName: string, listener: () => void) => void
  emit: (eventName: string) => void
}

type ShellHeaderTestEditor = Editor & {
  eventBus: EditorEventBusLike
}

class EventBusMock implements EditorEventBusLike {
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

function createSnapshot(hydratedBlockIds: readonly string[]): RenderVirtualizationEngineSnapshot {
  return {
    version: 1,
    reason: 'test',
    refreshReason: { type: 'manual', label: 'test' },
    capturedAt: 1,
    virtualizationEnabled: true,
    visibleBlockIds: hydratedBlockIds,
    hydratedBlockIds,
    pinnedBlockIds: [],
    requestedHydrateBlockIds: [],
    requestedDehydrateBlockIds: [],
    scrollTop: 0,
    viewportTop: 0,
    viewportBottom: 600,
    totalEstimatedHeight: 1200,
  }
}

function createKeepAlivePortMock(): RenderVirtualizationKeepAlivePort {
  return {
    acquire: vi.fn(() => true),
    release: vi.fn(() => true),
    releaseReason: vi.fn(() => []),
    hasReason: vi.fn(() => false),
  }
}

function createRenderEngineMock(initialHydratedBlockIds: readonly string[]) {
  let snapshot = createSnapshot(initialHydratedBlockIds)
  const listeners = new Set<(nextSnapshot: RenderVirtualizationEngineSnapshot) => void>()
  const engine: RenderVirtualizationEngine = {
    keepAlivePort: createKeepAlivePortMock(),
    scheduleRefresh: vi.fn(),
    refreshNow: vi.fn(() => snapshot),
    remeasureHydratedWindow: vi.fn(),
    getSnapshot: vi.fn(() => snapshot),
    subscribe: vi.fn((listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    }),
    cleanup: vi.fn(),
  }

  return {
    engine,
    emit(hydratedBlockIds: readonly string[]): void {
      snapshot = {
        ...createSnapshot(hydratedBlockIds),
        version: snapshot.version + 1,
      }
      listeners.forEach((listener) => listener(snapshot))
    },
  }
}

function createShellOuter(blockId: string): HTMLElement {
  const outer = document.createElement('div')
  outer.className = 'root-block-outer'
  outer.dataset.id = blockId

  const header = document.createElement('div')
  header.hidden = true
  header.setAttribute(ROOT_BLOCK_SHELL_REVISION_HEADER_ATTR, 'true')
  outer.append(header)

  return outer
}

function createEditor(dom: HTMLElement): ShellHeaderTestEditor {
  const listeners = new Map<string, Set<() => void>>()
  return {
    isDestroyed: false,
    view: { dom },
    eventBus: new EventBusMock(),
    on(eventName: string, listener: () => void): void {
      const eventListeners = listeners.get(eventName) ?? new Set<() => void>()
      eventListeners.add(listener)
      listeners.set(eventName, eventListeners)
    },
    off(eventName: string, listener: () => void): void {
      listeners.get(eventName)?.delete(listener)
    },
  } as unknown as ShellHeaderTestEditor
}

function createCanonicalSession(blockId: string): CanonicalPendingSession {
  return {
    pendingId: `pending-${blockId}`,
    blockId,
    operation: 'update',
    revisionId: `ai-${blockId}`,
    createdAt: 1_700_000_000_000,
  }
}

function createActiveRevision(blockId: string): BlockRevisionState {
  return {
    blockId,
    revisionId: `ai-${blockId}`,
    status: 'pending',
    createdAt: 1_700_000_000_000,
    diffStats: { insertCount: 4, deleteCount: 1 },
  }
}

function createRevisionStoreMock(params: {
  canonicalSessions: Ref<Record<string, CanonicalPendingSession>>
  activeRevisions: Ref<Record<string, BlockRevisionState>>
}): RevisionStore {
  const emptyProjectionResult: PendingProjectionResult = {
    requestedCount: 0,
    batchCount: 0,
    projectedCount: 0,
    skippedCount: 0,
    failedCount: 0,
    totalMs: 0,
    flushMs: 0,
  }

  return {
    canonicalPendingSessions: params.canonicalSessions,
    canonicalPendingBlockCount: computed(() => Object.keys(params.canonicalSessions.value).length),
    canonicalHasAnyPending: computed(() => Object.keys(params.canonicalSessions.value).length > 0),
    canonicalPendingStats: computed(() => ({ insertCount: 0, deleteCount: 0 })),
    activeRevisionCount: computed(() => Object.keys(params.activeRevisions.value).length),
    pendingProjectionDeferred: computed(() => true),
    hasCanonicalPending: (blockId) => Boolean(params.canonicalSessions.value[blockId]),
    getCanonicalSession: (blockId) => params.canonicalSessions.value[blockId] ?? null,
    startRevision: vi.fn(),
    getRevisionState: (blockId) => params.activeRevisions.value[blockId] ?? null,
    hasPendingRevision: (blockId) => Boolean(
      params.canonicalSessions.value[blockId] ?? params.activeRevisions.value[blockId]
    ),
    acceptAllRevisions: vi.fn(async () => {}),
    rejectAllRevisions: vi.fn(async () => {}),
    acceptAllRevisionsInDocument: vi.fn(async () => 'applied' as const),
    rejectAllRevisionsInDocument: vi.fn(async () => 'applied' as const),
    acceptSingleRevision: vi.fn(async () => {}),
    rejectSingleRevision: vi.fn(async () => {}),
    clearRevision: vi.fn(),
    clearAllRevisions: vi.fn(),
    updateDiffStats: vi.fn(),
    clearBackendPendingForBlock: vi.fn(async () => {}),
    setWorkspacePendingRevisions: vi.fn(),
    projectPendingRevisionsForBlocks: vi.fn(async () => emptyProjectionResult),
    findRootBlockPos: vi.fn(() => null),
    reconcileCanonicalWithDocument: vi.fn(),
  }
}

function installRafQueue(): {
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
      for (let index = 0; index < 20 && callbacks.length > 0; index += 1) {
        callbacks.shift()?.(16)
      }
    },
  }
}

function mountShellHeaderHost(params: {
  editor: Ref<ShellHeaderTestEditor | null>
  renderVirtualizationEngine: RenderVirtualizationEngine
  pinia: Pinia
}): App {
  const Host = defineComponent({
    setup() {
      useShellBlockRevisionHeader({
        editor: params.editor,
        renderVirtualizationEngine: params.renderVirtualizationEngine,
      })
      return () => h('div')
    },
  })

  const container = document.createElement('div')
  document.body.append(container)
  const app = createApp(Host)
  app.use(params.pinia)
  app.mount(container)
  return app
}

describe('useShellBlockRevisionHeader', () => {
  const mountedApps: App[] = []
  let pinia: Pinia

  beforeEach(() => {
    pinia = createPinia()
    setActivePinia(pinia)
    registerMessageCatalogs(EDITOR_MESSAGE_CATALOG)
    useLocalizationStore().setCurrentLocale('en-US')
    setFlag('rootBlockShellEnabled', true)
    setFlag('blockChromeLayerEnabled', true)
    setFlag('revisionOverlayEnabled', true)
  })

  afterEach(() => {
    mountedApps.forEach((app) => app.unmount())
    mountedApps.length = 0
    document.body.innerHTML = ''
    vi.unstubAllGlobals()
    vi.mocked(useRevisionStore).mockReset()
    clearLocalizationRegistryForTest()
    setFlag('rootBlockShellEnabled', false)
  })

  it('keeps one in-flow header while canonical pending becomes active projected diff', async () => {
    const raf = installRafQueue()
    const editorRoot = document.createElement('div')
    const outer = createShellOuter('block-a')
    editorRoot.append(outer)
    const editor = ref<ShellHeaderTestEditor | null>(createEditor(editorRoot))
    const canonicalSessions = ref<Record<string, CanonicalPendingSession>>({
      'block-a': createCanonicalSession('block-a'),
    })
    const activeRevisions = ref<Record<string, BlockRevisionState>>({})
    vi.mocked(useRevisionStore).mockReturnValue(createRevisionStoreMock({
      canonicalSessions,
      activeRevisions,
    }))
    const renderEngine = createRenderEngineMock(['block-a'])

    mountedApps.push(mountShellHeaderHost({
      editor,
      renderVirtualizationEngine: renderEngine.engine,
      pinia,
    }))
    await nextTick()
    raf.flushAll()

    expect(outer.getAttribute(ROOT_BLOCK_SHELL_REVISION_HEADER_ACTIVE_ATTR)).toBe('true')
    expect(outer.textContent).toContain('Pending')

    activeRevisions.value = {
      'block-a': createActiveRevision('block-a'),
    }
    await nextTick()
    raf.flushAll()

    expect(outer.getAttribute(ROOT_BLOCK_SHELL_REVISION_HEADER_ACTIVE_ATTR)).toBe('true')
    expect(outer.textContent).toContain('+4')
    expect(outer.textContent).toContain('-1')
    expect(outer.textContent).not.toContain('Pending')
    expect(renderEngine.engine.remeasureHydratedWindow).toHaveBeenCalledWith(
      'shell-revision-header:layout'
    )
  })

  it('does not clear an existing header only because the latest snapshot omits that block', async () => {
    const raf = installRafQueue()
    const editorRoot = document.createElement('div')
    const outerA = createShellOuter('block-a')
    const outerB = createShellOuter('block-b')
    editorRoot.append(outerA, outerB)
    const editor = ref<ShellHeaderTestEditor | null>(createEditor(editorRoot))
    const canonicalSessions = ref<Record<string, CanonicalPendingSession>>({
      'block-a': createCanonicalSession('block-a'),
      'block-b': createCanonicalSession('block-b'),
    })
    const activeRevisions = ref<Record<string, BlockRevisionState>>({})
    vi.mocked(useRevisionStore).mockReturnValue(createRevisionStoreMock({
      canonicalSessions,
      activeRevisions,
    }))
    const renderEngine = createRenderEngineMock(['block-a'])

    mountedApps.push(mountShellHeaderHost({
      editor,
      renderVirtualizationEngine: renderEngine.engine,
      pinia,
    }))
    await nextTick()
    raf.flushAll()

    expect(outerA.textContent).toContain('Pending')
    expect(outerB.textContent).toBe('')

    renderEngine.emit(['block-b'])
    raf.flushAll()

    expect(outerA.textContent).toContain('Pending')
    expect(outerB.textContent).toContain('Pending')
  })
})
