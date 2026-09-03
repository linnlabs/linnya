// @vitest-environment jsdom

import type { Node as ProseMirrorNode } from 'prosemirror-model'
import { DecorationSet, type Decoration } from 'prosemirror-view'
import { afterEach, describe, expect, it } from 'vitest'
import {
  getRootBlockNodeViewLifecycleEntry,
  resetRootBlockNodeViewLifecycleRegistry,
  subscribeRootBlockNodeViewLifecycle,
} from '../state/nodeViewLifecycle'
import {
  getRootBlockRuntimeRegistry,
  resetRootBlockRuntimeRegistry,
} from '../runtime/RootBlockRuntimeRegistry'
import { createRootBlockDomNodeView } from './RootBlockDomNodeView'
import { ROOT_BLOCK_RENDER_MODE_SPEC_KEY } from './rootBlockRenderMode'
import { ROOT_BLOCK_DOM_ATTRS, ROOT_BLOCK_DOM_CLASSES } from '../../../shared/rootBlockDomContract'

const rootBlockType = { name: 'rootBlock' }
const owner = {}

function createRootBlockNode(id: string): ProseMirrorNode {
  return {
    type: rootBlockType,
    attrs: {
      id,
      annotationIds: [],
    },
    firstChild: {
      type: { name: 'baseBlock' },
    },
  } as unknown as ProseMirrorNode
}

afterEach(() => {
  resetRootBlockRuntimeRegistry(owner)
  resetRootBlockNodeViewLifecycleRegistry(owner)
})

describe('createRootBlockDomNodeView', () => {
  it('creates hydrated DOM shell and registers runtime handle', () => {
    const view = createRootBlockDomNodeView(createRootBlockNode('block-a'), {
      getPos: () => 7,
      runtimeRegistryOwner: owner,
    })
    const dom = view.dom as HTMLElement
    const handle = getRootBlockRuntimeRegistry(owner).getHydrated('block-a')

    expect(dom.dataset.nodeType).toBe('rootBlockOuter')
    expect(dom.dataset.id).toBe('block-a')
    expect(dom.dataset.placeholder).toBe('false')
    expect(dom.dataset.rootBlockRenderMode).toBe('hydrated')
    expect(dom.querySelector(`.${ROOT_BLOCK_DOM_CLASSES.chromeAnchor}`)).toBeInstanceOf(HTMLElement)
    expect(
      dom.querySelector(`.${ROOT_BLOCK_DOM_CLASSES.body} > .${ROOT_BLOCK_DOM_CLASSES.chromeAnchor}`)
    ).toBeInstanceOf(HTMLElement)
    expect(
      dom.querySelector(
        `.${ROOT_BLOCK_DOM_CLASSES.body} > .${ROOT_BLOCK_DOM_CLASSES.revisionHeader}`
      )
    ).toBeInstanceOf(HTMLElement)
    expect(dom.querySelector(`[${ROOT_BLOCK_DOM_ATTRS.historyMount}="true"]`)).toBeInstanceOf(
      HTMLElement
    )
    expect(view.contentDOM).toBeInstanceOf(HTMLElement)
    expect(handle?.getDom()).toBe(dom)
    expect(handle?.getContentDom()).toBe(view.contentDOM)
    expect(handle?.getRevisionHeaderMount?.()).toBe(
      dom.querySelector(
        `.${ROOT_BLOCK_DOM_CLASSES.body} > .${ROOT_BLOCK_DOM_CLASSES.revisionHeader}`
      )
    )
    expect(handle?.getPos()).toBe(7)
    expect(getRootBlockNodeViewLifecycleEntry('block-a', owner)?.mode).toBe('hydrated')
  })

  it('updates in place while render mode remains hydrated', () => {
    const view = createRootBlockDomNodeView(createRootBlockNode('block-a'), {
      runtimeRegistryOwner: owner,
    })
    const nextNode = createRootBlockNode('block-b')
    const decorations = [
      { spec: { [ROOT_BLOCK_RENDER_MODE_SPEC_KEY]: 'hydrated' } },
    ] as unknown as Decoration[]

    const updated = view.update?.(nextNode, decorations, DecorationSet.empty)

    expect(updated).toBe(true)
    expect((view.dom as HTMLElement).dataset.id).toBe('block-b')
    expect(getRootBlockRuntimeRegistry(owner).get('block-a')).toBeNull()
    expect(getRootBlockRuntimeRegistry(owner).getHydrated('block-b')?.getDom()).toBe(view.dom)
  })

  it('does not republish lifecycle events for same-block attribute updates', () => {
    const view = createRootBlockDomNodeView(createRootBlockNode('block-a'), {
      runtimeRegistryOwner: owner,
    })
    const events: string[] = []
    const unsubscribe = subscribeRootBlockNodeViewLifecycle(
      event => {
        events.push(event.type)
      },
      { owner }
    )
    const decorations = [
      { spec: { [ROOT_BLOCK_RENDER_MODE_SPEC_KEY]: 'hydrated' } },
    ] as unknown as Decoration[]

    const updated = view.update?.(createRootBlockNode('block-a'), decorations, DecorationSet.empty)
    unsubscribe()

    expect(updated).toBe(true)
    expect(events).toEqual([])
  })

  it('asks ProseMirror to rebuild when render mode becomes placeholder', () => {
    const view = createRootBlockDomNodeView(createRootBlockNode('block-a'), {
      runtimeRegistryOwner: owner,
    })
    const decorations = [
      { spec: { [ROOT_BLOCK_RENDER_MODE_SPEC_KEY]: 'placeholder' } },
    ] as unknown as Decoration[]

    expect(view.update?.(createRootBlockNode('block-a'), decorations, DecorationSet.empty)).toBe(
      false
    )
  })

  it('ignores chrome anchor mutations but not editable content mutations', () => {
    const view = createRootBlockDomNodeView(createRootBlockNode('block-a'), {
      runtimeRegistryOwner: owner,
    })
    const chromeAnchor = (view.dom as HTMLElement).querySelector(
      `.${ROOT_BLOCK_DOM_CLASSES.chromeAnchor}`
    )
    const textNode = document.createTextNode('hello')
    view.contentDOM?.append(textNode)

    expect(chromeAnchor).toBeInstanceOf(HTMLElement)
    expect(
      view.ignoreMutation?.({
        type: 'childList',
        target: chromeAnchor as HTMLElement,
      })
    ).toBe(true)
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

  it('unregisters runtime and lifecycle entries on destroy', () => {
    const view = createRootBlockDomNodeView(createRootBlockNode('block-a'), {
      runtimeRegistryOwner: owner,
    })

    view.destroy?.()

    expect(getRootBlockRuntimeRegistry(owner).get('block-a')).toBeNull()
    expect(getRootBlockNodeViewLifecycleEntry('block-a', owner)).toBeNull()
  })
})
