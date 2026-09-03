import { describe, expect, it } from 'vitest';
import { deduplicateText } from './textDeduplicator';

describe('deduplicateText', () => {
  it('preserves legitimate repeated characters in Chinese and English', () => {
    expect(deduplicateText('Hello world', 5, 2, 10)).toBe('Hello world');
    expect(deduplicateText('今天天气很好', 5, 2, 10)).toBe('今天天气很好');
    expect(deduplicateText('Completely different text', 5, 2, 10))
      .toBe('Completely different text');
    expect(deduplicateText('Hello world this is a test', 5, 2, 20))
      .toBe('Hello world this is a test');
  });

  it('removes repeated multi-character ASR hallucination patterns', () => {
    expect(deduplicateText('你好你好你好', 5, 2, 10)).toBe('你好');
    expect(deduplicateText('去公园吧 去公园吧', 5, 2, 10)).toBe('去公园吧');
  });
});
