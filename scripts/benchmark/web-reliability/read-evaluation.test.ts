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
    expect(result.contentChecks).toEqual({ checked: 0, failed: [] });
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

  it('格式和数字均在但表格跨度、代码缩进、作废标记或来源丢失时，不能声称内容通过', () => {
    const expected: WebReadReliabilityCase = {
      ...baseCase,
      contentAssertions: [
        { id: 'source', kind: 'link', url: 'https://example.com/data' },
        { id: 'calculation', kind: 'code', text: 'if ready:\n    output = 83' },
        { id: 'withdrawn', kind: 'strikethrough', text: '113 GW' },
        { id: 'table', kind: 'table', rows: [
          [{ text: 'Year' }, { text: 'Region' }, { text: 'GW' }],
          [{ text: '2026', rowSpan: 2 }, { text: 'A' }, { text: '83' }],
          [{ text: 'B' }, { text: '113' }],
        ] },
      ],
    };
    const content = '[Source](https://example.com/data)\n\n```python\nif ready:\n    output = 83\n```\n\n~~113 GW~~\n\n' +
      '<table><tr><th>Year</th><th>Region</th><th>GW</th></tr>' +
      '<tr><td rowspan="2">2026</td><td>A</td><td>83</td></tr><tr><td>B</td><td>113</td></tr></table>';
    expect(evaluateReadQuality(expected, { title: 'Expected subject', content })).toMatchObject({
      success: true, tableMarkupPresent: true, contentChecks: { checked: 4, failed: [] },
    });
    const damaged = content.replace('rowspan="2"', '').replace('    output', 'output')
      .replace(/~~/g, '').replace('(https://example.com/data)', '');
    expect(evaluateReadQuality(expected, { title: 'Expected subject', content: damaged })).toMatchObject({
      success: false, contentAvailable: true, tableMarkupPresent: true, codeBlockMarkupPresent: true,
      failureKind: 'content_assertion_failed',
      contentChecks: { checked: 4, failed: ['source', 'calculation', 'withdrawn', 'table'] },
    });
  });
});
