import { describe, expect, it } from 'vitest';
import type { ParsedNode, TextNode } from 'stream-markdown-parser';

import { reconcileStreamingMarkdownNodes } from './reconcileStreamingMarkdownNodes';

function text(raw: string): TextNode {
  return { type: 'text', raw, content: raw };
}

describe('reconcileStreamingMarkdownNodes', () => {
  it('preserves completed top-level node identity for append-only Markdown', () => {
    const stable = text('stable paragraph');
    const active = text('tail');
    const nextStable = text('stable paragraph');
    const nextActive = text('tail grows');

    const result = reconcileStreamingMarkdownNodes({
      previousMarkdown: 'stable paragraph\n\ntail',
      nextMarkdown: 'stable paragraph\n\ntail grows',
      previousNodes: [stable, active],
      nextNodes: [nextStable, nextActive],
    });

    expect(result[0]).toBe(stable);
    expect(result[1]).toBe(nextActive);
  });

  it('does not reuse nodes when content is replaced instead of appended', () => {
    const previous = text('same visible block');
    const replacement = text('same visible block');

    const result = reconcileStreamingMarkdownNodes({
      previousMarkdown: 'old prefix\n\nsame visible block',
      nextMarkdown: 'new prefix\n\nsame visible block',
      previousNodes: [previous],
      nextNodes: [replacement],
    });

    expect(result[0]).toBe(replacement);
  });

  it('requires both node type and raw source to match', () => {
    const previous = text('same raw');
    const differentType: ParsedNode = {
      type: 'paragraph',
      raw: 'same raw',
      children: [],
    };

    const result = reconcileStreamingMarkdownNodes({
      previousMarkdown: 'same raw',
      nextMarkdown: 'same raw plus',
      previousNodes: [previous],
      nextNodes: [differentType],
    });

    expect(result[0]).toBe(differentType);
  });
});
