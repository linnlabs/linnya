import { describe, expect, it } from 'vitest';
import type { CanonicalInferenceEvent } from '../../../../ports';
import { INITIAL_CANONICAL_INFERENCE_STREAM_STATE } from '../definitions/canonicalInferenceStreamState';
import { advanceCanonicalInferenceStreamState } from './advanceCanonicalInferenceStreamState';

function reduce(events: readonly CanonicalInferenceEvent[]) {
  return events.reduce(
    advanceCanonicalInferenceStreamState,
    INITIAL_CANONICAL_INFERENCE_STREAM_STATE
  );
}

describe('canonical inference stream 状态门禁', () => {
  it('接受 answer、工具增量、Provider actual usage 和唯一终态', () => {
    const state = reduce([
      { type: 'start', model_id: 'model-1', attempt_id: 'attempt-1' },
      { type: 'thought_delta', text: '先分析' },
      { type: 'answer_delta', text: '调用工具' },
      { type: 'tool_call_start', index: 0, part_index: 0, id: 'call-1', name: 'read_file' },
      { type: 'tool_argument_delta', index: 0, json_delta: '{"path":' },
      {
        type: 'tool_call_end',
        index: 0,
        call: { id: 'call-1', name: 'read_file', arguments: { path: 'README.md' } },
      },
      {
        type: 'usage',
        usage: {
          inputTokens: 10,
          outputTokens: 4,
          source: 'provider-response-usage',
          confidence: 'actual',
        },
      },
      { type: 'finish', reason: 'tool_use' },
    ]);

    expect(state).toMatchObject({
      phase: 'terminal',
      open_tool_calls: [],
      usage_seen: true,
      terminal: { type: 'finish', reason: 'tool_use' },
    });
  });

  it('拒绝把本地估算伪装成 Provider usage 事件', () => {
    expect(() =>
      reduce([
        { type: 'start', model_id: 'model-1', attempt_id: 'attempt-1' },
        {
          type: 'usage',
          usage: {
            inputTokens: 10,
            outputTokens: 4,
            source: 'local-estimate',
            confidence: 'estimate',
          },
        },
      ])
    ).toThrow(/只能承载 Provider 已上报的 actual usage/);
  });

  it('拒绝工具参数未闭合就发布完成态', () => {
    expect(() =>
      reduce([
        { type: 'start', model_id: 'model-1', attempt_id: 'attempt-1' },
        { type: 'tool_call_start', index: 0, part_index: 0 },
        { type: 'tool_argument_delta', index: 0, json_delta: '{' },
        { type: 'finish', reason: 'tool_use' },
      ])
    ).toThrow(/工具调用未结束/);
  });

  it('拒绝同一 index 的工具调用在流式过程中更换身份', () => {
    expect(() =>
      reduce([
        { type: 'start', model_id: 'model-1', attempt_id: 'attempt-1' },
        { type: 'tool_call_start', index: 0, part_index: 0, id: 'call-1', name: 'read_file' },
        {
          type: 'tool_call_end',
          index: 0,
          call: { id: 'call-2', name: 'read_file', arguments: {} },
        },
      ])
    ).toThrow(/id 前后不一致/);
  });

  it('拒绝 terminal 后的任何额外事件', () => {
    expect(() =>
      reduce([
        { type: 'start', model_id: 'model-1', attempt_id: 'attempt-1' },
        { type: 'finish', reason: 'stop' },
        { type: 'answer_delta', text: 'late' },
      ])
    ).toThrow(/terminal 后不能再出现/);
  });

  it('continuation producer identity 不完整时 fail-closed', () => {
    expect(() =>
      reduce([
        { type: 'start', model_id: 'model-1', attempt_id: 'attempt-1' },
        {
          type: 'assistant_part_end',
          index: 0,
          part: {
            type: 'reasoning',
            text: 'thinking',
            continuation: [{
            schema_version: 2,
            kind: 'thinking-signature',
            producer: {
              model_id: 'model-1',
              endpoint_id: '',
              api_surface: 'anthropic_messages',
              capability_id: 'test:messages-codec',
              endpoint_model_id: 'claude',
            },
            payload: { signature: 'opaque' },
            }],
          },
        },
      ])
    ).toThrow(/producer.endpoint_id 不能为空/);
  });

  it('拒绝重复 assistant part index', () => {
    expect(() => reduce([
      { type: 'start', model_id: 'model-1', attempt_id: 'attempt-1' },
      { type: 'tool_call_start', index: 0, part_index: 0, id: 'call-1', name: 'read_file' },
      {
        type: 'assistant_part_end',
        index: 0,
        part: { type: 'text', text: '重复 part' },
      },
    ])).toThrow(/assistant part index 0 重复/);
  });
});
