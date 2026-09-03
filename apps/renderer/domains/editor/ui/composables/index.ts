/**
 * BlockView Composables 统一导出
 *
 * 这些 composables 将 BlockView.vue 的逻辑拆分为独立的功能模块：
 * - useBlockDragAndMenu: 拖拽柄/块菜单
 * - useBlockAnnotations: 批注状态/悬停高亮
 * - useBlockRevision: 修订模式状态/操作
 * - useBlockHistoryUi: 历史模式UI状态
 */

export {
  useBlockDragAndMenu,
  type BlockDragProps,
  type BlockMenuContext,
  type UseBlockDragAndMenuReturn,
} from './useBlockDragAndMenu';

export {
  useBlockAnnotations,
  type AnnotationData,
  type UseBlockAnnotationsReturn,
} from './useBlockAnnotations';

export {
  useBlockRevision,
  type BlockRevisionProps,
  type RevisionDiffStats,
  type UseBlockRevisionReturn,
} from './useBlockRevision';

export { useBlockHistoryUi, type UseBlockHistoryUiReturn } from './useBlockHistoryUi';

export {
  useBlockVersionHandle,
  type UseBlockVersionHandleReturn,
} from './useBlockVersionHandle';

export {
  createBlockVisibilityManager,
  type BlockVisibilityManager,
} from './useBlockVisibilityManager';

export {
  createShellBlockVisibilityBridge,
  type ShellBlockVisibilityBridge,
} from './useShellBlockVisibilityBridge';

export {
  useBlockActivation,
  BlockActivationReason,
  type UseBlockActivationReturn,
} from './useBlockActivation';

export { useCurrentBlockActivation } from './useCurrentBlockActivation';

// 重新导出 BlockVersion 类型（来自 gateway）
export type { BlockVersion } from '../../../../shared/ipc/blockHistoryGateway';
