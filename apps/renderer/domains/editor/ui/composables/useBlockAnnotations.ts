/**
 * useBlockAnnotations.ts
 *
 * 批注状态与高亮联动逻辑
 * - 批注数据获取
 * - 悬停状态管理
 * - 批注高亮联动
 * - 批注创建触发
 */

import { ref, computed, inject, type Ref, type ComputedRef } from 'vue';
import highlightState from '../../features/Annotation/AnnoHighlightState';
import {
  publishAnnotationInteractionPerf,
  readAnnotationPerfNowMs,
} from '../../features/Annotation/debug/annotationInteractionPerf';
import {
  resolveAnnotationRootBlockId,
  resolveAnnotationRootBlockIdFromEvent,
} from '../../features/Annotation/functions/rootBlockIdResolver';
import {
  ANNOTATIONS_BY_BLOCK_ID_KEY,
  TRIGGER_ANNOTATION_CREATE_KEY,
} from '../../features/Annotation/definitions/injectionKeys';
import type { AnnotationRuntimeAnnotation } from '../../features/Annotation/readModel';

/** 批注数据结构由 Annotation feature 的只读运行态定义。 */
export type AnnotationData = AnnotationRuntimeAnnotation;

export interface UseBlockAnnotationsOptions {
  editor?: unknown;
  blockId: ComputedRef<string | null>;
  isRootBlock: ComputedRef<boolean>;
}

export interface UseBlockAnnotationsReturn {
  /** 是否悬停在块上 */
  isHovered: Ref<boolean>;
  /** 当前块的批注列表 */
  annotationsForBlock: ComputedRef<readonly AnnotationData[]>;
  /** 批注数量 */
  annotationCount: ComputedRef<number>;
  /** 是否有批注 */
  hasAnnotations: ComputedRef<boolean>;
  /** 指针进入块时的处理 */
  onPointerEnter: (event: Event) => void;
  /** 指针离开块时的处理 */
  onPointerLeave: (event: Event) => void;
  /** 批注按钮点击处理 */
  onAnnotationClick: (event: MouseEvent) => Promise<void>;
  /** 清理悬停定时器（在 onBeforeUnmount 中调用） */
  cleanupHoverTimer: () => void;
}

function nowMs(): number {
  return readAnnotationPerfNowMs();
}

// ==================== Composable 实现 ====================

