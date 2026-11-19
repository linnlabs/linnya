/**
 * 面板定位 Composable
 * 封装面板位置重算、窗口 resize 防抖和 Editor owner 视口尺寸监听
 */
import { nextTick, onBeforeUnmount, watchEffect, type Ref } from 'vue'
import type { Editor } from '@tiptap/vue-3'
import { useTimer } from '@linnya/renderer-ui'
import type { AnnotationPanelPositionManagerLike } from '../features/Annotation/definitions/injectionKeys'
import {
  ANNOTATION_LAYOUT_RECALC_REASON,
  requestAnnotationLayoutRecalculation,
} from '../features/Annotation/position/layoutRecalculationPolicy'

export interface PanelPositioningOptions {
  editor: Ref<Editor | null>
  panelPositionManager: Ref<AnnotationPanelPositionManagerLike | null | undefined>
}

/**
 * 管理面板定位与重算
 */
export function usePanelPositioning(options: PanelPositioningOptions) {
  const { editor, panelPositionManager } = options
  let ownerResizeFrameId: number | null = null

  // window.resize 防抖：缩放停止 200ms 后重算一次；组件卸载时由 useTimer 自动取消。
  const resizeRecalculationTimer = useTimer()
  const debouncedRecalculatePositions = (): void => {
    resizeRecalculationTimer.start(() => {
      void requestAnnotationLayoutRecalculation(
        panelPositionManager,
        ANNOTATION_LAYOUT_RECALC_REASON.RESIZE
      )
    }, 200)
  }

  const scheduleOwnerResizeRecalculation = () => {
    if (ownerResizeFrameId !== null) return

    ownerResizeFrameId = window.requestAnimationFrame(() => {
      ownerResizeFrameId = null
      void requestAnnotationLayoutRecalculation(
        panelPositionManager,
        ANNOTATION_LAYOUT_RECALC_REASON.RESIZE
      )
    })
  }

  // 使用 watchEffect 监听 editor 并添加/移除监听器
  watchEffect((onCleanup) => {
    const currentEditor = editor.value
    const currentPanelPositionManager = panelPositionManager.value
    if (currentEditor && currentPanelPositionManager) {
      let ownerResizeObserver: ResizeObserver | null = null
      let isCleanedUp = false

      window.addEventListener('resize', debouncedRecalculatePositions)

      // Workspace 右侧窗格拖拽和宽度过渡不会触发 window.resize。
      // 监听当前 editor owner 的真实布局视口，才能持续修正面板横坐标。
      void nextTick().then(() => {
        if (isCleanedUp) return

        const layoutViewport = currentPanelPositionManager.getLayoutViewportElement?.()
        if (!layoutViewport) return

        ownerResizeObserver = new ResizeObserver(scheduleOwnerResizeRecalculation)
        ownerResizeObserver.observe(layoutViewport)
      })

      // cleanup 函数，在 effect 重新运行或组件卸载时调用
      onCleanup(() => {
        isCleanedUp = true
        ownerResizeObserver?.disconnect()
        window.removeEventListener('resize', debouncedRecalculatePositions)
        resizeRecalculationTimer.cancel() // 取消任何待处理的调用
      })
    }
  })

  // 在组件卸载前清理
  onBeforeUnmount(() => {
    window.removeEventListener('resize', debouncedRecalculatePositions)
    resizeRecalculationTimer.cancel()
    if (ownerResizeFrameId !== null) {
      window.cancelAnimationFrame(ownerResizeFrameId)
      ownerResizeFrameId = null
    }
  })

  return {
    debouncedRecalculatePositions,
  }
}
