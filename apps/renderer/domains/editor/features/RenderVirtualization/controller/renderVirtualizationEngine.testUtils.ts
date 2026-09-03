import { Schema } from 'prosemirror-model'
import { EditorState } from 'prosemirror-state'
import { setFlag } from '../../../ui/services/editorFeatureFlags'
import {
  createRenderVirtualizationPlugin,
  prepareInitialRenderVirtualizationState,
} from '../state/renderVirtualizationPlugin'

const schema = new Schema({
  nodes: {
    doc: { content: 'rootBlock+' },
    text: { group: 'inline' },
    rootBlock: {
      group: 'block',
      attrs: { id: { default: null } },
      content: 'paragraph',
      toDOM: (node) => ['div', { 'data-id': node.attrs.id }, 0],
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

export function createState(blockIds: readonly string[]): EditorState {
  const state = EditorState.create({
    schema,
    doc: schema.nodes.doc.create(
      null,
      blockIds.map((id) =>
        schema.nodes.rootBlock.create(
          { id },
          schema.nodes.paragraph.create(null, schema.text(id))
        )
      )
    ),
    plugins: [createRenderVirtualizationPlugin()],
  })

  return prepareInitialRenderVirtualizationState(state, {
    enabled: true,
    initialHydratedBlockCount: 0,
  })
}

export function createPluginDisabledState(blockIds: readonly string[]): EditorState {
  return EditorState.create({
    schema,
    doc: schema.nodes.doc.create(
      null,
      blockIds.map((id) =>
        schema.nodes.rootBlock.create(
          { id },
          schema.nodes.paragraph.create(null, schema.text(id))
        )
      )
    ),
    plugins: [createRenderVirtualizationPlugin()],
  })
}

export function setRect(
  el: HTMLElement,
  rect: { top: number; bottom: number; height: number }
): void {
  Object.defineProperty(el, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      top: rect.top,
      bottom: rect.bottom,
      left: 0,
      right: 800,
      width: 800,
      height: rect.height,
    }),
  })
}

export function enableVirtualRootBlockRendering(): void {
  setFlag('virtualRootBlockRendering', true)
}

export function disableVirtualRootBlockRendering(): void {
  setFlag('virtualRootBlockRendering', false)
}

export function createMutableScrollTopElement(initialScrollTop: number): {
  scrollRoot: HTMLElement
  setScrollTop: (scrollTop: number) => void
} {
  const scrollRoot = document.createElement('div')
  let scrollTop = initialScrollTop
  Object.defineProperty(scrollRoot, 'scrollTop', {
    configurable: true,
    get: () => scrollTop,
    set: (nextScrollTop: number) => {
      scrollTop = nextScrollTop
    },
  })
  return {
    scrollRoot,
    setScrollTop: (nextScrollTop) => {
      scrollTop = nextScrollTop
    },
  }
}
