import { Schema } from 'prosemirror-model'
import { EditorState } from 'prosemirror-state'
import { DecorationSet } from 'prosemirror-view'
import { describe, expect, it } from 'vitest'
import type { RenderVirtualizationState } from '../state/renderVirtualizationPlugin'
import {
  collectDehydratableBlockIds,
  collectHydratedLikeBlockIds,
  readActualHydratedWindowBlockIds,
} from './renderWindowState'
import {
  createRenderVirtualizationPlugin,
  prepareInitialRenderVirtualizationState,
  renderVirtualizationPluginKey,
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

function createVirtualizationState(params: {
  enabled?: boolean
  hydrated?: readonly string[]
  pinned?: readonly string[]
}): RenderVirtualizationState {
  return {
    enabled: params.enabled ?? true,
    hydratedSet: new Set(params.hydrated ?? []),
    pinnedSet: new Set(params.pinned ?? []),
    decorations: DecorationSet.empty,
  }
}

function createEditorState(): EditorState {
  const baseState = EditorState.create({
    schema,
    doc: schema.nodes.doc.create(
      null,
      ['block-a', 'block-b', 'block-c'].map((id) =>
        schema.nodes.rootBlock.create(
          { id },
          schema.nodes.paragraph.create(null, schema.text(id))
        )
      )
    ),
    plugins: [createRenderVirtualizationPlugin()],
  })

  return prepareInitialRenderVirtualizationState(baseState, {
    enabled: true,
    initialHydratedBlockCount: 0,
  })
}

describe('renderWindowState', () => {
  it('treats hydrated, pinned, and selected blocks as hydrated-like but only unpinned unselected blocks as dehydratable', () => {
    const virtualizationState = createVirtualizationState({
      hydrated: ['block-a', 'block-b', 'block-c'],
      pinned: ['block-b', 'block-c'],
    })

    expect([...collectHydratedLikeBlockIds(virtualizationState)]).toEqual([
      'block-a',
      'block-b',
      'block-c',
    ])
    expect([...collectDehydratableBlockIds(virtualizationState)]).toEqual(['block-a'])
  })

  it('reads the actual hydrated window from plugin state without losing selected or pinned blocks', () => {
    let state = createEditorState()
    state = state.apply(
      state.tr.setMeta(renderVirtualizationPluginKey, {
        hydrate: ['block-a'],
        pin: ['block-b', 'block-c'],
      })
    )

    expect(readActualHydratedWindowBlockIds(state, ['block-a', 'block-b', 'block-c'])).toEqual([
      'block-a',
      'block-b',
      'block-c',
    ])
  })
})
