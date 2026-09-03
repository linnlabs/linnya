import { computed, onBeforeUnmount, shallowRef, type ComputedRef } from 'vue'
import type { Editor } from '@tiptap/vue-3'
import {
  getHydratedRootBlockRuntimeHandle,
  subscribeRootBlockRuntimeHandles,
  type RenderVirtualizationEngine,
} from '../../features/RenderVirtualization'
import { getFlag, shouldUseVirtualRootBlockRenderingForOwner } from '../services/editorFeatureFlags'
import { useRevisionIndicatorRootBlockIds } from '../../features/Revision/readModel'
import type { ActiveChromeBlock } from './definitions/activeChromeBlocks'
import { resolveBlockChromeRenderPlans } from './functions/resolveBlockChromeRenderPlans'
import {
  resolveBlockChromeHostSurfaceTargets,
  type BlockChromeHostSurfaceTarget,
} from './functions/resolveBlockChromeHostSurfaceTargets'

export function useBlockChromeHostSurfaceTargets(params: {
  editor: Editor
  activeChromeBlocks: ComputedRef<readonly ActiveChromeBlock[]>
  renderVirtualizationEngine: RenderVirtualizationEngine | null
}): {
  surfaceTargets: ComputedRef<BlockChromeHostSurfaceTarget[]>
  targetReadyBlockIds: ComputedRef<ReadonlySet<string>>
  renderPlans: ComputedRef<ReturnType<typeof resolveBlockChromeRenderPlans>>
} {
  const runtimeVersion = shallowRef(0)
  const hydratedBlockIds = shallowRef<readonly string[]>(
    params.renderVirtualizationEngine?.getSnapshot().hydratedBlockIds ?? []
  )

  const unsubscribeRuntimeRegistry = subscribeRootBlockRuntimeHandles(params.editor, () => {
    runtimeVersion.value += 1
  }, { replayExisting: true })
  const unsubscribeRenderVirtualization = params.renderVirtualizationEngine?.subscribe((snapshot) => {
    hydratedBlockIds.value = snapshot.hydratedBlockIds
  }) ?? null

  onBeforeUnmount(() => {
    unsubscribeRuntimeRegistry()
    unsubscribeRenderVirtualization?.()
  })

  const targetReadyBlockIds = computed<ReadonlySet<string>>(() => {
    void runtimeVersion.value
    const readyBlockIds = new Set<string>()
    params.activeChromeBlocks.value.forEach((block) => {
      const anchor = getHydratedRootBlockRuntimeHandle(block.blockId, params.editor)?.getChromeAnchor()
      if (anchor) readyBlockIds.add(block.blockId)
    })
    return readyBlockIds
  })

  const renderPlans = computed(() => resolveBlockChromeRenderPlans({
    activeBlocks: params.activeChromeBlocks.value,
    targetReadyBlockIds: targetReadyBlockIds.value,
  }))

  const revisionIndicatorBlockIds = useRevisionIndicatorRootBlockIds(params.editor)

  const hydratedRevisionIndicatorBlockIds = computed<readonly string[]>(() => {
    const pendingBlockIds = new Set(revisionIndicatorBlockIds.value)
    if (pendingBlockIds.size === 0) return []
    return hydratedBlockIds.value.filter((blockId) => pendingBlockIds.has(blockId))
  })

  const shouldRenderHostSurfaces = computed(() => {
    void runtimeVersion.value
    return getFlag('blockChromeLayerEnabled') && shouldUseVirtualRootBlockRenderingForOwner(params.editor)
  })

  const surfaceTargets = computed<BlockChromeHostSurfaceTarget[]>(() => {
    void runtimeVersion.value
    return resolveBlockChromeHostSurfaceTargets({
      shouldRender: shouldRenderHostSurfaces.value,
      renderPlans: renderPlans.value,
      hydratedRevisionIndicatorBlockIds: hydratedRevisionIndicatorBlockIds.value,
      getRuntimeHandle: (blockId) => getHydratedRootBlockRuntimeHandle(blockId, params.editor),
    })
  })

  return {
    surfaceTargets,
    targetReadyBlockIds,
    renderPlans,
  }
}
