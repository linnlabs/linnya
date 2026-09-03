import { onBeforeUnmount, shallowRef, type Ref } from 'vue'
import {
  type RenderVirtualizationEngine,
} from '../../../features/RenderVirtualization'

/**
 * RenderVirtualization pinned blocks 对应的 active chrome 来源。
 *
 * 中文说明：Host 只消费 engine snapshot 暴露的 public 事实，不读取 plugin state
 * 或 registry 内部结构。这样 keep-alive chrome 来源和其它 Host surface 一样，
 * 都沿着虚拟化公开契约进入 UI 层。
 */
export function useRenderVirtualizationKeepAliveChromeSource(
  _editor: unknown,
  renderVirtualizationEngine: RenderVirtualizationEngine | null
): Ref<string[]> {
  const pinnedBlockIds = shallowRef<string[]>([])

  function refreshPinnedBlockIds(): void {
    pinnedBlockIds.value = [...(renderVirtualizationEngine?.getSnapshot().pinnedBlockIds ?? [])]
  }

  refreshPinnedBlockIds()

  const unsubscribe = renderVirtualizationEngine?.subscribe(() => {
    refreshPinnedBlockIds()
  }) ?? null

  onBeforeUnmount(() => {
    unsubscribe?.()
  })

  return pinnedBlockIds
}
