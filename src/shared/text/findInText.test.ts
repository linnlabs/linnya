import { describe, expect, it } from 'vitest';

import { findInText } from './findInText';

describe('findInText', () => {
  it('忽略全半角、大小写和断行，上下文截自原文', () => {
    const text = '「２０４０年度エネルギー需給見\n通し」が実現した場合、２０４０年度エネルギー自給率は３～４割程度が見込まれる。';
    const found = findInText(text, '2040年度エネルギー自給率は3~4割程度', 5);
    expect(found.count).toBe(1);
    expect(found.matches[0]!.context).toContain('２０４０年度エネルギー自給率は３～４割程度');
    expect(findInText(text, '需給見通し', 5).count).toBe(1);
    expect(findInText('Revenue GREW in Asia', 'revenue grew', 5).count).toBe(1);
  });

  it('只保留前若干处上下文，但计数完整', () => {
    const found = findInText('tax tax tax tax', 'tax', 2);
    expect(found.count).toBe(4);
    expect(found.matches).toHaveLength(2);
  });

  it('空页或只有空白的查询不命中', () => {
    expect(findInText('', 'x', 5)).toEqual({ count: 0, matches: [] });
    expect(findInText('abc', ' \n', 5)).toEqual({ count: 0, matches: [] });
  });

  it('上下文宽度可调，给出原文偏移', () => {
    const found = findInText('0123456789 target 0123456789', 'target', 1, 3);
    expect(found.matches[0]).toEqual({ start: 11, end: 17, context: '…89 target 01…' });
  });
});
