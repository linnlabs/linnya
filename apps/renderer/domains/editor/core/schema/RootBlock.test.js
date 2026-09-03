// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { RootBlock } from './RootBlock'
import {
  setFlag,
  setLargeDocumentShellMode,
  setLargeDocumentShellModeForOwner,
  setVirtualRootBlockRenderingActive,
  setVirtualRootBlockRenderingActiveForOwner,
} from '../../ui/services/editorFeatureFlags'
import { ROOT_BLOCK_RENDER_MODE_SPEC_KEY } from '../../features/RenderVirtualization/view/rootBlockRenderMode'
import {
  ROOT_BLOCK_DOM_ATTRS,
  ROOT_BLOCK_DOM_CLASSES,
  ROOT_BLOCK_DOM_NODE_TYPES,
} from '../../shared/rootBlockDomContract'

const nodeViewMocks = vi.hoisted(() => {
  const vueNodeView = { kind: 'vue-node-view' }
  return {
    vueNodeView,
    vueRenderer: vi.fn(() => vi.fn(() => vueNodeView)),
  }
})

vi.mock('../../ui/BlockView.vue', () => ({ default: {} }))
vi.mock('@tiptap/vue-3', () => ({
  VueNodeViewRenderer: nodeViewMocks.vueRenderer,
}))

function getRootBlockParseRule() {
  const rules = RootBlock.config.parseHTML()
  const rule = rules.find(item => item.tag === 'div.root-block-outer[data-id]')
  if (!rule) {
    throw new Error('RootBlock parseHTML 缺少 root-block-outer 规则')
  }
  return rule
}

function createRootBlockElement(attrs = {}) {
  const element = document.createElement('div')
  element.className = 'root-block-outer'
  element.setAttribute('data-id', 'root-a')

  for (const [name, value] of Object.entries(attrs)) {
    if (name === 'class') {
      element.className = String(value)
    } else {
      element.setAttribute(name, String(value))
    }
  }

  return element
}

function resetRootBlockFeatureFlags() {
  setFlag('rootBlockShellEnabled', false)
  setFlag('virtualRootBlockRendering', true)
  setLargeDocumentShellMode(false)
  setVirtualRootBlockRenderingActive(false)
}

function createRootBlockNode(id = 'root-a') {
  return {
    attrs: {
      id,
      annotationIds: [],
    },
    firstChild: null,
  }
}

function createNodeViewProps(mode = 'hydrated', editor = { state: null }) {
  return {
    node: createRootBlockNode(),
    decorations: [
      {
        spec: {
          [ROOT_BLOCK_RENDER_MODE_SPEC_KEY]: mode,
        },
      },
    ],
    editor,
    selected: false,
    extension: {},
    getPos: () => 0,
    updateAttributes: () => {},
    deleteNode: () => {},
  }
}

afterEach(() => {
  resetRootBlockFeatureFlags()
  nodeViewMocks.vueRenderer.mockClear()
})

describe('RootBlock parseHTML', () => {
  it('renders the canonical rootBlock DOM shell for HTML serialization', () => {
    const spec = RootBlock.config.renderHTML({
      HTMLAttributes: {
        [ROOT_BLOCK_DOM_ATTRS.id]: 'root-a',
      },
    })

    expect(spec).toEqual([
      'div',
      {
        class: ROOT_BLOCK_DOM_CLASSES.outer,
        [ROOT_BLOCK_DOM_ATTRS.nodeType]: ROOT_BLOCK_DOM_NODE_TYPES.outer,
        [ROOT_BLOCK_DOM_ATTRS.id]: 'root-a',
      },
      [
        'div',
        {
          class: ROOT_BLOCK_DOM_CLASSES.body,
          [ROOT_BLOCK_DOM_ATTRS.nodeType]: ROOT_BLOCK_DOM_NODE_TYPES.body,
        },
        0,
      ],
    ])
  })

  it('accepts hydrated rootBlock DOM', () => {
    const rule = getRootBlockParseRule()
    const element = createRootBlockElement({
      'data-placeholder': 'false',
      'data-root-block-render-mode': 'hydrated',
    })

    expect(rule.getAttrs?.(element)).toBeNull()
  })

  it('rejects virtual placeholder rootBlock DOM during paste parsing', () => {
    const rule = getRootBlockParseRule()

    expect(rule.getAttrs?.(createRootBlockElement({
      'data-placeholder': 'true',
    }))).toBe(false)

    expect(rule.getAttrs?.(createRootBlockElement({
      'data-root-block-render-mode': 'placeholder',
    }))).toBe(false)

    expect(rule.getAttrs?.(createRootBlockElement({
      class: 'root-block-outer root-block-virtual-placeholder',
    }))).toBe(false)
  })
})

