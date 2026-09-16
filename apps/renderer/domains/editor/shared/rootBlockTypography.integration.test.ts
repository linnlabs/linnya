// @vitest-environment jsdom

import { Schema } from 'prosemirror-model'
import { DecorationSet, type NodeView } from 'prosemirror-view'
import { describe, expect, it } from 'vitest'
import { createRootBlockDomNodeView } from '../features/RenderVirtualization/view/RootBlockDomNodeView'
import { createPlaceholderShellView } from '../features/RenderVirtualization/view/PlaceholderShellView'

const schema = new Schema({
  nodes: {
    doc: { content: 'rootBlock+' },
    rootBlock: { content: 'block', attrs: { id: { default: null } } },
    baseBlock: { group: 'block', content: 'text*' },
    headingBlock: { group: 'block', content: 'text*', attrs: { level: { default: 1 } } },
    listItemBlock: { group: 'block', content: 'text*', attrs: { listType: { default: 'bullet' } } },
    text: {},
  },
})

describe('RootBlock typography across render modes', () => {
  it('preserves heading/list layout semantics through offscreen conversions without changing document data', () => {
    const owner = {}
    const heading = schema.node('rootBlock', { id: 'section' }, [
      schema.node('headingBlock', { level: 2 }, schema.text('章节')),
    ])
    const initialJson = heading.toJSON()
    const views: NodeView[] = [
      createRootBlockDomNodeView(heading, { runtimeRegistryOwner: owner, resolveMode: () => 'hydrated' }),
      createPlaceholderShellView(heading, { runtimeRegistryOwner: owner, resolveMode: () => 'placeholder' }),
    ]

    try {
      for (const view of views) {
        expect(view.dom).toBeInstanceOf(HTMLElement)
        if (!(view.dom instanceof HTMLElement)) throw new Error('Missing RootBlock element')
        expect(view.dom.dataset.contentType).toBe('headingBlock')
        expect(view.dom.dataset.headingLevel).toBe('2')
      }

      // 同一个块在离屏期间转成列表、再转正文，也必须清除上一次排版身份。
      const list = schema.node('rootBlock', { id: 'section' }, [
        schema.node('listItemBlock', { listType: 'ordered' }, schema.text('步骤')),
      ])
      const paragraph = schema.node('rootBlock', { id: 'section' }, [
        schema.node('baseBlock', null, schema.text('正文')),
      ])
      for (const view of views) {
        if (!(view.dom instanceof HTMLElement)) throw new Error('Missing RootBlock element')
        expect(view.update?.(list, [], DecorationSet.empty)).toBe(true)
        expect(view.dom.dataset.contentType).toBe('listItemBlock')
        expect(view.dom.dataset.listType).toBe('ordered')
        expect(view.dom.hasAttribute('data-heading-level')).toBe(false)

        expect(view.update?.(paragraph, [], DecorationSet.empty)).toBe(true)
        expect(view.dom.dataset.contentType).toBe('baseBlock')
        expect(view.dom.hasAttribute('data-list-type')).toBe(false)
        expect(view.dom.hasAttribute('data-heading-level')).toBe(false)
        expect(view.dom.dataset.id).toBe('section')
      }
      expect(heading.toJSON()).toEqual(initialJson)
      expect(paragraph.attrs).toEqual({ id: 'section' })
    } finally {
      for (const view of views) view.destroy?.()
    }
  })
})
