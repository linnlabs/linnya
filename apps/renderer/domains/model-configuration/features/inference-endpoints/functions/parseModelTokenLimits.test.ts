import { describe, expect, it } from 'vitest';

import { parseModelTokenLimits } from './parseModelTokenLimits';

describe('parseModelTokenLimits', () => {
  it('把用户声明的两个模型容量解析为 route 数值', () => {
    expect(parseModelTokenLimits('200000', '8192')).toEqual({
      contextWindowTokens: 200_000,
      maxOutputTokens: 8_192,
    });
  });

  it.each([
    ['', '8192'],
    ['0', '8192'],
    ['32768.5', '8192'],
    ['32768', '-1'],
    ['32768', 'not-a-number'],
    [String(Number.MAX_SAFE_INTEGER + 1), '8192'],
  ])('拒绝无法写入严格 route 的容量：%s / %s', (contextWindow, maxOutput) => {
    expect(parseModelTokenLimits(contextWindow, maxOutput)).toBeNull();
  });
});
