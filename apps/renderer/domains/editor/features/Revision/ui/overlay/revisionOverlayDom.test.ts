// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  collectRevisionOverlayRootBlocks,
} from './revisionOverlayDom'

function setRect(el: HTMLElement, rect: {
  top: number
  left?: number
  bottom: number
  right?: number
  width?: number
  height?: number
}): void {
  Object.defineProperty(el, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      top: rect.top,
      left: rect.left ?? 0,
      bottom: rect.bottom,
      right: rect.right ?? (rect.left ?? 0) + (rect.width ?? 100),
      width: rect.width ?? 100,
      height: rect.height ?? rect.bottom - rect.top,
      x: rect.left ?? 0,
      y: rect.top,
      toJSON: () => ({}),
    }),
  })
}

function resetElementsFromPoint(): void {
  Reflect.deleteProperty(document, 'elementsFromPoint')
}

function createRootBlock(blockId: string): HTMLElement {
  const outer = document.createElement('div')
  outer.className = 'root-block-outer'
  outer.dataset.id = blockId

  const rootBlock = document.createElement('div')
  rootBlock.className = 'root-block'
  outer.append(rootBlock)
  return outer
}

describe('revisionOverlayDom', () => {
  afterEach(() => {
    resetElementsFromPoint()
    vi.restoreAllMocks()
  })

  it('collects root block geometry relative to the overlay root', () => {
    const editorRoot = document.createElement('div')
    const overlayRoot = document.createElement('div')
    const visible = createRootBlock('b1')
    const hidden = createRootBlock('b2')
    editorRoot.append(visible, hidden)

    setRect(editorRoot, { top: 0, left: 0, bottom: 500, right: 300, width: 300 })
    setRect(overlayRoot, { top: 100, left: 10, bottom: 500, width: 300 })
    setRect(visible.firstElementChild as HTMLElement, {
      top: 120,
      left: 40,
      bottom: 150,
      width: 200,
    })
    setRect(hidden.firstElementChild as HTMLElement, {
      top: 2000,
      left: 40,
      bottom: 2030,
      width: 200,
    })
    Object.defineProperty(document, 'elementsFromPoint', {
      configurable: true,
      value: vi.fn(() => [visible.firstElementChild as HTMLElement]),
    })

    expect(collectRevisionOverlayRootBlocks({
      editorRoot,
      overlayRoot,
      scrollRoot: null,
      marginPx: 0,
      includeBlockIds: ['b1'],
    })).toEqual([
      {
        blockId: 'b1',
        top: 20,
        left: 30,
        width: 200,
        height: 30,
        bottom: 50,
        isPlaceholder: false,
        renderMode: null,
      },
    ])
  })

  it('measures only forced toolbar target blocks instead of every root block', () => {
    const editorRoot = document.createElement('div')
    const overlayRoot = document.createElement('div')
    const visible = createRootBlock('visible')
    const hiddenBlocks = Array.from({ length: 1000 }, (_, index) => {
      const block = createRootBlock(`hidden-${index}`)
      Object.defineProperty(block.firstElementChild as HTMLElement, 'getBoundingClientRect', {
        configurable: true,
        value: () => {
          throw new Error('offscreen block should not be measured')
        },
      })
      return block
    })

    editorRoot.append(visible, ...hiddenBlocks)
    setRect(editorRoot, {
      top: 0,
      left: 0,
      bottom: 400,
      right: 300,
      width: 300,
      height: 400,
    })
    setRect(overlayRoot, { top: 0, left: 0, bottom: 400, width: 300 })
    setRect(visible.firstElementChild as HTMLElement, {
      top: 20,
      left: 20,
      bottom: 50,
      width: 200,
    })
    Object.defineProperty(document, 'elementsFromPoint', {
      configurable: true,
      value: vi.fn(() => [visible.firstElementChild as HTMLElement]),
    })

    expect(collectRevisionOverlayRootBlocks({
      editorRoot,
      overlayRoot,
      scrollRoot: null,
      marginPx: 0,
      includeBlockIds: ['visible'],
    })).toEqual([
      {
        blockId: 'visible',
        top: 20,
        left: 20,
        width: 200,
        height: 30,
        bottom: 50,
        isPlaceholder: false,
        renderMode: null,
      },
    ])
  })

  it('does not sample the viewport while collecting toolbar geometry', () => {
    const editorRoot = document.createElement('div')
    const overlayRoot = document.createElement('div')
    const visible = createRootBlock('visible')
    editorRoot.append(visible)
    setRect(overlayRoot, { top: 0, left: 0, bottom: 400, width: 300 })
    setRect(visible, { top: 20, left: 20, bottom: 50, width: 200 })
    setRect(visible.firstElementChild as HTMLElement, {
      top: 20,
      left: 20,
      bottom: 50,
      width: 200,
    })

    const elementsFromPoint = vi.fn(() => {
      throw new Error('overlay should reuse the shared viewport snapshot')
    })
    Object.defineProperty(document, 'elementsFromPoint', {
      configurable: true,
      value: elementsFromPoint,
    })
    expect(collectRevisionOverlayRootBlocks({
      editorRoot,
      overlayRoot,
      scrollRoot: null,
      marginPx: 0,
      includeBlockIds: ['visible'],
    })).toMatchObject([
      {
        blockId: 'visible',
        top: 20,
        left: 20,
        width: 200,
        height: 30,
      },
    ])
    expect(elementsFromPoint).not.toHaveBeenCalled()
  })

})
