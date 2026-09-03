// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest'
import { ROOT_BLOCK_RENDER_MODE_SPEC_KEY } from '../../features/RenderVirtualization/view/rootBlockRenderMode'
import {
  getRootBlockNodeViewLifecycleEntry,
  resetRootBlockNodeViewLifecycleRegistry,
} from '../../features/RenderVirtualization/state/nodeViewLifecycle'
import { createRootBlockShellView } from './RootBlockShellView'

const rootBlockType = { name: 'rootBlock' }
const owner = {}

function createRootBlockNode(id) {
  return {
    type: rootBlockType,
    attrs: { id },
    firstChild: {
      type: { name: 'baseBlock' },
    },
  }
}

afterEach(() => {
  resetRootBlockNodeViewLifecycleRegistry(owner)
})

describe('createRootBlockShellView', () => {
  it('marks hydrated shell DOM and keeps contentDOM', () => {
    const view = createRootBlockShellView(createRootBlockNode('block-a'), {
      lifecycleOwner: owner,
    })

    expect(view.dom.dataset.nodeType).toBe('rootBlockOuter')
    expect(view.dom.dataset.id).toBe('block-a')
    expect(view.dom.dataset.placeholder).toBe('false')
    expect(view.dom.dataset.rootBlockRenderMode).toBe('hydrated')
    expect(view.contentDOM).toBeInstanceOf(HTMLElement)
    expect(view.revisionHeaderEl).toBeInstanceOf(HTMLElement)
    expect(view.revisionHeaderEl.hidden).toBe(true)
    expect(view.dom.firstElementChild).toBe(view.revisionHeaderEl)
  })

  it('asks ProseMirror to rebuild when the mode becomes placeholder', () => {
    const view = createRootBlockShellView(createRootBlockNode('block-a'), {
      lifecycleOwner: owner,
    })
    const decorations = [{ spec: { [ROOT_BLOCK_RENDER_MODE_SPEC_KEY]: 'placeholder' } }]

    expect(view.update?.(createRootBlockNode('block-a'), decorations, null)).toBe(false)
  })

  it('ignores chrome DOM mutations outside contentDOM', () => {
    const view = createRootBlockShellView(createRootBlockNode('block-a'), {
      lifecycleOwner: owner,
    })
    const indicator = document.createElement('div')

    view.revisionHeaderEl.append(indicator)

    expect(
      view.ignoreMutation?.({
        type: 'childList',
        target: view.revisionHeaderEl,
      })
    ).toBe(true)
    expect(
      view.ignoreMutation?.({
        type: 'attributes',
        target: view.rootBlockEl,
      })
    ).toBe(true)
  })

  it('does not ignore editable content mutations or selection changes', () => {
    const view = createRootBlockShellView(createRootBlockNode('block-a'), {
      lifecycleOwner: owner,
    })
    const textNode = document.createTextNode('hello')
    view.contentDOM.append(textNode)

    expect(
      view.ignoreMutation?.({
        type: 'childList',
        target: view.contentDOM,
      })
    ).toBe(false)
    expect(
      view.ignoreMutation?.({
        type: 'characterData',
        target: textNode,
      })
    ).toBe(false)
    expect(
      view.ignoreMutation?.({
        type: 'selection',
        target: view.dom,
      })
    ).toBe(false)
  })

  it('publishes lifecycle entries to the provided owner registry', () => {
    const view = createRootBlockShellView(createRootBlockNode('block-a'), {
      lifecycleOwner: owner,
    })

    expect(getRootBlockNodeViewLifecycleEntry('block-a', owner)?.dom).toBe(view.dom)

    view.destroy?.()

    expect(getRootBlockNodeViewLifecycleEntry('block-a', owner)).toBeNull()
  })
})
