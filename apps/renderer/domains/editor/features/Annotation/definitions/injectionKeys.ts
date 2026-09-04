import type { ComputedRef, InjectionKey, Ref } from 'vue'
import type { AnnotationRuntimeAnnotation, AnnotationRuntimeStoreLike } from '../readModel'

export type AnnotationCreateTrigger = (blockId: string) => Promise<string | null> | string | null
export type AnnotationListByBlockId = (blockId: string) => readonly AnnotationRuntimeAnnotation[]

/**
 * 批注面板定位器的窄接口。
 *
 * 中文说明：Annotation UI 只声明自己实际会调用的能力，避免继续通过字符串 inject
 * 拿到一个不透明的大对象。布局管理器内部实现仍留在 Annotation position 模块。
 */
export interface AnnotationPanelPositionManagerLike {
  recalculateAllPositions?: (resetToIdeal?: boolean) => Promise<void> | void
  invalidateLayoutCacheForAnnotation?: (annotationId: string) => void
  handleOverlapsOnly?: () => Promise<void> | void
  getPanelMountElement?: () => HTMLElement | null
  getLayoutViewportElement?: () => HTMLElement | null
}

export const ANNOTATION_RUNTIME_STORE_KEY: InjectionKey<
  Ref<AnnotationRuntimeStoreLike | null | undefined>
> = Symbol('ANNOTATION_RUNTIME_STORE_KEY')

export const ANNOTATION_PANEL_POSITION_MANAGER_KEY: InjectionKey<
  Ref<AnnotationPanelPositionManagerLike | null | undefined>
> = Symbol('ANNOTATION_PANEL_POSITION_MANAGER_KEY')

export const ANNOTATIONS_BY_BLOCK_ID_KEY: InjectionKey<ComputedRef<AnnotationListByBlockId>> =
  Symbol('ANNOTATIONS_BY_BLOCK_ID_KEY')

export const TRIGGER_ANNOTATION_CREATE_KEY: InjectionKey<AnnotationCreateTrigger> = Symbol(
  'TRIGGER_ANNOTATION_CREATE_KEY'
)
