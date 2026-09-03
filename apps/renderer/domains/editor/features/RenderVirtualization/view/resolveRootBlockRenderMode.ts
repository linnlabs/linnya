import type { EditorState } from 'prosemirror-state'
import {
  getRenderVirtualizationState,
  isRootBlockHydratedByVirtualizationState,
} from '../state/renderVirtualizationPlugin'
import {
  readExplicitRootBlockRenderModeFromDecorations,
  type RootBlockRenderMode,
} from './rootBlockRenderMode'

/**
 * resolveRootBlockRenderMode.ts
 *
 * NodeView 层唯一的 mode 解析入口。
 *
 * 中文说明：
 * - decoration 上的显式 mode 优先，用于触发单块 hydrate / dehydrate 的官方重建流程；
 * - NodeView update 阶段会传入 decorations，此时必须把 decorations 当作唯一事实源：
 *   有 hydrated decoration 才是 hydrated，没有就是 placeholder；
 * - 只有在没有 decorations 入参的纯状态查询 / 初始化兜底里，才读取 renderVirtualizationPlugin state；
 * - plugin 未注册或未启用时统一回到 hydrated，保证默认路径不变。
 */

export interface ResolveRootBlockRenderModeInput {
  blockId: string
  decorations?: readonly unknown[]
  editorState?: EditorState | null
  virtualizationEnabled?: boolean
}

export function resolveRootBlockRenderMode(
  input: ResolveRootBlockRenderModeInput
): RootBlockRenderMode {
  const explicitMode = readExplicitRootBlockRenderModeFromDecorations(input.decorations)
  if (explicitMode) return explicitMode

  if (input.virtualizationEnabled === false) return 'hydrated'

  if (input.virtualizationEnabled) {
    // 中文说明：NodeView.update 由 ProseMirror 传入当前节点的 decorations。
    // 对渲染虚拟化来说，hydrated/pinned/selection 块一定会有 node decoration；
    // 这里不能再回头读 Tiptap editor.state，因为 vue-3 reactiveState 可能在 view.update
    // 期间短暂落后，导致 plugin state 说 hydrated、DOM 却仍保持 placeholder。
    if (input.decorations !== undefined) return 'placeholder'

    const virtualizationState = input.editorState
      ? getRenderVirtualizationState(input.editorState)
      : null
    if (!virtualizationState || !virtualizationState.enabled) return 'hydrated'

    return isRootBlockHydratedByVirtualizationState(input.editorState, input.blockId)
      ? 'hydrated'
      : 'placeholder'
  }

  return isRootBlockHydratedByVirtualizationState(input.editorState, input.blockId)
    ? 'hydrated'
    : 'placeholder'
}
