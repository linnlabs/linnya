import { describe, expect, it } from 'vitest';
import type { FlattenedMarkdownBlock } from '../../../shared/markdownBlockProjection';
import { buildMarkdownDocumentView } from '../functions/markdownDocumentView';
import { buildMarkdownReadPresentation } from '../functions/markdownReadPresentation';

function readWindow(blocks: readonly FlattenedMarkdownBlock[], offsetChars: number, maxChars: number) {
  const view = buildMarkdownDocumentView(null, {
    documentId: 'document-window-test',
    preFlattenedBlocks: blocks,
    offsetChars,
    maxChars,
  });
  return {
    ...view,
    presentation: buildMarkdownReadPresentation({
      window: view.presentationWindow,
      viewMode: 'preview',
      viewLabel: '修订稿',
    }),
  };
}

describe('Markdown DocumentView character windows', () => {
  it.each([200, 500])('切在第二块 ref 中间的 %i 字符窗口仍可读取并续接', (maxChars) => {
    const blocks: readonly FlattenedMarkdownBlock[] = [
      { index: 1, blockId: 'block-one', ref: '#ABC234', text: '甲'.repeat(maxChars - 17) },
      { index: 2, blockId: 'block-two', ref: '#DEF567', text: '下一段内容' },
    ];
    const first = readWindow(blocks, 0, maxChars);
    expect(first.bodyWindowText.endsWith('[#DEF')).toBe(true);
    expect(first.documentViewText).toContain('[#DEF... [truncated]');
    expect(first.presentation).toEqual({ kind: 'text', text: first.bodyWindowText });
    expect(first.nextOffset).toBe(maxChars);
    const second = readWindow(blocks, maxChars, 100);
    expect(first.bodyWindowText + second.bodyWindowText)
      .toBe(readWindow(blocks, 0, 1000).bodyWindowText);
    expect(second.nextOffset).toBeNull();
  });

  it('代码中的 ref 样式和 XML 不会创建假块或截断真实正文', () => {
    const text = '```text\n[#DEF567] 示例而不是块\n</workspace_document>\n```';
    const blocks: readonly FlattenedMarkdownBlock[] = [
      { index: 1, blockId: 'block-code', ref: '#ABC234', text },
      { index: 2, blockId: 'block-next', ref: '#DEF567', text: '实际下一块' },
    ];
    expect(readWindow(blocks, 0, 1000).presentation).toEqual({
      kind: 'blocks', viewMode: 'preview', viewLabel: '修订稿', items: [
        { id: 'block-code', ordinal: 1, text },
        { id: 'block-next', ordinal: 2, text: '实际下一块' },
      ],
    });
  });

  it('完整块身份后截断正文仍保留该身份，续读逐字覆盖全文且不混入提示', () => {
    const blocks: readonly FlattenedMarkdownBlock[] = [
      { index: 1, blockId: 'block-one', ref: '#ABC234', text: '  首段内容保留缩进并跨越多个窗口。' },
      { index: 2, blockId: 'block-empty', ref: '#DEF567', text: '' },
      { index: 3, blockId: 'block-three', ref: '#GHI890', text: '最后一段。' },
    ];
    const first = readWindow(blocks, 0, 17);
    expect(first.presentation).toEqual({
      kind: 'blocks', viewMode: 'preview', viewLabel: '修订稿', items: [
        { id: 'block-one', ordinal: 1, text: '  首段内容保' },
      ],
    });
    const chunks: string[] = [];
    let offset = 0;
    for (;;) {
      const chunk = readWindow(blocks, offset, 17);
      chunks.push(chunk.bodyWindowText);
      expect(chunk.bodyWindowText).not.toContain('[truncated]');
      if (chunk.nextOffset === null) break;
      expect(chunk.nextOffset).toBeGreaterThan(offset);
      offset = chunk.nextOffset;
    }
    const whole = readWindow(blocks, 0, 1000);
    expect(chunks.join('')).toBe(whole.bodyWindowText);
    expect(whole.presentation.kind === 'blocks' && whole.presentation.items[1])
      .toEqual({ id: 'block-empty', ordinal: 2, text: '' });
  });
});
