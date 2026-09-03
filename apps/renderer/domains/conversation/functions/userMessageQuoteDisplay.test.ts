import { describe, expect, it } from 'vitest';
import type { UserQuoteItemData } from '@app/schemas';
import { buildUserMessageQuoteDisplay } from './userMessageQuoteDisplay';

function quoteItem(overrides: Partial<UserQuoteItemData>): UserQuoteItemData {
  return {
    quote_id: overrides.quote_id ?? 'reference-11111111111111111111111111111111',
    plugin_id: overrides.plugin_id ?? 'platform',
    kind: overrides.kind ?? 'text-selection',
    text: overrides.text ?? '被引用的正文内容',
    ...(overrides.uri !== undefined ? { uri: overrides.uri } : {}),
    ...(overrides.label !== undefined ? { label: overrides.label } : {}),
    ...(overrides.source !== undefined ? { source: overrides.source } : {}),
    ...(overrides.metadata !== undefined ? { metadata: overrides.metadata } : {}),
  };
}

describe('buildUserMessageQuoteDisplay', () => {
  it('引用展示优先使用生产方提供的业务 label，并保留结构化条目', () => {
    const item = quoteItem({
      text: 'abcdefghijklmnopqrstuvwxyz',
      label: 'abcd...wxyz',
    });

    expect(buildUserMessageQuoteDisplay(item)).toEqual({
      item,
      displayText: 'abcd...wxyz',
    });
  });

  it('文件引用展示 provider 给出的 label', () => {
    const item = quoteItem({
      plugin_id: 'platform',
      kind: 'workspace-document',
      text: 'Workspace document reference: "需求说明.md" (inode="workspace:document-1").',
      label: '需求说明.md',
      metadata: { documentId: 'document-1', inode: 'workspace:document-1' },
    });

    expect(buildUserMessageQuoteDisplay(item)).toEqual({
      item,
      displayText: '需求说明.md',
    });
  });

  it('业务引用没有可用 label 时退回正文预览，空正文不展示', () => {
    expect(buildUserMessageQuoteDisplay(quoteItem({
      kind: 'slides-source-selection',
      text: '第 3 页的标题元素',
      label: '   ',
    }))?.displayText).toBe('第 3 ...标题元素');

    expect(buildUserMessageQuoteDisplay(quoteItem({
      kind: 'workspace-document',
      text: '   ',
      label: '   ',
    }))).toBeUndefined();
  });
});
