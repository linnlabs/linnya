// @vitest-environment jsdom

import { Schema } from 'prosemirror-model'
import { EditorState } from 'prosemirror-state'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { planRenderWindowRefresh } from './renderWindowPlanner'

const heightCacheMocks = vi.hoisted(() => ({
  estimateTotalLayoutHeight: vi.fn(() => 1000),
  getLayoutHeight: vi.fn(() => 100),
}))

vi.mock('../state/blockHeightCacheRegistry', () => ({
  estimateRenderVirtualizationTotalLayoutHeight: heightCacheMocks.estimateTotalLayoutHeight,
  getRenderVirtualizationBlockLayoutHeight: heightCacheMocks.getLayoutHeight,
}))

const schema = new Schema({
  nodes: {
    doc: { content: 'rootBlock+' },
    text: { group: 'inline' },
    rootBlock: {
      group: 'block',
      attrs: { id: { default: null } },
      content: 'paragraph',
      toDOM: node => ['div', { 'data-id': node.attrs.id }, 0],
      parseDOM: [{ tag: 'div[data-id]' }],
    },
    paragraph: {
      group: 'block',
      content: 'text*',
      toDOM: () => ['p', 0],
      parseDOM: [{ tag: 'p' }],
    },
  },
})

function createState(blockCount: number): EditorState {
  const rootBlocks = Array.from({ length: blockCount }, (_value, index) =>
    schema.nodes.rootBlock.create(
      { id: `block-${index}` },
      schema.nodes.paragraph.create(null, schema.text(`block ${index}`))
    )
  )

  return EditorState.create({
    schema,
    doc: schema.nodes.doc.create(null, rootBlocks),
  })
}

function createScrollRoot(): HTMLElement {
  const scrollRoot = document.createElement('div')
  Object.defineProperties(scrollRoot, {
    scrollTop: {
      configurable: true,
      value: 0,
      writable: true,
    },
    clientHeight: {
      configurable: true,
      value: 800,
    },
    scrollHeight: {
      configurable: true,
      value: 1000,
    },
  })
  Object.defineProperty(scrollRoot, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      left: 0,
      right: 800,
      top: 0,
      bottom: 800,
      width: 800,
      height: 800,
    }),
  })
  return scrollRoot
}

function createEditorRoot(anchorBlockId?: string): HTMLElement {
  const editorRoot = document.createElement('div')
  Object.defineProperty(editorRoot, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      left: 0,
      right: 800,
      top: 0,
      bottom: 1000,
      width: 800,
      height: 1000,
    }),
  })

  if (anchorBlockId) {
    const block = document.createElement('div')
    block.className = 'root-block-outer'
    block.dataset.id = anchorBlockId
    editorRoot.appendChild(block)
  }

  return editorRoot
}

function stubElementsFromPoint(elements: Element[]): void {
  Object.defineProperty(document, 'elementsFromPoint', {
    configurable: true,
    value: vi.fn(() => elements),
  })
}

describe('planRenderWindowRefresh', () => {
  const owner = {}

  afterEach(() => {
    heightCacheMocks.estimateTotalLayoutHeight.mockClear()
    heightCacheMocks.getLayoutHeight.mockClear()
    vi.restoreAllMocks()
  })

  it('does not build per-block height metrics when a DOM anchor can select the scroll window', () => {
    const editorState = createState(1000)
    const editorRoot = createEditorRoot('block-400')
    const scrollRoot = createScrollRoot()
    const anchor = editorRoot.querySelector('.root-block-outer')
    stubElementsFromPoint(anchor ? [anchor] : [])

    const plan = planRenderWindowRefresh({
      editorState,
      editorRoot,
      scrollRoot,
      reason: { type: 'scroll', source: 'native' },
      previousScrollTop: 0,
      overscanPx: 0,
      maxWindowBlockCount: 20,
      currentHydratedBlockIds: [],
      owner,
    })

    expect(plan.visibleWindow.source).toBe('dom-anchor')
    expect(plan.visibleBlockIds).toContain('block-400')
    expect(heightCacheMocks.estimateTotalLayoutHeight).toHaveBeenCalledTimes(1)
    expect(heightCacheMocks.getLayoutHeight).not.toHaveBeenCalled()
  })

  it('builds per-block height metrics only for the height-cache fallback path', () => {
    const editorState = createState(12)
    const editorRoot = createEditorRoot()
    const scrollRoot = createScrollRoot()
    stubElementsFromPoint([])

    const plan = planRenderWindowRefresh({
      editorState,
      editorRoot,
      scrollRoot,
      reason: { type: 'scroll', source: 'native' },
      previousScrollTop: 0,
      overscanPx: 0,
      maxWindowBlockCount: 20,
      currentHydratedBlockIds: [],
      owner,
    })

    expect(plan.visibleWindow.source).toBe('height-cache')
    expect(heightCacheMocks.getLayoutHeight).toHaveBeenCalledTimes(12)
  })
})
