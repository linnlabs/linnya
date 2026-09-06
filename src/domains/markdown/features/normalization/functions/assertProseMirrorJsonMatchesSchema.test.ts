import { describe, expect, it } from 'vitest';

import { workspaceMarkdownSchemaLite } from '../schemaLite';
import { assertProseMirrorJsonMatchesSchema } from './assertProseMirrorJsonMatchesSchema';
import type { MarkdownDocJson } from '../types';

describe('assertProseMirrorJsonMatchesSchema', () => {
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
