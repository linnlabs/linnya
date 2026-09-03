import { describe, expect, it } from 'vitest';

import { decideLlmInvocationState } from '../llmInvocationState';

describe('llmInvocationState.decideLlmInvocationState', () => {
  it('非 llm 节点不注入调用语义', () => {
    expect(decideLlmInvocationState({
      nodeId: 'tool',
      previousInvocationCount: 1,
    })).toBeUndefined();
  });

  it('第一次进入 llm 节点标记为 user_initiated', () => {
    expect(decideLlmInvocationState({
      nodeId: 'llm',
      previousInvocationCount: undefined,
    })).toEqual({
      llmInvocationKind: 'user_initiated',
      llmInvocationCount: 1,
    });
  });

  it('后续进入 llm 节点标记为 continuation', () => {
    expect(decideLlmInvocationState({
      nodeId: 'llm',
      previousInvocationCount: 1,
    })).toEqual({
      llmInvocationKind: 'continuation',
      llmInvocationCount: 2,
    });
  });
});
