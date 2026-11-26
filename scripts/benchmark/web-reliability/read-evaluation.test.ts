import { describe, expect, it } from 'vitest';
import { evaluateReadQuality } from './read-evaluation';
import { WEB_READ_RELIABILITY_CASES, WEB_READ_PHASE0_PROBE_CASES, type WebReadReliabilityCase } from './read-cases';

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
      { title: 'Expected subject', content: 'Expected subject 正文内容足够长\n\n```ts\nfetch(url)\n```\n\n| A | B |\n|---|---|\n| 1 | 2 |' },
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
      { title: 'expected subject', content: 'expected subject long enough content without code' },
    ).failureKind).toBe('code_block_lost');
    expect(evaluateReadQuality(
      { ...baseCase, expectCodeBlock: true },
      { title: 'expected subject', content: 'expected subject long enough content without code' },
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
    const content = 'Expected subject\n\n[Source](https://example.com/data)\n\n```python\nif ready:\n    output = 83\n```\n\n~~113 GW~~\n\n' +
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

  it('导航、标题和链接目的地不能充当教程或公告条目的正文证据', () => {
    const quickStart = WEB_READ_PHASE0_PROBE_CASES.find(item => item.id === 'en-spa-hash-docsify-quickstart');
    const exchange = WEB_READ_PHASE0_PROBE_CASES.find(item => item.id === 'zh-sse-disclosure-list');
    if (!quickStart || !exchange) throw new Error('基准缺少样本');
    const menu = '[manual](https://example.test/docsify-cli) '.repeat(130);
    for (const sample of [quickStart, exchange]) {
      const result = evaluateReadQuality(sample, { title: sample.expectedAnyKeywords.join(' '), content: menu });
      expect(result).toMatchObject({ success: false, contentAvailable: false });
    }
    const external = { ...baseCase, contentAssertions: [
      { id: 'check-link', kind: 'link' as const, url: 'https://example.test/loadSidebar' },
      { id: 'exclude-config', kind: 'text_absent' as const, text: 'loadSidebar' },
    ] };
    expect(evaluateReadQuality(external, { title: 'Guide', content: 'expected subject [manual](https://example.test/loadSidebar)' }).success).toBe(true);
    const notice = '上市公司年度公告详情'.repeat(45) + '\n\n- 2026-11-25 [年度报告](https://example.test/announcement.pdf)';
    expect(evaluateReadQuality(exchange, { title: '公司公告', content: notice }).success).toBe(true);
  });

  it('滚动新闻要求多个独立详情条目各带日期，代码示例断言只在代码块内匹配', () => {
    const news = WEB_READ_RELIABILITY_CASES.find(item => item.id === 'zh-news-gov');
    const tutorial = WEB_READ_PHASE0_PROBE_CASES.find(item => item.id === 'en-shadow-lit-components');
    if (!news || !tutorial) throw new Error('基准缺少样本');
    const body = '页面公开正文与说明 Lit component。'.repeat(80);
    const entry = (id: number) => `- [公告 ${id}](https://www.gov.cn/yaowen/liebiao/${id}.htm) 2026-11-26`;
    const checkNews = (list: string) => evaluateReadQuality(news, { title: 'News', content: `${body}\n\n${list}` }).success;
    expect(checkNews(`${entry(1)}\n${entry(2)}`)).toBe(true);
    expect(checkNews(`${entry(1)}\n${entry(1)}`)).toBe(false);
    expect(checkNews(`${entry(1)}\n${entry(2).replace('2026-11-26', '')}\n\n2026-11-26`)).toBe(false);
    expect(evaluateReadQuality(tutorial, { title: 'Guide', content: `${body} class SimpleGreeting extends LitElement\n\n` + '```js\nother()\n```' }).success).toBe(false);
  });

  it('支持 text_present、text_absent（噪音不得出现）以及 resources_only / blocked 三类预期', () => {
    const withNoise: WebReadReliabilityCase = {
      ...baseCase,
      contentAssertions: [
        { id: 'body', kind: 'text_present', text: 'Official Notice 2026-01' },
        { id: 'no-cookie', kind: 'text_absent', text: 'Accept All Cookies' },
      ],
    };
    expect(evaluateReadQuality(withNoise, {
      title: 'Notice',
      content: 'Expected subject Official Notice 2026-01 details.',
    })).toMatchObject({ success: true, contentChecks: { checked: 2, failed: [] } });
    expect(evaluateReadQuality(withNoise, {
      title: 'Notice',
      content: 'Expected subject Official Notice 2026-01 Accept All Cookies.',
    })).toMatchObject({
      success: false,
      failureKind: 'content_assertion_failed',
      contentChecks: { checked: 2, failed: ['no-cookie'] },
    });

    const resourcesOnly: WebReadReliabilityCase = {
      ...baseCase,
      minChars: 0,
      expectedAnyKeywords: [],
      expectedOutcome: 'resources_only',
    };
    expect(evaluateReadQuality(resourcesOnly, { title: 'Attachments', content: '', resourcesCount: 2 }).success).toBe(true);
    expect(evaluateReadQuality(resourcesOnly, { title: 'Attachments', content: '', resourcesCount: 0 })).toMatchObject({
      success: false,
      failureKind: 'expected_resources_missing',
    });

    const blocked: WebReadReliabilityCase = {
      ...baseCase,
      expectedOutcome: 'blocked',
      expectedFailureKind: ['http_403', 'login_required'],
    };
    expect(evaluateReadQuality(blocked, { title: 'Unexpected', content: 'body' })).toMatchObject({
      success: false,
      failureKind: 'expected_blocked_not_returned',
    });
  });
});
