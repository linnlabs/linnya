import { describe, expect, it } from 'vitest'
import {
  ROOT_BLOCK_RENDER_MODE_DATA_ATTR,
  ROOT_BLOCK_RENDER_MODE_SPEC_KEY,
  readRootBlockRenderModeFromDecorations,
} from './rootBlockRenderMode'

describe('readRootBlockRenderModeFromDecorations', () => {
  it('defaults to hydrated when no virtualization decoration exists', () => {
    expect(readRootBlockRenderModeFromDecorations(undefined)).toBe('hydrated')
    expect(readRootBlockRenderModeFromDecorations([])).toBe('hydrated')
    expect(readRootBlockRenderModeFromDecorations([{ spec: { mode: 'unknown' } }])).toBe('hydrated')
  })

  it('reads render mode from decoration spec', () => {
    expect(
      readRootBlockRenderModeFromDecorations([
        { spec: { [ROOT_BLOCK_RENDER_MODE_SPEC_KEY]: 'placeholder' } },
      ])
    ).toBe('placeholder')

    expect(readRootBlockRenderModeFromDecorations([{ spec: { mode: 'hydrated' } }])).toBe('hydrated')
  })

  it('reads render mode from decoration attrs as a compatibility path', () => {
    expect(
      readRootBlockRenderModeFromDecorations([
        {
          type: {
            attrs: {
              [ROOT_BLOCK_RENDER_MODE_DATA_ATTR]: 'placeholder',
            },
          },
        },
      ])
    ).toBe('placeholder')
  })
})
