/**
 * 面板定位 Composable
 * 封装面板位置重算、窗口 resize 防抖、编辑器滚动监听等逻辑
 */
import { onBeforeUnmount, watchEffect, type Ref } from 'vue'
import type { Editor } from '@tiptap/vue-3'
import { debounce } from 'lodash-es'
import {
  ANNOTATION_LAYOUT_RECALC_REASON,
  requestAnnotationLayoutRecalculation,
} from '../features/Annotation/position/layoutRecalculationPolicy'

export interface PanelPositioningOptions {
  editor: Ref<Editor | null>
  panelPositionManager: Ref<{ recalculateAllPositions?: (resetToIdeal?: boolean) => Promise<void> | void } | null>
}

/**
 * 管理面板定位与重算
 */
export function usePanelPositioning(options: PanelPositioningOptions) {
  const { editor, panelPositionManager } = options

  // 定义防抖函数
  const debouncedRecalculatePositions = debounce(() => {
    void requestAnnotationLayoutRecalculation(
      panelPositionManager,
      ANNOTATION_LAYOUT_RECALC_REASON.RESIZE
    )
  }, 200) // 延迟 200ms 执行

  // 使用 watchEffect 监听 editor 并添加/移除监听器
  watchEffect((onCleanup) => {
    const currentEditor = editor.value
    if (currentEditor) {
      window.addEventListener('resize', debouncedRecalculatePositions)

      // cleanup 函数，在 effect 重新运行或组件卸载时调用
      onCleanup(() => {
        window.removeEventListener('resize', debouncedRecalculatePositions)
        debouncedRecalculatePositions.cancel() // 取消任何待处理的调用
      })
    }
  })

  // 在组件卸载前清理
  onBeforeUnmount(() => {
    window.removeEventListener('resize', debouncedRecalculatePositions)
    debouncedRecalculatePositions.cancel()
  })

  return {
    debouncedRecalculatePositions,
  }
}
