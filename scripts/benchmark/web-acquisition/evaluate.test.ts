import { describe, expect, it } from 'vitest';
import { evaluateWebAcquisitionRun, normalizeText, type ToolCallFact } from './evaluate';
import { WEB_ACQUISITION_TASKS } from './tasks';

const usage = { calls: 3, uncachedInput: 100, cachedInput: 50, output: 20, listCostUsd: 0.01 };
const task = (key: string) => WEB_ACQUISITION_TASKS.find(candidate => candidate.key === key)!;
const call = (fact: Partial<ToolCallFact> & Pick<ToolCallFact, 'toolName'>): ToolCallFact => ({
  runId: 'run-1', arguments: '{}', status: 'success', observation: '', ...fact,
});

describe('web acquisition benchmark evaluation', () => {
  it('keeps task keys valid for the batch manifest and unique', () => {
    const keys = WEB_ACQUISITION_TASKS.map(item => item.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const key of keys) expect(key).toMatch(/^[a-z0-9][a-z0-9-]{0,39}$/u);
  });

  it('normalizes full-width digits and parser whitespace before matching', () => {
    expect(normalizeText('2040年度エネルギー自給率は３～４\n割程度')).toContain(normalizeText('2040年度エネルギー自給率は3~4割程度'));
  });

  it('passes a content check only when the text was read and the named source was fetched', () => {
    const read = call({
      toolName: 'web_read',
      arguments: JSON.stringify({ url: 'https://www.ndrc.gov.cn/xxgk/zcfb/tz/202502/t20250209_1396066.html' }),
      observation: '……发改价格〔2025〕136号……国家发展改革委 国家能源局 2025年1月27日',
    });
    const metrics = evaluateWebAcquisitionRun(task('zh-policy-136'), [read], usage);
    expect(metrics.checks.every(check => check.passed)).toBe(true);
  });

  it('does not count a search snippet or a reprint as reading the original', () => {
    const search = call({ toolName: 'web_search', arguments: '{"query":"136号文"}', observation: '发改价格〔2025〕136号 2025年1月27日' });
    const reprint = call({ toolName: 'web_read', arguments: '{"url":"https://news.example.com/136"}', observation: '发改价格〔2025〕136号' });
    const [number] = evaluateWebAcquisitionRun(task('zh-policy-136'), [search, reprint], usage).checks;
    expect(number).toMatchObject({ passed: false, contentRead: true, sourceFetched: false });
    const [onlySearch] = evaluateWebAcquisitionRun(task('zh-policy-136'), [search], usage).checks;
    expect(onlySearch).toMatchObject({ contentRead: false });
  });

  it('counts a PDF parsed through Shell after the file was downloaded from the source', () => {
    const download = call({
      toolName: 'web_read', arguments: '{"url":"https://www.enecho.meti.go.jp/category/others/basic_plan/pdf/20250218_01.pdf"}',
      observation: 'Saved PDF to web-downloads/20250218_01.pdf', data: { extractor: 'file_download' },
    });
    const parse = call({ toolName: 'shell', arguments: '{"command":"python3 -c \\"import fitz\\" web-downloads/20250218_01.pdf"}', observation: '2040年度エネルギー自給率は３～４割程度' });
    const metrics = evaluateWebAcquisitionRun(task('pdf-meti-self-sufficiency'), [download, parse], usage);
    expect(metrics.checks[0]?.passed).toBe(true);
    expect(metrics.reads.files).toBe(1);
    expect(metrics.shellPdfAttempts).toBe(1);
  });

  it('counts structured search conditions, read failures, truncation and children', () => {
    const calls = [
      call({ toolName: 'web_search', arguments: '{"query":"apple 10-k","site":"sec.gov","recency_days":30}' }),
      call({ toolName: 'web_search', arguments: '{"query":"x","deep_search":true}' }),
      call({ toolName: 'web_read', arguments: '{"url":"https://a.example/1"}', status: 'error', errorCode: 'http_404' }),
      call({ toolName: 'web_read', arguments: '{"url":"https://a.example/2"}', data: { truncated: true } }),
      call({ toolName: 'subagent', arguments: '{"agent":"research"}' }),
    ];
    const metrics = evaluateWebAcquisitionRun(task('site-sec-apple-10k'), calls, usage);
    expect(metrics.searches).toBe(2);
    expect(metrics.searchesWithConditions).toEqual({ site: 1, language: 0, recency: 1, objective: 0 });
    expect(metrics.reads).toMatchObject({ ok: 1, failed: 1, truncated: 1, errors: { http_404: 1 } });
    expect(metrics.children).toBe(2);
    expect(metrics.usage).toBe(usage);
  });

  it('checks image acquisition by fetched addresses only', () => {
    const calls = [
      call({ toolName: 'web_read', arguments: '{"url":"https://commons.wikimedia.org/wiki/File:Houmuwu_ding.jpg"}' }),
      call({ toolName: 'shell', arguments: '{"command":"curl -o ding.jpg https://upload.wikimedia.org/wikipedia/commons/a/ab/Houmuwu_ding.jpg"}' }),
    ];
    expect(evaluateWebAcquisitionRun(task('image-houmuwu'), calls, usage).checks.map(check => check.passed)).toEqual([true, true]);
  });
});
