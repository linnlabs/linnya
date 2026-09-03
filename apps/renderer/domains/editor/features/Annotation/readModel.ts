import { computed, unref, type ComputedRef, type Ref } from 'vue'
import {
  readAnnotationActiveBlockIds,
  type AnnotationActiveBlockCandidate,
} from './functions/readAnnotationActiveBlockIds'

export interface AnnotationRuntimeAnnotation extends AnnotationActiveBlockCandidate {
  id?: string
  blockId?: string | null
  state?: string | null
  [key: string]: unknown
}

export interface AnnotationRuntimeStoreLike {
  annotations?: Ref<readonly AnnotationRuntimeAnnotation[]> | readonly AnnotationRuntimeAnnotation[]
  getAnnotationsByBlockId?: (blockId: string) => readonly AnnotationRuntimeAnnotation[]
}

export interface AnnotationHandleSummary {
  annotations: readonly AnnotationRuntimeAnnotation[]
  annotationCount: number
  hasAnnotations: boolean
}

export interface AnnotationPanelPresence {
  panelCount: number
  hasPanels: boolean
}

function readRuntimeAnnotations(
  annotationStore: AnnotationRuntimeStoreLike | null | undefined
): readonly AnnotationRuntimeAnnotation[] {
  const annotations = annotationStore?.annotations
  return annotations ? unref(annotations) : []
}

/**
 * Annotation feature 的只读运行态。
 *
 * 中文说明：BlockChromeHost 只需要“哪些块正在进行批注交互”，不需要知道批注面板
 * 如何布局、如何保存或如何响应 hover。面板 hover 仍由虚拟化 keep-alive source 兜底。
 */
export function useAnnotationActiveRootBlockIds(
  annotationStore: Ref<AnnotationRuntimeStoreLike | null | undefined>
): ComputedRef<string[]> {
  return computed(() => {
    return readAnnotationActiveBlockIds(readRuntimeAnnotations(annotationStore.value))
  })
}

/**
 * Host 批注面板 surface 的挂载状态。
 *
 * 中文说明：批注面板本体仍在 Annotation feature 内；Host 只需要知道是否存在
 * 需要渲染的 panel，避免 EditorContent 常驻挂载批注面板。
 */
export function useAnnotationPanelPresence(
  annotationStore: Ref<AnnotationRuntimeStoreLike | null | undefined>
): ComputedRef<AnnotationPanelPresence> {
  return computed(() => {
    const annotations = readRuntimeAnnotations(annotationStore.value)
    return {
      panelCount: annotations.length,
      hasPanels: annotations.length > 0,
    }
  })
}

/**
 * Host 批注入口的块级只读摘要。
 *
 * 中文说明：Host 只需要知道“这个 block 当前有哪些批注”，用于决定入口图标和点击语义；
 * 批注面板的布局、编辑、保存仍留在 Annotation feature 的既有流程内。
 */
export function useAnnotationHandleSummary(
  blockId: Ref<string | null | undefined> | ComputedRef<string | null | undefined>,
  annotationStore: Ref<AnnotationRuntimeStoreLike | null | undefined>
): ComputedRef<AnnotationHandleSummary> {
  return computed(() => {
    const currentBlockId = unref(blockId)
    const getAnnotationsByBlockId = annotationStore.value?.getAnnotationsByBlockId
    const annotations =
      currentBlockId && getAnnotationsByBlockId
        ? getAnnotationsByBlockId(currentBlockId)
        : []

    return {
      annotations,
      annotationCount: annotations.length,
      hasAnnotations: annotations.length > 0,
    }
  })
}
