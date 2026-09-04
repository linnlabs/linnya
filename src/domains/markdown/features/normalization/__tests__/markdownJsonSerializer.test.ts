import { describe, expect, it } from 'vitest';
import { serializeRootBlockToMarkdown } from '../markdownJsonSerializer';

function rootBlock(content: readonly unknown[]) {
  return {
    type: 'rootBlock',
    content: [{ type: 'baseBlock', content }],
  };
}

const annotation = {
  id: 'annotation-1',
  content: '建议补充依据',
  author: 'Reviewer',
  state: 'confirmed' as const,
  createdAt: '2026-09-04T00:00:00.000Z',
  updatedAt: '2026-09-04T00:00:00.000Z',
  resolvedAt: null,
  replies: [],
  meta: { source: 'manual' as const },
};

describe('serializeRootBlockToMarkdown inline projection', () => {
  it('未提供 projector 时保持既有 Markdown 转义与 mark 输出', () => {
    expect(
      serializeRootBlockToMarkdown(
        rootBlock([
          { type: 'text', text: '[1] ' },
          { type: 'text', text: 'important', marks: [{ type: 'bold' }] },
        ])
      )
    ).toBe('\\[1\\] **important**');
  });

  it('通过结构化 inline node projector 输出 canonical token，不读取派生编号', () => {
    const seenTypes: string[] = [];
    const result = serializeRootBlockToMarkdown(
      rootBlock([
        { type: 'text', text: '正文 ' },
        {
          type: 'citationNode',
          attrs: { citationId: 'citation-1', ref: 'ABC234' },
          marks: [{ type: 'bold' }],
        },
      ]),
      {
        projectInlineNode(input) {
          seenTypes.push(input.type);
          return input.type === 'citationNode' ? '[@ABC234]' : null;
        },
      }
    );

    expect(result).toBe('正文 [@ABC234]');
    expect(result).not.toContain('**[@ABC234]**');
    expect(seenTypes).toEqual(['text', 'citationNode']);
  });

  it('codeBlock 不调用领域 projector，避免把代码示例误投影成业务引用', () => {
    let callCount = 0;
    const result = serializeRootBlockToMarkdown(
      {
        type: 'rootBlock',
        content: [
          {
            type: 'codeBlock',
            attrs: { language: 'md' },
            content: [
              {
                type: 'text',
                text: '[@ABC234]',
                marks: [{ type: 'domainMark' }],
              },
            ],
          },
        ],
      },
      {
        projectInlineText() {
          callCount += 1;
          return 'projected';
        },
      }
    );

    expect(result).toBe('```md\n[@ABC234]\n```');
    expect(callCount).toBe(0);
  });

  it('在所属 root block 后输出 canonical Annotation comment', () => {
    const result = serializeRootBlockToMarkdown({
      ...rootBlock([{ type: 'text', text: '正文' }]),
      attrs: { annotations: [annotation] },
    });

    expect(result).toContain('正文\n\n<!-- linnya-annotation:v1\n');
    expect(result).toContain('"id":"annotation-1"');
  });

  it('为空块批注导出不可见的 Markdown 锚点', () => {
    const result = serializeRootBlockToMarkdown({
      ...rootBlock([]),
      attrs: { annotations: [annotation] },
    });

    expect(result).toContain('<!-- linnya-annotation-anchor:v1 empty-block -->');
    expect(result).toContain('<!-- linnya-annotation:v1\n');
  });
});
