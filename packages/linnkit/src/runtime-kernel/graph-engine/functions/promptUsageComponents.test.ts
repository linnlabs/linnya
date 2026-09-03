import { describe, expect, it } from 'vitest';
import { normalizePromptUsageComponents } from './promptUsageComponents';

describe('normalizePromptUsageComponents', () => {
  it('按权重归一化，并保证三项之和严格等于 provider 总数', () => {
    expect(normalizePromptUsageComponents(101, {
      systemPromptTokens: 20,
      conversationTokens: 70,
      toolDefinitionTokens: 10,
    })).toEqual({
      system_prompt_tokens: 20,
      conversation_tokens: 71,
      tool_definition_tokens: 10,
    });
  });

  it('余数相同时固定按 System、Conversation、Tool definitions 顺序分配', () => {
    expect(normalizePromptUsageComponents(2, {
      systemPromptTokens: 1,
      conversationTokens: 1,
      toolDefinitionTokens: 1,
    })).toEqual({
      system_prompt_tokens: 1,
      conversation_tokens: 1,
      tool_definition_tokens: 0,
    });
  });

  it('没有 tools 时不会制造最小 Tool definitions 数值', () => {
    expect(normalizePromptUsageComponents(10, {
      systemPromptTokens: 2,
      conversationTokens: 8,
      toolDefinitionTokens: 0,
    }).tool_definition_tokens).toBe(0);
  });
});
