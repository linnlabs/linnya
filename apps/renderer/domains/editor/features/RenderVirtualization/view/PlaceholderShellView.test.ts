// @vitest-environment jsdom

import type { Node as ProseMirrorNode } from 'prosemirror-model'
import { DecorationSet, type Decoration } from 'prosemirror-view'
import { describe, expect, it } from 'vitest'
import { createPlaceholderShellView } from './PlaceholderShellView'
import { ROOT_BLOCK_RENDER_MODE_SPEC_KEY } from './rootBlockRenderMode'

const rootBlockType = { name: 'rootBlock' }
const owner = {}

function createRootBlockNode(id: string): ProseMirrorNode {
  return {
    type: rootBlockType,
    attrs: { id },
  } as unknown as ProseMirrorNode
}

describe('createPlaceholderShellView', () => {
  it('creates a rootBlock placeholder without contentDOM', () => {
    const view = createPlaceholderShellView(createRootBlockNode('block-a'), {
      estimatedHeight: 88,
      runtimeRegistryOwner: owner,
    })
    const dom = view.dom as HTMLElement

    expect(dom.dataset.nodeType).toBe('rootBlockOuter')
    expect(dom.dataset.id).toBe('block-a')
    expect(dom.dataset.placeholder).toBe('true')
    expect(dom.dataset.rootBlockRenderMode).toBe('placeholder')
    expect(dom.style.minHeight).toBe('88px')
    expect('contentDOM' in view).toBe(false)
  })

  it('updates in place while the decoration mode remains placeholder', () => {
    const view = createPlaceholderShellView(createRootBlockNode('block-a'), {
      runtimeRegistryOwner: owner,
    })
    const nextNode = createRootBlockNode('block-b')

    const decorations = [
      { spec: { [ROOT_BLOCK_RENDER_MODE_SPEC_KEY]: 'placeholder' } },
    ] as unknown as Decoration[]

    const updated = view.update?.(nextNode, decorations, DecorationSet.empty)

    expect(updated).toBe(true)
    expect((view.dom as HTMLElement).dataset.id).toBe('block-b')
  })

  it('asks ProseMirror to rebuild when the mode becomes hydrated', () => {
    const view = createPlaceholderShellView(createRootBlockNode('block-a'), {
      runtimeRegistryOwner: owner,
    })

    const decorations = [
      { spec: { [ROOT_BLOCK_RENDER_MODE_SPEC_KEY]: 'hydrated' } },
    ] as unknown as Decoration[]

    const updated = view.update?.(createRootBlockNode('block-a'), decorations, DecorationSet.empty)

    expect(updated).toBe(false)
  })
})
