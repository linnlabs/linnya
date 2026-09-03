import { describe, expect, it } from 'vitest';
import { extractVirtualizerSpikeRange } from './extractVirtualizerSpikeRange';

describe('extractVirtualizerSpikeRange', () => {
  it('阅读历史时仍应把末 3 项钉在渲染范围内', () => {
    const indexes = extractVirtualizerSpikeRange({
      count: 80,
      endIndex: 18,
      overscan: 2,
      startIndex: 12,
    }, 3);

    expect(indexes).toEqual([10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 77, 78, 79]);
  });
});
