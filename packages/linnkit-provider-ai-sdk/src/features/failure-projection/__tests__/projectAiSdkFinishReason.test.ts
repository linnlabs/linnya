import { describe, expect, it } from 'vitest';
import { projectAiSdkFinishReason } from '../functions/projectAiSdkFinishReason';

describe('projectAiSdkFinishReason', () => {
  it.each([
    ['stop', undefined, { type: 'finish', reason: 'stop' }],
    ['length', 'max_output_tokens', { type: 'finish', reason: 'length' }],
    ['content-filter', 'content_filter', { type: 'finish', reason: 'content_filter' }],
    ['tool-calls', undefined, { type: 'finish', reason: 'tool_use' }],
  ] as const)('投影 AI SDK 标准结束原因 %s', (finishReason, rawFinishReason, event) => {
    expect(projectAiSdkFinishReason(finishReason, rawFinishReason).event).toEqual(event);
  });

  it('把兼容 Responses 网关的 max_tokens 别名投影为 length', () => {
    expect(projectAiSdkFinishReason('other', 'max_tokens')).toEqual({
      event: { type: 'finish', reason: 'length' },
      raw_reason_category: 'max_tokens',
    });
  });

  it.each([
    ['server_error', 'provider_stream_unavailable'],
    ['upstream_error', 'provider_stream_unavailable'],
    ['timeout', 'provider_stream_timeout'],
    ['rate_limit_error', 'provider_stream_rate_limited'],
  ] as const)('把非标准临时结束 %s 投影为可重试 Provider 故障', (rawReason, code) => {
    expect(projectAiSdkFinishReason('other', rawReason)).toEqual({
      event: { type: 'failure', kind: 'provider', code, retryable: true },
      raw_reason_category: rawReason,
    });
  });

  it('未知原始原因不进入通用事件或诊断字段', () => {
    const projection = projectAiSdkFinishReason('other', 'private provider detail');

    expect(projection).toEqual({
      event: {
        type: 'failure',
        kind: 'provider',
        code: 'provider_finish_other',
        retryable: true,
      },
      raw_reason_category: 'unrecognized',
    });
    expect(JSON.stringify(projection)).not.toContain('private provider detail');
  });
});
