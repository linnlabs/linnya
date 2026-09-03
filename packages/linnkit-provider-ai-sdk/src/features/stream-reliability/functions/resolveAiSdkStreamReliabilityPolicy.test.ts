import { describe, expect, it } from 'vitest';

import { DEFAULT_AI_SDK_STREAM_IDLE_TIMEOUT_MS } from '../definitions/aiSdkStreamReliabilityPolicy';
import { resolveAiSdkStreamReliabilityPolicy } from './resolveAiSdkStreamReliabilityPolicy';

describe('resolveAiSdkStreamReliabilityPolicy', () => {
  it('默认使用五分钟内容分片空闲上限，并允许测试注入更短值', () => {
    expect(resolveAiSdkStreamReliabilityPolicy(undefined)).toEqual({
      idle_timeout_ms: DEFAULT_AI_SDK_STREAM_IDLE_TIMEOUT_MS,
    });
    expect(resolveAiSdkStreamReliabilityPolicy(25)).toEqual({ idle_timeout_ms: 25 });
  });

  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])('拒绝非法空闲上限 %s', value => {
    expect(() => resolveAiSdkStreamReliabilityPolicy(value)).toThrow(
      'AI SDK stream idle timeout 必须是正安全整数'
    );
  });
});
