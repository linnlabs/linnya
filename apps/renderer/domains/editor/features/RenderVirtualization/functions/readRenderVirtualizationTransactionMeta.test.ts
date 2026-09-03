import { describe, expect, it } from 'vitest'
import {
  hasRenderVirtualizationTransactionMeta,
  hasRenderVirtualizationTransactionPayload,
} from './readRenderVirtualizationTransactionMeta'
import {
  RENDER_VIRTUALIZATION_META_KEY,
  renderVirtualizationPluginKey,
} from '../state/renderVirtualizationPlugin'

describe('readRenderVirtualizationTransactionMeta', () => {
  it('detects plugin-key render virtualization meta without exposing the key to callers', () => {
    const transaction = {
      getMeta(key: unknown): unknown {
        return key === renderVirtualizationPluginKey ? { hydrate: ['root-a'] } : undefined
      },
    }

    expect(hasRenderVirtualizationTransactionMeta(transaction)).toBe(true)
    expect(hasRenderVirtualizationTransactionPayload({ transaction })).toBe(true)
  })

  it('detects string-key render virtualization meta for legacy diagnostics', () => {
    const transaction = {
      getMeta(key: unknown): unknown {
        return key === RENDER_VIRTUALIZATION_META_KEY ? { reset: true } : undefined
      },
    }

    expect(hasRenderVirtualizationTransactionMeta(transaction)).toBe(true)
  })

  it('returns false for unrelated or malformed payloads', () => {
    expect(hasRenderVirtualizationTransactionMeta(null)).toBe(false)
    expect(hasRenderVirtualizationTransactionPayload({ transaction: {} })).toBe(false)
    expect(hasRenderVirtualizationTransactionPayload({
      transaction: {
        getMeta: () => undefined,
      },
    })).toBe(false)
  })
})
