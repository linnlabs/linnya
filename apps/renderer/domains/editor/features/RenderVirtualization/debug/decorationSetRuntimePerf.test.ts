import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type DecorationSetRuntimePerfModule = typeof import('./decorationSetRuntimePerf')

describe('decorationSetRuntimePerf', () => {
  let perf: DecorationSetRuntimePerfModule

  beforeEach(async () => {
    vi.resetModules()
    vi.stubGlobal('window', {})
    perf = await import('./decorationSetRuntimePerf')
    window.__DECORATION_SET_PERF__?.clear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('records samples and summarizes by source', () => {
    const startedAt = performance.now()
    perf.recordDecorationSetPerfSample({
      source: 'placeholder',
      decorationCount: 3,
      startedAt,
      visitedNodeCount: 10,
      trigger: 'focused-empty-node',
    })
    perf.recordDecorationSetPerfSample({
      source: 'render-virtualization',
      decorationCount: 2,
      startedAt,
      visitedNodeCount: 2,
      trigger: 'window',
    })

    expect(window.__DECORATION_SET_PERF__?.getLast()?.source).toBe('render-virtualization')
    expect(window.__DECORATION_SET_PERF__?.getHistory()).toHaveLength(2)

    const summary = window.__DECORATION_SET_PERF__?.getSummary() ?? []
    expect(summary.map((item) => item.source).sort()).toEqual([
      'placeholder',
      'render-virtualization',
    ])
    expect(summary.find((item) => item.source === 'placeholder')?.totalDecorationCount).toBe(3)
  })
})
