import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const visibilityManager = {
    getBlockVisibilityState: vi.fn(),
    getBlockVisibilityRef: vi.fn(),
    registerBlockVisibility: vi.fn(),
    unregisterBlockVisibility: vi.fn(),
    subscribe: vi.fn(),
    resetObserver: vi.fn(),
    cleanup: vi.fn(),
  }
  const renderVirtualizationEngine = {
    scheduleRefresh: vi.fn(),
    refreshNow: vi.fn(),
    remeasureHydratedWindow: vi.fn(),
    getSnapshot: vi.fn(),
    subscribe: vi.fn(),
    cleanup: vi.fn(),
  }

  return {
    visibilityManager,
    renderVirtualizationEngine,
    createBlockVisibilityManager: vi.fn(),
    createRenderVirtualizationEngine: vi.fn(),
    setupShellBlockVisibilityBridgeLifecycle: vi.fn(),
    setupShellPendingProjectionBridge: vi.fn(),
    cleanupShellBlockVisibilityBridge: vi.fn(),
    cleanupShellPendingProjectionBridge: vi.fn(),
    resetEditorShellRuntimeForOwner: vi.fn(),
  }
})

vi.mock('../composables/useBlockVisibilityManager', () => ({
  createBlockVisibilityManager: mocks.createBlockVisibilityManager,
}))

vi.mock('../../features/RenderVirtualization', () => ({
  createRenderVirtualizationEngine: mocks.createRenderVirtualizationEngine,
}))

vi.mock('../../features/Revision', () => ({
  setupShellPendingProjectionBridge: mocks.setupShellPendingProjectionBridge,
}))

vi.mock('../composables/useShellBlockVisibilityBridge', () => ({
  setupShellBlockVisibilityBridgeLifecycle: mocks.setupShellBlockVisibilityBridgeLifecycle,
}))

vi.mock('../services/editorFeatureFlags', () => ({
  resetEditorShellRuntimeForOwner: mocks.resetEditorShellRuntimeForOwner,
}))

const { setupEditorVirtualizationRuntime } = await import('./setupEditorVirtualizationRuntime')

function createEditor({ withEventBus = true } = {}) {
  return {
    view: { dom: { nodeType: 1 } },
    isDestroyed: false,
    eventBus: withEventBus
      ? {
          on: vi.fn(),
          off: vi.fn(),
        }
      : undefined,
  }
}

