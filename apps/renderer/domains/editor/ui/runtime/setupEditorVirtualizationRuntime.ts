import {
  createRenderVirtualizationEngine,
  type RenderVirtualizationEngine,
} from '../../features/RenderVirtualization'
import type { Editor } from '@tiptap/core'
import { setupShellPendingProjectionBridge } from '../../features/Revision'
import {
  createBlockVisibilityManager,
  type BlockVisibilityManager,
} from '../composables/useBlockVisibilityManager'
import { setupShellBlockVisibilityBridgeLifecycle } from '../composables/useShellBlockVisibilityBridge'
import { resetEditorShellRuntimeForOwner } from '../services/editorFeatureFlags'

interface EditorEventBusLike {
  on?: (eventName: string, listener: () => void) => void
  off?: (eventName: string, listener: () => void) => void
}

type EditorWithRuntimeEventBus = Editor & { eventBus?: EditorEventBusLike }

export interface EditorVirtualizationRuntimeOptions {
  getEditor: () => EditorWithRuntimeEventBus | null
  getScrollRoot: () => HTMLElement | null
}

export interface EditorVirtualizationRuntime {
  blockVisibilityManager: BlockVisibilityManager
  renderVirtualizationEngine: RenderVirtualizationEngine
  installShellRuntimeBridges: () => boolean
  scheduleEditorCreatedRefresh: () => void
  syncScrollRootReady: () => void
  cleanup: () => void
}

/**
 * 创建 editor 级虚拟化运行时。
 *
 * 中文说明：
 * - EditorContext 只负责把 editor / scrollRoot 生命周期传进来；
 * - RenderVirtualization、Shell visibility、Revision pending projection 的安装顺序在这里统一维护；
 * - cleanup 必须集中释放，避免某条 bridge 在组件卸载后继续收到 engine snapshot。
 */
export function setupEditorVirtualizationRuntime(
  options: EditorVirtualizationRuntimeOptions
): EditorVirtualizationRuntime {
  const blockVisibilityManager = createBlockVisibilityManager({
    getRoot: options.getScrollRoot,
  })
  const renderVirtualizationEngine = createRenderVirtualizationEngine({
    getEditor: options.getEditor,
    getScrollRoot: options.getScrollRoot,
  })

  let cleanupShellBlockVisibilityBridge: (() => void) | null = null
  let cleanupShellPendingProjectionBridge: (() => void) | null = null
  let cleaned = false

  function cleanupShellRuntimeBridges(): void {
    cleanupShellBlockVisibilityBridge?.()
    cleanupShellBlockVisibilityBridge = null
    cleanupShellPendingProjectionBridge?.()
    cleanupShellPendingProjectionBridge = null
  }

  function installShellRuntimeBridges(): boolean {
    if (cleaned) return false

    const readyEditor = options.getEditor()
    if (!readyEditor?.eventBus) {
      console.warn(
        '[EditorVirtualizationRuntime] Shell runtime bridges 等待 editor.eventBus，暂不安装。'
      )
      return false
    }

    // 中文说明：createEditor 返回时 onCreate 尚未完成，eventBus 可能还没挂好。
    // ready 后统一重装，确保 visibility bridge 和 pending projection bridge 消费同一份 engine snapshot。
    cleanupShellRuntimeBridges()

    cleanupShellBlockVisibilityBridge = setupShellBlockVisibilityBridgeLifecycle({
      getEditorRoot: () => options.getEditor()?.view?.dom ?? null,
      owner: readyEditor,
      getEditorEventBus: () => options.getEditor()?.eventBus ?? null,
      visibilityManager: blockVisibilityManager,
    })
    cleanupShellPendingProjectionBridge = setupShellPendingProjectionBridge({
      getEditor: options.getEditor,
      renderVirtualizationEngine,
    })
    renderVirtualizationEngine.refreshNow({ type: 'scheduled', label: 'editor-ready' })
    return true
  }

  function scheduleEditorCreatedRefresh(): void {
    if (cleaned) return
    renderVirtualizationEngine.scheduleRefresh('editor-created')
  }

  function syncScrollRootReady(): void {
    if (cleaned) return
    blockVisibilityManager.resetObserver()
    renderVirtualizationEngine.refreshNow({ type: 'scheduled', label: 'scroll-root-ready' })
  }

  function cleanup(): void {
    if (cleaned) return
    cleaned = true
    const currentEditor = options.getEditor()
    cleanupShellRuntimeBridges()
    renderVirtualizationEngine.cleanup()
    blockVisibilityManager.cleanup()
    if (currentEditor) {
      // 中文说明：EditorContext 卸载后旧 editor 对象可能仍被异步闭包短暂持有。
      // owner 运行态必须跟随 runtime 生命周期复位，避免后续误判旧 editor 仍在虚拟化模式。
      resetEditorShellRuntimeForOwner(currentEditor)
    }
  }

  return {
    blockVisibilityManager,
    renderVirtualizationEngine,
    installShellRuntimeBridges,
    scheduleEditorCreatedRefresh,
    syncScrollRootReady,
    cleanup,
  }
}
