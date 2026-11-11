import { Schema } from '@tiptap/pm/model';
import type { JSONContent } from '@tiptap/core';
import { describe, expect, it } from 'vitest';

import { parseEditorDocumentJson } from './parseEditorDocumentJson';
import { assertMarkdownDocument } from '@linnya/markdown-document-core/validation';

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
});

describe('parseEditorDocumentJson', () => {
  it('Editor 与 core 使用同一严格规则，返回 Node 且不改输入，错误保留 owner/path', () => {
    const content = {
      type: 'doc',
      content: [
        {
          type: 'rootBlock',
          attrs: { id: 'root-1' },
          content: [
            {
              type: 'baseBlock',
              attrs: { id: 'block-1' },
              content: [{ type: 'text', text: 'Hello 中文' }],
            },
          ],
        },
      ],
    };
    const before = structuredClone(content);
    expect(parseEditorDocumentJson(content, schema).textContent).toBe('Hello 中文');
    expect(assertMarkdownDocument(content, schema).toJSON()).toEqual(
      parseEditorDocumentJson(content, schema).toJSON()
    );
    expect(content).toEqual(before);
    for (const invalid of [
      { type: 'unknown' },
      { type: 'doc', content: false },
      { type: 'text', text: '' },
      { type: 'baseBlock', attrs: { unexpected: 1 } },
      { type: 'baseBlock', marks: [{ type: 'unknown' }] },
    ]) {
      expect(() => parseEditorDocumentJson(invalid, schema)).toThrow('[EditorDocumentSchema]');
      expect(() => assertMarkdownDocument(invalid, schema)).toThrow('[MarkdownSchema]');
    }
    expect(() => parseEditorDocumentJson({ type: 'doc' }, schema)).toThrow();
  });
  it.each(['__proto__', 'constructor', 'toString'])(
    '拒绝通过原型链伪装成合法字段的 node 属性 %s',
    attributeName => {
      const attrs = Object.fromEntries([[attributeName, 'unexpected']]);
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
      } satisfies JSONContent;

      expect(() => parseEditorDocumentJson(docJson, schema)).toThrow(`未知属性 "${attributeName}"`);
    }
  );
});
