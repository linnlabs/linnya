import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type RootBlockNodeViewRuntimePerfModule = typeof import('./rootBlockNodeViewRuntimePerf')

describe('rootBlockNodeViewRuntimePerf', () => {
  let perf: RootBlockNodeViewRuntimePerfModule

  beforeEach(async () => {
    vi.resetModules()
    vi.stubGlobal('window', {})
    perf = await import('./rootBlockNodeViewRuntimePerf')
    window.__VUE_NODEVIEW_PERF__?.clear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('tracks active rootBlock Vue node views', () => {
    perf.recordRootBlockNodeViewMounted({ kind: 'vue', blockId: 'block-a' })
    perf.recordRootBlockNodeViewMounted({ kind: 'vue', blockId: 'block-a' })
    perf.recordRootBlockNodeViewMounted({ kind: 'vue', blockId: 'block-b' })
    perf.recordRootBlockNodeViewUnmounted({ kind: 'vue', blockId: 'block-a' })

    const snapshot = window.__VUE_NODEVIEW_PERF__?.getSnapshot()
    expect(snapshot?.activeTotal).toBe(2)
    expect(snapshot?.activeByKind.vue).toBe(2)
    expect(snapshot?.mountedTotalByKind.vue).toBe(3)
    expect(snapshot?.unmountedTotalByKind.vue).toBe(1)
    expect(snapshot?.sampleBlockIdsByKind.vue).toEqual(['block-a', 'block-b'])
  })
})
