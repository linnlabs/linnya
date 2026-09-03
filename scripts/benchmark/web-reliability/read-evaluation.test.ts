import { describe, expect, it } from 'vitest';
import { evaluateReadQuality } from './read-evaluation';
import type { WebReadReliabilityCase } from './read-cases';

const baseCase: WebReadReliabilityCase = {
  id: 'quality-test',
  language: 'en',
  category: 'table_or_code',
  url: 'https://example.com',
  minChars: 10,
  expectedAnyKeywords: ['expected subject'],
};

describe('Web 读取质量判定', () => {
  it('正文、代码块和表格满足要求时成功', () => {
    const result = evaluateReadQuality(
      { ...baseCase, expectCodeBlock: true, expectTable: true },
      { title: 'Expected subject', content: '正文内容足够长\n\n```ts\nfetch(url)\n```\n\n| A | B |\n|---|---|\n| 1 | 2 |' },
    );
    expect(result.success).toBe(true);
    expect(result.contentAvailable).toBe(true);
  });

  it('按缺标题、正文过短、代码丢失的优先级报告根因', () => {
    expect(evaluateReadQuality(baseCase, { title: '', content: 'expected subject long enough content' }).failureKind).toBe('missing_title');
    expect(evaluateReadQuality(baseCase, { title: 'expected subject', content: 'short' }).failureKind).toBe('content_too_short');
    expect(evaluateReadQuality(baseCase, { title: 'x', content: 'long enough content' }).failureKind).toBe('expected_content_missing');
    expect(evaluateReadQuality(
      { ...baseCase, expectCodeBlock: true },
      { title: 'expected subject', content: 'long enough content without code' },
    ).failureKind).toBe('code_block_lost');
    expect(evaluateReadQuality(
      { ...baseCase, expectCodeBlock: true },
      { title: 'expected subject', content: 'long enough content without code' },
    ).contentAvailable).toBe(true);
  });
});
