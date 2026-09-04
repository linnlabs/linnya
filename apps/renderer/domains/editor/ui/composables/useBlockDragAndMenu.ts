/**
 * useBlockDragAndMenu.ts
 *
 * 拖拽柄与块菜单的交互逻辑
 * - 拖拽状态管理
 * - 块菜单触发
 * - 文本选择禁用/恢复
 */

import { ref, watch, type Ref, type ComputedRef } from 'vue';
import type { Editor } from '@tiptap/vue-3';
import {
  handleDragStartByRootBlockId,
  handleDragEndForEditor,
} from '../../extensions/interaction/drag/dragUtils';
import {
  beginRootBlockDragHandlePress,
  beginRootBlockDragVisualLifecycle,
  cleanupRootBlockDropIndicator,
  endRootBlockDragInteraction,
  endRootBlockDragHandlePress,
  setupRootBlockDropIndicator,
} from '../../extensions/interaction/drag/rootBlockDragLifecycle';
import {
  openBlockActionMenuForRootBlockId,
  type OpenBlockActionMenuFailureReason,
  type OpenBlockActionMenuMode,
} from '../../features/blockActionMenu/orchestration/openBlockActionMenuForRootBlockId';
import { useOpenBlockActionMenuRootBlockId } from '../../features/blockActionMenu/readModel';

// ==================== 类型定义 ====================

export interface BlockDragProps {
  editor: Editor;
  rootBlockId: ComputedRef<string | null>;
}

export interface UseBlockDragAndMenuOptions {
  props: BlockDragProps;
  dragHandleRef: Ref<HTMLElement | null>;
  hasAnnotations: ComputedRef<boolean>;
  /** 设置块选中状态的回调 */
  setBlockSelected: (selected: boolean, fromHandle?: boolean) => void;
}

export type { BlockMenuContext } from '../../features/blockActionMenu/types';

export interface UseBlockDragAndMenuReturn {
  /** 是否正在拖拽 */
  isDragging: Ref<boolean>;
  /** 拖拽柄鼠标按下处理 */
  handleDragHandleMouseDown: (event: MouseEvent) => void;
  /** 拖拽柄鼠标抬起处理 */
  handleDragHandleMouseUp: (event: MouseEvent) => void;
  /** 拖拽柄右键菜单处理 */
  handleDragHandleContextMenu: (event: MouseEvent) => void;
  /** 拖拽开始处理 */
  onDragStart: (event: DragEvent) => void;
  /** 拖拽结束处理 */
  onDragEnd: (event: DragEvent) => void;
  /** 初始化拖拽指示器（在 onMounted 中调用） */
  setupDropIndicator: () => void;
  /** 清理拖拽指示器（在 onBeforeUnmount 中调用） */
  cleanupDropIndicator: () => void;
}

// ==================== Composable 实现 ====================

