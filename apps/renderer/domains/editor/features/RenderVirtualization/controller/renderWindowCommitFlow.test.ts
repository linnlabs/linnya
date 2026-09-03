import { describe, expect, it } from 'vitest'
import { selectHydratedBlockIdsForHeightMeasurement } from './renderWindowCommitFlow'

describe('selectHydratedBlockIdsForHeightMeasurement', () => {
  it('measures the already hydrated window after direct-state content load', () => {
    const selected = selectHydratedBlockIdsForHeightMeasurement({
      pluginWasEnabled: true,
      reason: { type: 'content-loaded', source: 'file' },
      requestedHydrateBlockIds: [],
      actualHydratedBlockIds: ['block-a', 'block-b'],
    })

    expect(selected).toEqual(['block-a', 'block-b'])
  })

  it('skips height measurement during ordinary native scroll', () => {
    const selected = selectHydratedBlockIdsForHeightMeasurement({
      pluginWasEnabled: true,
      reason: { type: 'scroll', source: 'native' },
      requestedHydrateBlockIds: ['block-c'],
      actualHydratedBlockIds: ['block-a', 'block-b', 'block-c'],
    })

    expect(selected).toEqual([])
  })

  it('keeps correction scroll measurement scoped to newly hydrated blocks', () => {
    const selected = selectHydratedBlockIdsForHeightMeasurement({
      pluginWasEnabled: true,
      reason: { type: 'scroll', source: 'native', isCorrection: true },
      requestedHydrateBlockIds: ['block-c'],
      actualHydratedBlockIds: ['block-a', 'block-b', 'block-c'],
    })

    expect(selected).toEqual(['block-c'])
  })

  it('keeps editor scroll measurement scoped to newly hydrated blocks', () => {
    const selected = selectHydratedBlockIdsForHeightMeasurement({
      pluginWasEnabled: true,
      reason: { type: 'scroll', source: 'editor' },
      requestedHydrateBlockIds: ['block-c'],
      actualHydratedBlockIds: ['block-a', 'block-b', 'block-c'],
    })

    expect(selected).toEqual(['block-c'])
  })

  it('measures the full initial window when enabling the plugin for the first time', () => {
    const selected = selectHydratedBlockIdsForHeightMeasurement({
      pluginWasEnabled: false,
      reason: { type: 'scheduled', label: 'initial' },
      requestedHydrateBlockIds: ['block-a'],
      actualHydratedBlockIds: ['block-a', 'block-b'],
    })

    expect(selected).toEqual(['block-a', 'block-b'])
  })
})
