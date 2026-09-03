import { inject, ref, type Ref, type ComputedRef } from 'vue'
import { ANNOTATION_RUNTIME_STORE_KEY } from '../../../features/Annotation/definitions/injectionKeys'
import {
  useAnnotationActiveRootBlockIds,
  type AnnotationRuntimeStoreLike,
} from '../../../features/Annotation/readModel'

/**
 * 批注交互对应的 active chrome 来源。
 *
 * 中文说明：这里只读取 Annotation feature 暴露的窄运行态，不直接依赖面板 DOM。
 */
export function useAnnotationChromeSource(): ComputedRef<string[]> {
  const annotationStore = inject<Ref<AnnotationRuntimeStoreLike | null | undefined>>(
    ANNOTATION_RUNTIME_STORE_KEY,
    ref(null)
  )

  return useAnnotationActiveRootBlockIds(annotationStore)
}
