import { describe, expect, it } from 'vitest';

import type { AiMessage } from '../../../../../../../contracts';
import type { MessageProcessingState } from '../../base';
import { ToolPairMatcher } from '../../working-memory/ToolPairMatcher';
import { ToolCallIdSchema } from '../../../../../../../contracts';

function makeToolCallMessage(id: string, toolCallIds: string[]): AiMessage {
  return {
    id,
    role: 'assistant',
    type: 'tool_calls',
    content: '',
    timestamp: Date.now(),
    metadata: {
      tool_calls: toolCallIds.map((toolCallId, index) => ({
        id: ToolCallIdSchema.parse(toolCallId),
        type: 'function',
        function: {
          name: `test_tool_${index + 1}`,
          arguments: '{}',
        },
      })),
    },
  };
}

function makeToolOutputMessage(id: string, toolCallId: string): AiMessage {
  return {
    id,
    role: 'tool',
    type: 'tool_output',
    content: 'output',
    timestamp: Date.now(),
    metadata: {
      tool_call_id: ToolCallIdSchema.parse(toolCallId),
      tool_name: 'test_tool',
      data: { value: 'output' },
    },
  };
}

function makeCompressedToolHistoryMessage(id: string): AiMessage {
  return {
    id,
    role: 'assistant',
    type: 'final_answer',
    content: '压缩工具摘要',
    timestamp: Date.now(),
    metadata: { isCompressedToolHistory: true },
  };
}

function makeState(message: AiMessage, index: number, tokens = 100): MessageProcessingState {
  return {
    message,
    originalIndex: index,
    action: 'skip',
    tokens,
  };
}

describe('ToolPairMatcher', () => {
  it('identifies compressed tool history messages only', () => {
    const matcher = new ToolPairMatcher();

    expect(matcher.isCompressedToolHistoryMessage(makeCompressedToolHistoryMessage('c1'))).toBe(
      true
    );
    expect(
      matcher.isCompressedToolHistoryMessage({
        id: 'n1',
        role: 'assistant',
        type: 'final_answer',
        content: 'normal',
        timestamp: Date.now(),
        metadata: {},
      })
    ).toBe(false);
  });

  it('finds full tool groups from either tool_calls or tool_output members', () => {
    const matcher = new ToolPairMatcher();
    const states = [
      makeState(makeToolCallMessage('tc1', ['call_1', 'call_2']), 0),
      makeState(makeToolOutputMessage('to1', 'call_1'), 1),
      makeState(makeToolOutputMessage('to2', 'call_2'), 2),
    ];

    const fromToolCall = matcher.findToolCallPair(states[0], states);
    const fromToolResult = matcher.findToolResultPair(states[1], states);

    expect(fromToolCall).not.toBeNull();
    expect(fromToolCall?.messages).toHaveLength(3);
    expect(fromToolResult).not.toBeNull();
    expect(fromToolResult?.toolOutputs.map(state => state.message.id)).toEqual(
      expect.arrayContaining(['to1', 'to2'])
    );
  });

  it('returns null when no matching pair exists', () => {
    const matcher = new ToolPairMatcher();
    const states = [makeState(makeToolOutputMessage('to1', 'call_nonexistent'), 0)];

    expect(matcher.findToolResultPair(states[0], states)).toBeNull();
    expect(matcher.findToolCallPair(states[0], states)).toBeNull();
  });

  it('computes budget fit and overflow reasons correctly', () => {
    const matcher = new ToolPairMatcher();

    const withinBudgetStates = [
      makeState(makeToolCallMessage('tc1', ['call_1', 'call_2']), 0, 100),
      makeState(makeToolOutputMessage('to1', 'call_1'), 1, 100),
      makeState(makeToolOutputMessage('to2', 'call_2'), 2, 100),
    ];
    const withinGroup = matcher.findToolCallPair(withinBudgetStates[0], withinBudgetStates);
    expect(withinGroup).not.toBeNull();
    expect(matcher.canFitToolPair(withinGroup!, 0, 1000)).toEqual(
      expect.objectContaining({
        canFit: true,
        totalTokens: 300,
      })
    );

    const overBudgetStates = [
      makeState(makeToolCallMessage('tc2', ['call_3']), 0, 500),
      makeState(makeToolOutputMessage('to3', 'call_3'), 1, 600),
    ];
    const overBudgetGroup = matcher.findToolCallPair(overBudgetStates[0], overBudgetStates);
    expect(matcher.canFitToolPair(overBudgetGroup!, 0, 1000)).toEqual(
      expect.objectContaining({
        canFit: false,
        reason: 'budget_exceeded',
      })
    );

    const largeButWithinBudgetStates = [
      makeState(makeToolCallMessage('tc3', ['call_4', 'call_5']), 0, 3000),
      makeState(makeToolOutputMessage('to4', 'call_4'), 1, 2000),
      makeState(makeToolOutputMessage('to5', 'call_5'), 2, 2000),
    ];
    const largeButWithinBudgetGroup = matcher.findToolCallPair(
      largeButWithinBudgetStates[0],
      largeButWithinBudgetStates
    );
    expect(matcher.canFitToolPair(largeButWithinBudgetGroup!, 0, 100000)).toEqual(
      expect.objectContaining({
        canFit: true,
        totalTokens: 7000,
      })
    );
  });
});