export function useBlockAnnotations(options: UseBlockAnnotationsOptions): UseBlockAnnotationsReturn {
  const { editor, blockId: sourceBlockId, isRootBlock } = options;

  // ==================== 依赖注入 ====================

  // 注入批注管理工具
  const getAnnotationsByBlockId = inject(
    ANNOTATIONS_BY_BLOCK_ID_KEY,
    computed(() => () => [])
  );

  // 注入触发创建的函数
  const triggerAnnotationCreate = inject(TRIGGER_ANNOTATION_CREATE_KEY, null);

  // ==================== 状态 ====================

  const isHovered = ref(false);
  const currentRootBlockId = computed(() => {
    return resolveAnnotationRootBlockId(editor, sourceBlockId.value) ?? sourceBlockId.value;
  });

  // 悬停隐藏的延时定时器（避免鼠标从块移动到工具栏时立刻消失）
  let hoverHideTimer: ReturnType<typeof setTimeout> | null = null;

  // ==================== 计算属性 ====================

  /** 当前块的批注列表 */
  const annotationsForBlock = computed<readonly AnnotationData[]>(() => {
    if (!isRootBlock.value || !currentRootBlockId.value) return [];
    const blockId = currentRootBlockId.value;
    return getAnnotationsByBlockId.value(blockId);
  });

  /** 批注数量 */
  const annotationCount = computed(() => {
    return annotationsForBlock.value.length;
  });

  /** 是否有批注 */
  const hasAnnotations = computed(() => {
    return annotationCount.value > 0;
  });

  // ==================== 悬停处理 ====================

  /**
   * 处理指针进入事件
   * - 设置悬停状态
   * - 高亮关联的批注
   */
  const onPointerEnter = (_event: Event) => {
    // 如果有延时隐藏的定时器，先取消
    if (hoverHideTimer !== null) {
      clearTimeout(hoverHideTimer);
      hoverHideTimer = null;
    }

    // 立即设置悬停状态
    isHovered.value = true;

    // 获取块ID
    const blockId = currentRootBlockId.value;

    // 检查是否有新建面板与此块关联
    const newPanel = document.querySelector(`.annotation-panel[data-block-id="${blockId}"][data-is-new="true"]`);

    // 如果有关联的批注或者新建批注面板，则高亮显示块和批注面板
    if ((hasAnnotations.value || newPanel) && blockId) {
      highlightState.highlightBlock(blockId);
    }
  };

  /**
   * 处理指针离开事件
   * - 延时清除悬停状态（允许鼠标移动到工具栏）
   * - 清除批注高亮
   */
  const onPointerLeave = (_event: Event) => {
    // 增加一个轻微的延时，允许用户把鼠标从块移动到悬浮工具栏
    if (hoverHideTimer !== null) {
      clearTimeout(hoverHideTimer);
    }
    hoverHideTimer = setTimeout(() => {
      isHovered.value = false;
      hoverHideTimer = null;
    }, 200);

    // 获取块ID
    const blockId = currentRootBlockId.value;

    // 检查是否有新建面板与此块关联
    const newPanel = document.querySelector(`.annotation-panel[data-block-id="${blockId}"][data-is-new="true"]`);

    // 如果有关联的批注或者新建批注面板，清除高亮
    if ((hasAnnotations.value || newPanel) && blockId) {
      highlightState.clearBlockHighlight(blockId);
    }
  };

  // ==================== 批注操作 ====================

  /**
   * 处理批注按钮点击
   * - 如果已有批注，处理聚焦逻辑（TODO）
   * - 如果没有批注，触发创建新批注
   */
  const onAnnotationClick = async (event: MouseEvent) => {
    const startedAt = nowMs();
    event.preventDefault();
    event.stopPropagation();

    const blockId =
      resolveAnnotationRootBlockIdFromEvent(editor, event, currentRootBlockId.value ?? undefined)
      ?? currentRootBlockId.value;

    // 检查 blockId 是否存在
    if (!blockId) {
      console.error('[useBlockAnnotations] blockId is undefined!');
      return;
    }

    // 检查触发函数是否已注入
    if (!triggerAnnotationCreate) {
      console.error('[useBlockAnnotations] triggerAnnotationCreate function not injected!');
      return;
    }

    // 获取批注
    const blockAnnotations = getAnnotationsByBlockId.value(blockId);

    if (blockAnnotations.length > 0) {
      // 如果已有批注，处理聚焦逻辑 (TODO)
      publishAnnotationInteractionPerf({
        kind: 'annotation-click',
        blockId,
        hadExistingAnnotations: true,
        totalMs: Math.round((nowMs() - startedAt) * 10) / 10,
      });
    } else {
      // 没有批注，调用注入的触发函数
      try {
        const triggerStartedAt = nowMs();
        const annotationId = await triggerAnnotationCreate(blockId);
        if (!annotationId) return;
        // 高亮块
        highlightState.highlightBlock(blockId);
        publishAnnotationInteractionPerf({
          kind: 'annotation-click',
          blockId,
          hadExistingAnnotations: false,
          triggerMs: Math.round((nowMs() - triggerStartedAt) * 10) / 10,
          totalMs: Math.round((nowMs() - startedAt) * 10) / 10,
        });
      } catch (error) {
        console.error('[useBlockAnnotations] 调用 triggerAnnotationCreate 时出错:', error);
      }
    }
  };

  // ==================== 清理函数 ====================

  /**
   * 清理悬停定时器（在 onBeforeUnmount 中调用）
   */
  const cleanupHoverTimer = () => {
    if (hoverHideTimer !== null) {
      clearTimeout(hoverHideTimer);
      hoverHideTimer = null;
    }
  };

  return {
    isHovered,
    annotationsForBlock,
    annotationCount,
    hasAnnotations,
    onPointerEnter,
    onPointerLeave,
    onAnnotationClick,
    cleanupHoverTimer,
  };
}
