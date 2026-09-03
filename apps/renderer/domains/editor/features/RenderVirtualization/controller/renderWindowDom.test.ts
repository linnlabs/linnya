// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  recordRenderVirtualizationBlockHeight,
  resetRenderVirtualizationBlockHeightCache,
} from '../state/blockHeightCacheRegistry'
import { syncExistingPlaceholderHeights } from './renderWindowDom'

const owner = {}

function createMeasuredElement(height: number): HTMLElement {
  const element = document.createElement('div')
  vi.spyOn(element, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 100, height))
  return element
}

describe('syncExistingPlaceholderHeights', () => {
  afterEach(() => {
    resetRenderVirtualizationBlockHeightCache(owner)
    vi.restoreAllMocks()
  })

  it('syncs existing placeholder DOM to the adaptive cache height', () => {
    resetRenderVirtualizationBlockHeightCache(owner)
    for (let index = 0; index < 8; index += 1) {
      recordRenderVirtualizationBlockHeight(`measured-${index}`, createMeasuredElement(48), owner)
    }

    const editorRoot = document.createElement('div')
    const placeholder = document.createElement('div')
    placeholder.className = 'root-block-outer root-block-virtual-placeholder'
    placeholder.dataset.id = 'unknown-block'
    placeholder.style.minHeight = '120px'
    editorRoot.appendChild(placeholder)

    const result = syncExistingPlaceholderHeights({ editorRoot, owner })

    expect(result.checkedCount).toBe(1)
    expect(result.updatedCount).toBe(1)
    expect(placeholder.style.minHeight).toBe('48px')
  })
})
