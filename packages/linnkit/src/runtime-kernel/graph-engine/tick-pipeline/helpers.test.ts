import { describe, expect, it } from 'vitest';
import { normalizeToolCalls } from './helpers';
import type { StandardToolCall } from '../types';
import { ToolCallIdSchema } from '../../../contracts';

function createToolCall(argumentsText: string): StandardToolCall {
  return {
    id: ToolCallIdSchema.parse('call_1'),
    type: 'function',
    function: {
      name: 'code_generation_tool',
      arguments: argumentsText,
    },
  };
}

describe('tick-pipeline/helpers.normalizeToolCalls', () => {
  it('保留无法解析的原始 arguments，避免静默降级为 {}', () => {
    const rawArguments = '{"code":"const slide = createSlide();';

    const normalized = normalizeToolCalls([createToolCall(rawArguments)]);

    expect(normalized).toHaveLength(1);
    expect(normalized[0]?.function.arguments).toBe(rawArguments);
  });

  it('仍然拆分合法的拼接 JSON 对象', () => {
    const normalized = normalizeToolCalls([createToolCall('{"code":"a"}{"code":"b"}')]);

    expect(normalized).toHaveLength(2);
    expect(normalized[0]?.function.arguments).toBe('{"code":"a"}');
    expect(normalized[1]?.function.arguments).toBe('{"code":"b"}');
  });
});
