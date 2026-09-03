import { beforeEach, describe, expect, it, vi } from 'vitest';

const loggerWarnMock = vi.fn();

vi.mock('../logger', () => ({
  Logger: vi.fn().mockImplementation(() => ({
    warn: loggerWarnMock,
  })),
}));

vi.mock('tiktoken', () => ({
  get_encoding: vi.fn(() => {
    throw new Error('tiktoken unavailable');
  }),
}));

describe('TokenCalculator fallback observability', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('tiktoken 不可用时回退到 avgCharsPerToken，并对同一 encoding 只记录一次日志', async () => {
    const { TokenCalculator } = await import('../TokenCalculator');

    expect(TokenCalculator.estimateTokens('123456', {
      encoding: 'o200k_base',
      avgCharsPerToken: 3,
    })).toBe(2);
    expect(TokenCalculator.estimateTokens('123456', {
      encoding: 'o200k_base',
      avgCharsPerToken: 3,
    })).toBe(2);

    expect(loggerWarnMock).toHaveBeenCalledTimes(1);
    expect(loggerWarnMock).toHaveBeenCalledWith(
      'tiktoken encoding unavailable, falling back to avgCharsPerToken estimator',
      expect.objectContaining({
        requestedEncoding: 'o200k_base',
      }),
    );
  });
});
