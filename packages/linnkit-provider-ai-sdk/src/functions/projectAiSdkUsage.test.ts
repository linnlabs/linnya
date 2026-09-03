import type { LanguageModelUsage } from 'ai';
import { describe, expect, it } from 'vitest';
import { projectAiSdkUsage } from './projectAiSdkUsage';

function usage(overrides: Partial<LanguageModelUsage> = {}): LanguageModelUsage {
  return {
    inputTokens: 30,
    inputTokenDetails: {
      noCacheTokens: 22,
      cacheReadTokens: 8,
      cacheWriteTokens: undefined,
    },
    outputTokens: 12,
    outputTokenDetails: { textTokens: 10, reasoningTokens: 2 },
    totalTokens: 42,
    raw: { vendor_input: 999, vendor_output: 999 },
    ...overrides,
  };
}

describe('projectAiSdkUsage', () => {
  it('raw 缺失时不把 SDK 空 usage 伪装成 Provider actual', () => {
    expect(projectAiSdkUsage(usage({ raw: undefined }))).toBeUndefined();
  });

  it('只使用 AI SDK 标准字段，不解析互相冲突的厂商 raw 字段', () => {
    expect(projectAiSdkUsage(usage())).toEqual({
      inputTokens: 22,
      outputTokens: 12,
      cacheReadTokens: 8,
      reasoningTokens: 2,
      source: 'provider-response-usage',
      confidence: 'actual',
      rawUsage: { vendor_input: 999, vendor_output: 999 },
    });
  });

  it('保留 package 明确投影的零值与 cache write', () => {
    expect(projectAiSdkUsage(usage({
      inputTokenDetails: {
        noCacheTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 4,
      },
      outputTokens: 0,
      outputTokenDetails: { textTokens: 0, reasoningTokens: 0 },
      totalTokens: 4,
    }))).toMatchObject({
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 4,
      reasoningTokens: 0,
    });
  });

  it('缺少 canonical 必需的非缓存输入或输出时不发布 usage', () => {
    expect(projectAiSdkUsage(usage({
      inputTokenDetails: {
        noCacheTokens: undefined,
        cacheReadTokens: 8,
        cacheWriteTokens: undefined,
      },
    }))).toBeUndefined();
    expect(projectAiSdkUsage(usage({ outputTokens: undefined }))).toBeUndefined();
  });

  it('拒绝 Provider package 投影出的非法标准计数', () => {
    expect(() => projectAiSdkUsage(usage({ outputTokens: -1 }))).toThrow(/非负安全整数/);
  });
});
