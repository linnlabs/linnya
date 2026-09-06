import { describe, expect, it } from 'vitest';

import { validateMarkdownDocJson, workspaceMarkdownSchemaLite } from '../schemaLite';
import { assertProseMirrorJsonMatchesSchema } from './assertProseMirrorJsonMatchesSchema';
import type { MarkdownDocJson } from '../types';

describe('assertProseMirrorJsonMatchesSchema', () => {
  it('accepts Tiptap v3 table alignment attributes and normalizes omitted defaults', () => {
    const docJson: MarkdownDocJson = {
      type: 'doc',
      content: [
        {
          type: 'rootBlock',
          attrs: { id: 'root-table' },
          content: [
            {
              type: 'table',
              attrs: { id: 'table-1', blockType: 'table', withHeaderRow: true },
              content: [
                {
                  type: 'tableRow',
                  content: [
                    {
                      type: 'tableHeader',
                      attrs: { align: 'center' },
                      content: [
                        {
                          type: 'tableCellContentBlock',
                          attrs: { id: 'cell-1', blockType: 'tableCellContent' },
                          content: [{ type: 'text', text: '标题' }],
                        },
                      ],
                    },
                    {
                      type: 'tableCell',
                      content: [
                        {
                          type: 'tableCellContentBlock',
                          attrs: { id: 'cell-2', blockType: 'tableCellContent' },
                          content: [{ type: 'text', text: '正文' }],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };

    expect(validateMarkdownDocJson(docJson)).toMatchObject({
      content: [{
        content: [{
          content: [{
            content: [
              { attrs: { align: 'center' } },
              { attrs: { align: null } },
            ],
          }],
        }],
      }],
    });
  });

  it.each(['__proto__', 'constructor', 'toString'])(
    '拒绝通过原型链伪装成合法字段的 node 属性 %s',
    attributeName => {
      const attrs = Object.fromEntries([[attributeName, 'unexpected']]);
      const docJson: MarkdownDocJson = {
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
      };

      expect(() => assertProseMirrorJsonMatchesSchema(docJson, workspaceMarkdownSchemaLite))
        .toThrow(`未知属性 "${attributeName}"`);
    },
  );
});
