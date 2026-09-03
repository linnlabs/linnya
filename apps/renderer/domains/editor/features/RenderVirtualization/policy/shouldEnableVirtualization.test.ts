import { describe, expect, it } from 'vitest'
import { shouldEnableVirtualRootBlockRendering } from './shouldEnableVirtualization'

describe('shouldEnableVirtualRootBlockRendering', () => {
  it('keeps virtualization disabled when the feature flag is off', () => {
    expect(
      shouldEnableVirtualRootBlockRendering({
        flagEnabled: false,
        rootBlockCount: 10000,
      })
    ).toEqual({
      enabled: false,
      reason: 'flag-disabled',
      threshold: 1500,
    })
  })

  it('enables virtualization for large markdown documents', () => {
    expect(
      shouldEnableVirtualRootBlockRendering({
        flagEnabled: true,
        rootBlockCount: 1500,
      })
    ).toEqual({
      enabled: true,
      reason: 'enabled',
      threshold: 1500,
    })
  })

  it('keeps small documents and non-markdown documents on the normal path', () => {
    expect(
      shouldEnableVirtualRootBlockRendering({
        flagEnabled: true,
        rootBlockCount: 1499,
      }).reason
    ).toBe('below-threshold')

    expect(
      shouldEnableVirtualRootBlockRendering({
        flagEnabled: true,
        rootBlockCount: 10000,
        isMarkdownDocument: false,
      }).reason
    ).toBe('non-markdown-document')
  })
})