export function useBlockDragAndMenu(options: UseBlockDragAndMenuOptions): UseBlockDragAndMenuReturn {
  const { props, dragHandleRef, hasAnnotations, setBlockSelected } = options;

  // ==================== 状态 ====================

  const isDragging = ref(false);
  const openMenuBlockId = useOpenBlockActionMenuRootBlockId();

  // 拖拽柄点击状态追踪（内部状态，不暴露）
  let isDraggingHandle = false;
  let dragHandleStartTime = 0;
  let mouseDownPos = { x: 0, y: 0 };

  const releaseDragHandleSelection = (): void => {
    isDraggingHandle = false;
    setBlockSelected(false, true);
  };

  // ==================== 选中逻辑 ====================

  /**
   * 处理选中事件
   * 只更新块 Chrome 的视觉选中态。
   *
   * 中文说明：大文档中 `setNodeSelection` 会触发一次完整 ProseMirror view update。
   * 点击菜单或刚按下拖拽柄时并不需要修改编辑器选区，否则用户会先感受到一段卡顿。
   * 真正的块操作都通过 blockId / rootBlockPos 上下文执行，不依赖 NodeSelection。
   */
  const handleSelection = (event: MouseEvent) => {
    event.stopPropagation();

    // 设置选中状态
    setBlockSelected(true, true);
  };

  watch(
    () => openMenuBlockId.value,
    (blockId) => {
      if (blockId === readRootBlockId() || isDragging.value) return;

      // 中文说明：拖拽柄点击只产生视觉选中态，不写 ProseMirror NodeSelection。
      // 因此菜单关闭或切换到其他块时，必须由菜单运行态反向释放这份视觉状态。
      setBlockSelected(false, true);
    }
  );

  // ==================== 拖拽柄交互 ====================

  /**
   * 处理拖拽柄鼠标按下
   * - 禁用文本选择，防止拖拽内容被污染
   * - 记录起始位置用于判断是点击还是拖拽
   */
  const handleDragHandleMouseDown = (event: MouseEvent) => {
    // 只处理左键
    if (event.button !== 0) {
      return;
    }

    // 交互开始时，立即全局禁用文本选择
    beginRootBlockDragHandlePress(event);

    isDraggingHandle = false;
    dragHandleStartTime = Date.now();
    mouseDownPos = { x: event.clientX, y: event.clientY };

    // 调用选中逻辑
    handleSelection(event);
  };

  /**
   * 处理拖拽柄鼠标抬起
   * - 恢复文本选择
   * - 判断是点击还是拖拽，点击则打开菜单
   */
  const handleDragHandleMouseUp = (event: MouseEvent) => {
    // 交互结束，恢复文本选择
    endRootBlockDragHandlePress();

    // 只处理左键
    if (event.button !== 0) {
      return;
    }

    // 如果正在拖拽，不打开菜单
    if (isDraggingHandle) {
      isDraggingHandle = false;
      return;
    }

    // 检查是否是点击（而非有明显位移的拖拽意图）
    const moveDist = Math.sqrt(
      Math.pow(event.clientX - mouseDownPos.x, 2) + Math.pow(event.clientY - mouseDownPos.y, 2)
    );

    // 如果移动距离太大，则不打开菜单
    if (moveDist > 5) {
      return;
    }

    // 打开菜单
    event.preventDefault();
    event.stopPropagation();

    openMenuFromHandle('toggle');
  };

  /**
   * 处理拖拽柄右键菜单
   */
  const handleDragHandleContextMenu = (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();

    // 打开菜单
    openMenuFromHandle('open');
  };

  // ==================== 拖拽事件 ====================

  /**
   * 拖拽开始处理
   */
  const onDragStart = (event: DragEvent) => {
    isDragging.value = true;
    isDraggingHandle = true;

    beginRootBlockDragVisualLifecycle();

    const started = handleDragStartByRootBlockId(event, {
      editor: props.editor,
      rootBlockId: readRootBlockId(),
    }) === true;
    if (!started) {
      isDragging.value = false;
      endRootBlockDragInteraction({
        releaseHandleSelection: releaseDragHandleSelection,
        restoreHoverOnNextPointerMove: false,
      });
      return;
    }
  };

  /**
   * 拖拽结束处理
   */
  const onDragEnd = (event: DragEvent) => {
    try {
      handleDragEndForEditor(event, {
        editor: props.editor,
        fallbackBlockId: readRootBlockId() ?? 'unknown',
      });
    } finally {
      // 拖拽柄的选中态来自本次 pointer/drag 交互，不是持久的编辑器选区。
      // 无论移动、no-op 还是异常结束，都必须在同一个收尾边界释放。
      isDragging.value = false;
      endRootBlockDragInteraction({
        releaseHandleSelection: releaseDragHandleSelection,
      });
    }
  };

  // ==================== 菜单上下文构建 ====================

  const readRootBlockId = (): string | null => props.rootBlockId.value;

  const logBlockActionMenuFailure = (
    reason: OpenBlockActionMenuFailureReason,
    details: {
      rootBlockId?: string;
      rootBlockPos?: number;
      nodeType?: string;
      error?: unknown;
    }
  ): void => {
    if (import.meta.env.DEV) {
      console.warn('[useBlockDragAndMenu] 打开块菜单失败:', {
        reason,
        ...details,
      });
    }
  };

  /**
   * 从拖拽柄打开块菜单。
   *
   * 中文说明：UI 层只提供 blockId、锚点和打开模式，菜单上下文构建与 open/close 流程
   * 统一交给 blockActionMenu feature 的 orchestration。后续 Host 接管左侧手柄时复用同一入口。
   */
  const openMenuFromHandle = (mode: OpenBlockActionMenuMode): void => {
    const handleEl = dragHandleRef.value;
    if (!handleEl) return;

    void openBlockActionMenuForRootBlockId({
      editor: props.editor,
      rootBlockId: readRootBlockId(),
      anchorElement: handleEl,
      mode,
      hasAnnotations: hasAnnotations.value,
    })
      .then((result) => {
        if (result.ok && result.action === 'opened') {
          setBlockSelected(true, true);
          return;
        }

        setBlockSelected(false, true);

        if (!result.ok) {
          logBlockActionMenuFailure(result.reason, {
            rootBlockId: result.rootBlockId,
            rootBlockPos: result.rootBlockPos,
            nodeType: result.nodeType,
            error: result.error,
          });
        }
      })
      .catch((error: unknown) => {
        logBlockActionMenuFailure('open-failed', { error });
      });
  };

  // ==================== 生命周期辅助 ====================

  /**
   * 初始化拖拽指示器（在 onMounted 中调用）
   */
  const setupDropIndicator = () => {
    setupRootBlockDropIndicator();
  };

  /**
   * 清理拖拽指示器（在 onBeforeUnmount 中调用）
   */
  const cleanupDropIndicatorFn = () => {
    cleanupRootBlockDropIndicator();
  };

  return {
    isDragging,
    handleDragHandleMouseDown,
    handleDragHandleMouseUp,
    handleDragHandleContextMenu,
    onDragStart,
    onDragEnd,
    setupDropIndicator,
    cleanupDropIndicator: cleanupDropIndicatorFn,
  };
}
