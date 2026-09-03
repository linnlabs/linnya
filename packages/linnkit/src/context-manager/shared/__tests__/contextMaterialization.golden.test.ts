import { describe, expect, it, vi } from 'vitest';

import type { AiMessage } from '../../../contracts';
import {
  AgentBuildPhase,
  createAgentContextBuilderConfig,
  type AgentContextBuildStats,
  type AgentContextBuilderConfig,
} from '../../profiles/agent/context/config';
import { getAgentBuildPhaseByProviderName } from '../../profiles/agent/context/functions/providerPhase';
import {
  AgentCoreContextProvider,
  AgentWorkingMemoryProvider,
} from '../../profiles/agent/context/providers';
import type { ProviderContext } from '../../profiles/agent/context/providers/base';
import { ContextTraceCollector } from '../context-trace';
import { createContextPipelineHarness } from '../../../testkit/context-harness';
import { ToolCallIdSchema } from '../../../contracts';

const TOTAL_BUDGET = 1_000;

function createStats(original: number): AgentContextBuildStats {
  return {
    startTime: 0,
    phaseTiming: {
      [AgentBuildPhase.CORE_CONTEXT]: 0,
      [AgentBuildPhase.WORKING_MEMORY]: 0,
    },
    phaseTokenUsage: {
      [AgentBuildPhase.CORE_CONTEXT]: { used: 0, percentage: 0 },
      [AgentBuildPhase.WORKING_MEMORY]: { used: 0, percentage: 0 },
    },
    messageStats: {
      original,
      afterCoreContext: 0,
      afterWorkingMemory: 0,
    },
    priorityStats: {
      p1ToolInteractions: 0,
      p2TextConversations: 0,
      p3HistoricalTools: 0,
      p4CircularFill: 0,
    },
    toolStats: {
      totalToolCalls: 0,
      pairedToolCalls: 0,
      unpairedToolCalls: 0,
      toolPairingSuccessRate: 0,
    },
    documentTruncated: false,
    totalTime: 0,
  };
}

function message(input: AiMessage): AiMessage {
  return input;
}

function createToolCallsMessage(id: string, toolCallId: string, timestamp: number): AiMessage {
  return message({
    id,
    role: 'assistant',
    type: 'tool_calls',
    content: '',
    timestamp,
    metadata: {
      tool_calls: [
        {
          id: ToolCallIdSchema.parse(toolCallId),
          type: 'function',
          function: {
            name: 'search_docs',
            arguments: JSON.stringify({ query: 'context materialization' }),
          },
        },
      ],
    },
  });
}

function createToolOutputMessage(
  id: string,
  toolCallId: string,
  content: string,
  timestamp: number
): AiMessage {
  return message({
    id,
    role: 'tool',
    type: 'tool_output',
    content,
    timestamp,
    metadata: {
      tool_call_id: ToolCallIdSchema.parse(toolCallId),
      tool_name: 'search_docs',
      data: { content },
    },
  });
}

function createMessages(): AiMessage[] {
  const longToolOutput = [
    'BEGIN_TOOL_OUTPUT',
    ...Array.from(
      { length: 140 },
      (_, index) => `row_${index}: context materialization golden payload`
    ),
    'END_TOOL_OUTPUT',
  ].join('\n');

  return [
    message({
      id: 'system-1',
      role: 'system',
      type: 'system_prompt',
      content: 'You are Linnkit test agent.',
      timestamp: 1,
    }),
    message({
      id: 'summary-1',
      role: 'system',
      type: 'history_summary',
      content: 'Earlier conversation summary.',
      timestamp: 2,
    }),
    message({
      id: 'user-old-1',
      role: 'user',
      type: 'user_input',
      content: 'Earlier user question.',
      timestamp: 3,
    }),
    message({
      id: 'assistant-old-1',
      role: 'assistant',
      type: 'final_answer',
      content: 'Earlier assistant answer.',
      timestamp: 4,
    }),
    createToolCallsMessage('tool-call-1', 'call-1', 5),
    createToolOutputMessage('tool-output-1', 'call-1', longToolOutput, 6),
    message({
      id: 'user-current',
      role: 'user',
      type: 'user_input',
      content: 'Current user request.',
      timestamp: 7,
    }),
  ];
}

function estimateTokens(item: AiMessage): number {
  if (item.type === 'tool_output') {
    return Math.ceil(item.content.length / 20);
  }
  if (item.type === 'tool_calls') {
    return 40;
  }
  return Math.max(1, Math.ceil(item.content.length / 8));
}

function createProviderContext(config: AgentContextBuilderConfig): ProviderContext {
  return {
    totalBudget: TOTAL_BUDGET,
    config,
    debugMode: false,
    estimateTokens,
  };
}

function selectGoldenFields(
  messages: AiMessage[]
): Array<Pick<AiMessage, 'id' | 'role' | 'type' | 'content'>> {
  return messages.map(item => ({
    id: item.id,
    role: item.role,
    type: item.type,
    content: item.content,
  }));
}

