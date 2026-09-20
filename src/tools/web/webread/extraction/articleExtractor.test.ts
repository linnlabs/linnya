import { describe, expect, it } from 'vitest';
import { currentArticleExtractor, extractArticle } from './extractArticle';

describe('正文抽取器内部合同', () => {
  it('把当前 Readability + semantic DOM 路径作为稳定 baseline adapter', () => {
    const html = '<!doctype html><html><head><title>Baseline</title></head><body>'
      + '<main><h1>Baseline</h1><p>'
      + 'A stable article body that is long enough for deterministic extraction. '.repeat(20)
      + '</p></main></body></html>';

    const direct = extractArticle(html);
    const throughAdapter = currentArticleExtractor.extract(html);

    expect(currentArticleExtractor.name).toBe('linnya_readability_semantic');
    expect(throughAdapter).toEqual(direct);
    expect(direct.diagnostics.selected).toBe(direct.extractor);
    expect(direct.diagnostics.readabilityTextLength).toBeGreaterThan(0);
    expect(direct.diagnostics.semanticCandidateCount).toBe(1);
  });
});