describe('setupEditorVirtualizationRuntime', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.createBlockVisibilityManager.mockReturnValue(mocks.visibilityManager)
    mocks.createRenderVirtualizationEngine.mockReturnValue(mocks.renderVirtualizationEngine)
    mocks.setupShellBlockVisibilityBridgeLifecycle.mockReturnValue(
      mocks.cleanupShellBlockVisibilityBridge
    )
    mocks.setupShellPendingProjectionBridge.mockReturnValue(
      mocks.cleanupShellPendingProjectionBridge
    )
  })

  it('creates the visibility manager and render engine from one runtime boundary', () => {
    const root = { nodeType: 1 }
    const editor = createEditor()
    const runtime = setupEditorVirtualizationRuntime({
      getEditor: () => editor,
      getScrollRoot: () => root,
    })

    expect(runtime.blockVisibilityManager).toBe(mocks.visibilityManager)
    expect(runtime.renderVirtualizationEngine).toBe(mocks.renderVirtualizationEngine)
    expect(mocks.createBlockVisibilityManager).toHaveBeenCalledWith({
      getRoot: expect.any(Function),
    })
    expect(mocks.createRenderVirtualizationEngine).toHaveBeenCalledWith({
      getEditor: expect.any(Function),
      getScrollRoot: expect.any(Function),
    })
  })

  it('installs shell bridges only after editor.eventBus is ready', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const editor = createEditor({ withEventBus: false })
    const runtime = setupEditorVirtualizationRuntime({
      getEditor: () => editor,
      getScrollRoot: () => ({ nodeType: 1 }),
    })

    expect(runtime.installShellRuntimeBridges()).toBe(false)
    expect(warnSpy).toHaveBeenCalledWith(
      '[EditorVirtualizationRuntime] Shell runtime bridges 等待 editor.eventBus，暂不安装。'
    )
    expect(mocks.setupShellBlockVisibilityBridgeLifecycle).not.toHaveBeenCalled()
    expect(mocks.setupShellPendingProjectionBridge).not.toHaveBeenCalled()
    warnSpy.mockRestore()
  })

  it('reinstalls shell bridges through one cleanup path and refreshes the ready window', () => {
    const editor = createEditor()
    const runtime = setupEditorVirtualizationRuntime({
      getEditor: () => editor,
      getScrollRoot: () => ({ nodeType: 1 }),
    })

    expect(runtime.installShellRuntimeBridges()).toBe(true)
    expect(runtime.installShellRuntimeBridges()).toBe(true)

    expect(mocks.setupShellBlockVisibilityBridgeLifecycle).toHaveBeenCalledTimes(2)
    expect(mocks.setupShellPendingProjectionBridge).toHaveBeenCalledTimes(2)
    expect(mocks.cleanupShellBlockVisibilityBridge).toHaveBeenCalledTimes(1)
    expect(mocks.cleanupShellPendingProjectionBridge).toHaveBeenCalledTimes(1)
    expect(mocks.renderVirtualizationEngine.refreshNow).toHaveBeenLastCalledWith({
      type: 'scheduled',
      label: 'editor-ready',
    })
  })

  it('keeps editor-created and scroll-root-ready refreshes behind named runtime methods', () => {
    const runtime = setupEditorVirtualizationRuntime({
      getEditor: () => createEditor(),
      getScrollRoot: () => ({ nodeType: 1 }),
    })

    runtime.scheduleEditorCreatedRefresh()
    runtime.syncScrollRootReady()

    expect(mocks.renderVirtualizationEngine.scheduleRefresh).toHaveBeenCalledWith('editor-created')
    expect(mocks.visibilityManager.resetObserver).toHaveBeenCalledTimes(1)
    expect(mocks.renderVirtualizationEngine.refreshNow).toHaveBeenCalledWith({
      type: 'scheduled',
      label: 'scroll-root-ready',
    })
  })

  it('cleans bridges, engine, and visibility manager once', () => {
    const editor = createEditor()
    const runtime = setupEditorVirtualizationRuntime({
      getEditor: () => editor,
      getScrollRoot: () => ({ nodeType: 1 }),
    })

    runtime.installShellRuntimeBridges()
    runtime.cleanup()
    runtime.cleanup()
    runtime.scheduleEditorCreatedRefresh()
    runtime.syncScrollRootReady()

    expect(mocks.cleanupShellBlockVisibilityBridge).toHaveBeenCalledTimes(1)
    expect(mocks.cleanupShellPendingProjectionBridge).toHaveBeenCalledTimes(1)
    expect(mocks.renderVirtualizationEngine.cleanup).toHaveBeenCalledTimes(1)
    expect(mocks.visibilityManager.cleanup).toHaveBeenCalledTimes(1)
    expect(mocks.resetEditorShellRuntimeForOwner).toHaveBeenCalledTimes(1)
    expect(mocks.resetEditorShellRuntimeForOwner).toHaveBeenCalledWith(editor)
    expect(mocks.renderVirtualizationEngine.scheduleRefresh).not.toHaveBeenCalled()
    expect(mocks.visibilityManager.resetObserver).not.toHaveBeenCalled()
  })

  it('does not reset owner runtime when cleanup runs after editor is already gone', () => {
    const runtime = setupEditorVirtualizationRuntime({
      getEditor: () => null,
      getScrollRoot: () => ({ nodeType: 1 }),
    })

    runtime.cleanup()

    expect(mocks.resetEditorShellRuntimeForOwner).not.toHaveBeenCalled()
    expect(mocks.renderVirtualizationEngine.cleanup).toHaveBeenCalledTimes(1)
    expect(mocks.visibilityManager.cleanup).toHaveBeenCalledTimes(1)
  })
})
