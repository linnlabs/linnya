import { describe, expect, it } from 'vitest';
import { assertExpectedMarkdownDocumentVersion } from './assertExpectedMarkdownDocumentVersion';

describe('assertExpectedMarkdownDocumentVersion', () => {
  it('rejects a stale review snapshot before document mutation', () => {
    expect(() => assertExpectedMarkdownDocumentVersion({ expected: 2, actual: 3 }))
      .toThrow('文档版本冲突: expected=2, actual=3');
  });

  it('accepts the exact document version', () => {
    expect(() => assertExpectedMarkdownDocumentVersion({ expected: 3, actual: 3 }))
      .not.toThrow();
  });
});
