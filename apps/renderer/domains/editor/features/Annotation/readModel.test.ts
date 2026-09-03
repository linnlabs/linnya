import { computed, ref } from 'vue'
import { describe, expect, it } from 'vitest'
import {
  useAnnotationHandleSummary,
  useAnnotationPanelPresence,
  type AnnotationRuntimeStoreLike,
} from './readModel'

describe('Annotation readModel', () => {
  it('按 blockId 读取 Host 批注入口摘要', () => {
    const store = ref<AnnotationRuntimeStoreLike>({
      getAnnotationsByBlockId: (blockId) => {
        if (blockId !== 'root-a') return []
        return [
          { id: 'annotation-a', blockId: 'root-a', state: 'confirmed' },
          { id: 'annotation-b', blockId: 'root-a', state: 'resolved' },
        ]
      },
    })

    const summary = useAnnotationHandleSummary(computed(() => 'root-a'), store)

    expect(summary.value.annotationCount).toBe(2)
    expect(summary.value.hasAnnotations).toBe(true)
    expect(summary.value.annotations.map((annotation) => annotation.id)).toEqual([
      'annotation-a',
      'annotation-b',
    ])
  })

  it('缺少 blockId 或 store 查询能力时返回空摘要', () => {
    const store = ref<AnnotationRuntimeStoreLike>({})

    const summary = useAnnotationHandleSummary(computed(() => null), store)

    expect(summary.value).toEqual({
      annotations: [],
      annotationCount: 0,
      hasAnnotations: false,
    })
  })

  it('按 annotations 数量决定 Host 是否挂载批注面板 surface', () => {
    const annotations = ref([
      { id: 'annotation-a', blockId: 'root-a', state: 'creating' },
    ])
    const store = ref<AnnotationRuntimeStoreLike>({
      annotations,
    })

    const presence = useAnnotationPanelPresence(store)

    expect(presence.value).toEqual({
      panelCount: 1,
      hasPanels: true,
    })

    annotations.value = []

    expect(presence.value).toEqual({
      panelCount: 0,
      hasPanels: false,
    })
  })
})
