import { Schema } from '@tiptap/pm/model'
import type { JSONContent } from '@tiptap/core'
import { describe, expect, it } from 'vitest'

import { parseEditorDocumentJson } from './parseEditorDocumentJson'

const schema = new Schema({
  nodes: {
    doc: { content: 'rootBlock+' },
    rootBlock: {
      content: 'baseBlock',
      attrs: { id: { default: '' } },
    },
    baseBlock: {
      content: 'text*',
      attrs: { id: { default: '' } },
    },
    text: { group: 'inline' },
  },
})

describe('parseEditorDocumentJson', () => {
  it.each(['__proto__', 'constructor', 'toString'])(
    '拒绝通过原型链伪装成合法字段的 node 属性 %s',
    attributeName => {
      const attrs = Object.fromEntries([[attributeName, 'unexpected']])
      const docJson = {
        type: 'doc',
        content: [
          {
            type: 'rootBlock',
            attrs,
            content: [
              {
                type: 'baseBlock',
                attrs: { id: 'block-1' },
              },
            ],
          },
        ],
      } satisfies JSONContent

      expect(() => parseEditorDocumentJson(docJson, schema))
        .toThrow(`未知属性 "${attributeName}"`)
    },
  )
})