describe('RootBlock addNodeView', () => {
  it('renders virtualized offscreen rootBlocks as placeholders', () => {
    const editor = { state: null }
    setLargeDocumentShellModeForOwner(editor, true)
    setVirtualRootBlockRenderingActiveForOwner(editor, true)

    const createNodeView = RootBlock.config.addNodeView()
    const nodeView = createNodeView(createNodeViewProps('placeholder', editor))

    expect(nodeView.dom).toBeInstanceOf(HTMLElement)
    expect(nodeView.dom.getAttribute('data-placeholder')).toBe('true')
    expect(nodeView.dom.classList.contains('root-block-virtual-placeholder')).toBe(true)
  })

  it('renders virtualized hydrated rootBlocks through native DOM NodeView', () => {
    const editor = { state: null }
    setLargeDocumentShellModeForOwner(editor, true)
    setVirtualRootBlockRenderingActiveForOwner(editor, true)

    const createNodeView = RootBlock.config.addNodeView()
    const nodeView = createNodeView(createNodeViewProps('hydrated', editor))

    expect(nodeView).not.toBe(nodeViewMocks.vueNodeView)
    expect(nodeView.dom).toBeInstanceOf(HTMLElement)
    expect(nodeView.dom.getAttribute('data-placeholder')).toBe('false')
    expect(nodeView.dom.getAttribute('data-root-block-render-mode')).toBe('hydrated')
    expect(nodeView.dom.querySelector('.root-block-chrome-anchor')).toBeInstanceOf(HTMLElement)
    expect(nodeView.contentDOM).toBeInstanceOf(HTMLElement)
    expect(nodeView.dom.querySelector('.root-block-revision-header')).toBeInstanceOf(HTMLElement)
  })

  it('keeps Vue BlockView for normal non-virtualized rootBlocks', () => {
    setLargeDocumentShellMode(false)
    setVirtualRootBlockRenderingActive(false)

    const createNodeView = RootBlock.config.addNodeView()
    const nodeView = createNodeView(createNodeViewProps('hydrated'))

    expect(nodeView).toBe(nodeViewMocks.vueNodeView)
  })

  it('uses editor-scoped virtualization runtime instead of the legacy global active flag', () => {
    const editorA = { state: null }
    const editorB = { state: null }
    setVirtualRootBlockRenderingActive(true)
    setVirtualRootBlockRenderingActiveForOwner(editorA, true)
    setVirtualRootBlockRenderingActiveForOwner(editorB, false)

    const createNodeView = RootBlock.config.addNodeView()
    const nodeViewA = createNodeView(createNodeViewProps('placeholder', editorA))
    const nodeViewB = createNodeView(createNodeViewProps('placeholder', editorB))

    expect(nodeViewA).not.toBe(nodeViewMocks.vueNodeView)
    expect(nodeViewA.dom.getAttribute('data-placeholder')).toBe('true')
    expect(nodeViewB).toBe(nodeViewMocks.vueNodeView)
  })

  it('uses editor-scoped shell runtime for the non-virtualized shell path', () => {
    const editorA = { state: null }
    const editorB = { state: null }
    setLargeDocumentShellMode(true)
    setLargeDocumentShellModeForOwner(editorA, true)
    setLargeDocumentShellModeForOwner(editorB, false)
    setVirtualRootBlockRenderingActiveForOwner(editorA, false)
    setVirtualRootBlockRenderingActiveForOwner(editorB, false)

    const createNodeView = RootBlock.config.addNodeView()
    const nodeViewA = createNodeView(createNodeViewProps('hydrated', editorA))
    const nodeViewB = createNodeView(createNodeViewProps('hydrated', editorB))

    expect(nodeViewA).not.toBe(nodeViewMocks.vueNodeView)
    expect(nodeViewA.dom.querySelector('.root-block-revision-header')).toBeInstanceOf(HTMLElement)
    expect(nodeViewB).toBe(nodeViewMocks.vueNodeView)
  })

  it('keeps native Shell only for the non-virtualized shell pressure-test path', () => {
    const editor = { state: null }
    setLargeDocumentShellModeForOwner(editor, true)
    setVirtualRootBlockRenderingActiveForOwner(editor, false)

    const createNodeView = RootBlock.config.addNodeView()
    const nodeView = createNodeView(createNodeViewProps('hydrated', editor))

    expect(nodeView).not.toBe(nodeViewMocks.vueNodeView)
    expect(nodeView.dom).toBeInstanceOf(HTMLElement)
    expect(nodeView.dom.querySelector('.root-block-revision-header')).toBeInstanceOf(HTMLElement)
  })
})