describe('context materialization golden', () => {
  it('物化后的 AiMessage[] 锁定 system、summary、普通对话、工具对与原始 tool_output 的顺序和内容', async () => {
    const messages = createMessages();
    const originalToolOutput = messages.find(item => item.id === 'tool-output-1')?.content;
    if (typeof originalToolOutput !== 'string') {
      throw new Error('Expected original tool output');
    }
    const config = createAgentContextBuilderConfig({
      WORKING_MEMORY_BUDGET_PERCENTAGE: 0.7,
      MIN_TOOL_INTERACTIONS_TO_KEEP: 1,
      MAX_RECENT_TOOL_RUNS_TO_KEEP: 1,
      MAX_TOOL_INTERACTION_GROUPS_TO_KEEP: 1,
      AVG_CHARS_PER_TOKEN: 2,
    });
    const harness = createContextPipelineHarness({
      messages,
      totalBudget: TOTAL_BUDGET,
      estimateTokens,
    });

    const result = await harness.runPipeline(
      [new AgentCoreContextProvider(), new AgentWorkingMemoryProvider(config)],
      {
        buildStats: createStats(messages.length),
        providerContext: createProviderContext(config),
        getPhaseByProviderName: getAgentBuildPhaseByProviderName,
      }
    );

    expect(result.strategiesApplied).toEqual(
      expect.arrayContaining(['history_summary', 'text_conversation', 'tool_interaction_pairing'])
    );
    expect(selectGoldenFields(result.finalMessages)).toEqual([
      {
        content: 'You are Linnkit test agent.',
        id: 'system-1',
        role: 'system',
        type: 'system_prompt',
      },
      {
        content: 'Earlier conversation summary.',
        id: 'summary-1',
        role: 'system',
        type: 'history_summary',
      },
      {
        content: 'Earlier user question.',
        id: 'user-old-1',
        role: 'user',
        type: 'user_input',
      },
      {
        content: 'Earlier assistant answer.',
        id: 'assistant-old-1',
        role: 'assistant',
        type: 'final_answer',
      },
      {
        content: '',
        id: 'tool-call-1',
        role: 'assistant',
        type: 'tool_calls',
      },
      {
        content: originalToolOutput,
        id: 'tool-output-1',
        role: 'tool',
        type: 'tool_output',
      },
      {
        content: 'Current user request.',
        id: 'user-current',
        role: 'user',
        type: 'user_input',
      },
    ]);
  });

  it('pipeline 不应改写传入的原始 message.content', async () => {
    const messages = createMessages();
    const originalToolOutput = messages.find(item => item.id === 'tool-output-1')?.content;
    const config = createAgentContextBuilderConfig({
      WORKING_MEMORY_BUDGET_PERCENTAGE: 0.12,
      MIN_TOOL_INTERACTIONS_TO_KEEP: 1,
      MAX_RECENT_TOOL_RUNS_TO_KEEP: 1,
      MAX_TOOL_INTERACTION_GROUPS_TO_KEEP: 1,
      AVG_CHARS_PER_TOKEN: 2,
    });
    const harness = createContextPipelineHarness({
      messages,
      totalBudget: TOTAL_BUDGET,
      estimateTokens,
    });

    await harness.runPipeline(
      [new AgentCoreContextProvider(), new AgentWorkingMemoryProvider(config)],
      {
        buildStats: createStats(messages.length),
        providerContext: createProviderContext(config),
        getPhaseByProviderName: getAgentBuildPhaseByProviderName,
      }
    );

    expect(messages.find(item => item.id === 'tool-output-1')?.content).toBe(originalToolOutput);
  });

  it('trace 的 provider before/after 不应再出现构建期 output override', async () => {
    let observedBeforeOverride: string | undefined = 'NOT_CALLED';
    let observedAfterOverride: string | undefined = 'NOT_CALLED';
    const messages = createMessages();
    const originalToolOutput = messages.find(item => item.id === 'tool-output-1')?.content;
    const config = createAgentContextBuilderConfig({
      WORKING_MEMORY_BUDGET_PERCENTAGE: 0.12,
      MIN_TOOL_INTERACTIONS_TO_KEEP: 1,
      MAX_RECENT_TOOL_RUNS_TO_KEEP: 1,
      MAX_TOOL_INTERACTION_GROUPS_TO_KEEP: 1,
      AVG_CHARS_PER_TOKEN: 2,
    });
    const contextTrace = ContextTraceCollector.create({
      policy: {
        enabled: true,
        includeMessageIds: true,
        includeTokenBreakdown: true,
        maxTraceEvents: 20,
      },
      totalBudget: TOTAL_BUDGET,
      originalCount: 1,
    });
    if (!contextTrace) {
      throw new Error('Expected context trace collector');
    }
    vi.spyOn(contextTrace, 'recordProvider').mockImplementation(input => {
      if (input.providerName !== 'AgentWorkingMemoryProvider') {
        return;
      }
      observedBeforeOverride = input.beforeStates.find(
        state => state.message.id === 'tool-output-1'
      )?.overrideContent;
      observedAfterOverride = input.afterStates.find(
        state => state.message.id === 'tool-output-1'
      )?.overrideContent;
    });
    const harness = createContextPipelineHarness({
      messages,
      totalBudget: TOTAL_BUDGET,
      estimateTokens,
    });

    await harness.runPipeline(
      [new AgentCoreContextProvider(), new AgentWorkingMemoryProvider(config)],
      {
        buildStats: createStats(messages.length),
        providerContext: createProviderContext(config),
        getPhaseByProviderName: getAgentBuildPhaseByProviderName,
        contextTrace,
      }
    );

    expect(observedBeforeOverride).toBeUndefined();
    expect(observedAfterOverride).toBeUndefined();
    expect(messages.find(item => item.id === 'tool-output-1')?.content).toBe(originalToolOutput);
  });
});
