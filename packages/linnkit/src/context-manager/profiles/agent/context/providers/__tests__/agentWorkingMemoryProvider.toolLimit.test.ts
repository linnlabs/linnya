import { describe, expect, it } from 'vitest';

import type { AiMessage } from '../../../../../../contracts';
import { AGENT_CONTEXT_BUILDER_CONFIG } from '../../config';
import type { MessageProcessingState, ProviderContext } from '../base';
import { AgentWorkingMemoryProvider } from '../AgentWorkingMemoryProvider';
import { ToolCallIdSchema } from '../../../../../../contracts';

// 保留对历史 host marker 的回归验证，但公开源码不携带完整私有产品字面量。
const legacyTruncatedToolArgumentsMarker = ['__linn', 'ya_truncated_tool_arguments'].join('');

function makeToolPair(i: number): { toolCalls: AiMessage; toolOutput: AiMessage } {
  const toolCallId = `tc_${i}`;

  return {
    toolCalls: {
      id: `a_tc_${i}`,
      role: 'assistant',
      type: 'tool_calls',
      content: '',
      timestamp: 1000 + i * 10,
      metadata: {
        tool_calls: [
          {
            id: ToolCallIdSchema.parse(toolCallId),
            type: 'function',
            function: {
              name: 'workspace_read',
              arguments: JSON.stringify({ document_id: `doc_${i}` }),
            },
          },
        ],
      },
    },
    toolOutput: {
      id: `t_out_${i}`,
      role: 'tool',
      type: 'tool_output',
      content: `output_${i}`,
      timestamp: 1000 + i * 10 + 1,
      metadata: {
        tool_call_id: ToolCallIdSchema.parse(toolCallId),
        tool_name: 'workspace_read',
        data: { value: `output_${i}` },
      },
    },
  };
}

function makeMultiToolGroup(id: string): { toolCalls: AiMessage; outputs: AiMessage[] } {
  const toolCalls: AiMessage = {
    id: `a_${id}`,
    role: 'assistant',
    type: 'tool_calls',
    content: '',
    timestamp: 3000,
    metadata: {
      tool_calls: [
        {
          id: ToolCallIdSchema.parse(`${id}_1`),
          type: 'function',
          function: {
            name: 'resource_list',
            arguments: JSON.stringify({ source: 'workspace' }),
          },
        },
        {
          id: ToolCallIdSchema.parse(`${id}_2`),
          type: 'function',
          function: {
            name: 'resource_read',
            arguments: JSON.stringify({ uri: 'kb://doc-1' }),
          },
        },
      ],
    },
  };

  return {
    toolCalls,
    outputs: [
      {
        id: `t_${id}_1`,
        role: 'tool',
        type: 'tool_output',
        content: 'resource_list output',
        timestamp: 3001,
        metadata: {
          tool_call_id: ToolCallIdSchema.parse(`${id}_1`),
          tool_name: 'resource_list',
          data: { value: 'resource_list output' },
        },
      },
      {
        id: `t_${id}_2`,
        role: 'tool',
        type: 'tool_output',
        content: 'resource_read output',
        timestamp: 3002,
        metadata: {
          tool_call_id: ToolCallIdSchema.parse(`${id}_2`),
          tool_name: 'resource_read',
          data: { value: 'resource_read output' },
        },
      },
    ],
  };
}

function makeCompressedToolHistory(i: number): AiMessage {
  return {
    id: `c_tool_${i}`,
    role: 'assistant',
    type: 'final_answer',
    content: `压缩工具摘要_${i}`,
    timestamp: 500 + i,
    metadata: {
      isCompressedToolHistory: true,
      replacementSourceIds: [`a_tc_old_${i}`, `t_out_old_${i}`],
    },
  };
}

function makeTextMessage(
  id: string,
  role: 'user' | 'assistant',
  type: AiMessage['type'],
  content: string
): AiMessage {
  return {
    id,
    role,
    type,
    content,
    timestamp: 9000,
  } as AiMessage;
}

function makeWriteFilePairWithLargeArguments(): { toolCalls: AiMessage; toolOutput: AiMessage } {
  const toolCallId = 'tc_write_large_args';
  const content = 'createText("大量正文");\n'.repeat(1200);
  return {
    toolCalls: {
      id: 'a_write_large_args',
      role: 'assistant',
      type: 'tool_calls',
      content: '',
      timestamp: 7000,
      metadata: {
        tool_calls: [
          {
            id: ToolCallIdSchema.parse(toolCallId),
            type: 'function',
            function: {
              name: 'write_file',
              arguments: JSON.stringify({
                path: '/测试-文字排版-霞鹜文楷.slides',
                content,
              }),
            },
          },
        ],
      },
    },
    toolOutput: {
      id: 't_write_large_args',
      role: 'tool',
      type: 'tool_output',
      content: '已创建 Slides 文件：/测试-文字排版-霞鹜文楷.slides。',
      timestamp: 7001,
      metadata: {
        tool_call_id: ToolCallIdSchema.parse(toolCallId),
        tool_name: 'write_file',
        data: { path: '/测试-文字排版-霞鹜文楷.slides' },
      },
    },
  };
}

function makeProviderContext(): ProviderContext {
  return {
    totalBudget: 100000,
    config: AGENT_CONTEXT_BUILDER_CONFIG,
    debugMode: false,
    estimateTokens: message =>
      Math.ceil((message.content.length + JSON.stringify(message.metadata ?? {}).length) / 4),
  };
}

function makeProviderContextWithPhase(
  phase: string
): ProviderContext & { currentPhase: { phase: string } } {
  return {
    ...makeProviderContext(),
    currentPhase: { phase },
  };
}

function buildStates(messages: AiMessage[]): MessageProcessingState[] {
  return messages.map((message, index) => ({
    message,
    originalIndex: index,
    action: 'skip',
    tokens: 1,
  }));
}

function readFirstToolArguments(message: AiMessage): string {
  const toolCalls = message.metadata?.tool_calls;
  const rawArguments = Array.isArray(toolCalls) ? toolCalls[0]?.function.arguments : undefined;
  if (typeof rawArguments !== 'string') {
    throw new Error('Expected first tool call arguments');
  }
  return rawArguments;
}

describe('AgentWorkingMemoryProvider tool limits', () => {
  it('uses total input budget for working memory percentage after core messages are kept', async () => {
    const provider = new AgentWorkingMemoryProvider();
    const coreMessage = makeTextMessage('core_user', 'user', 'user_input', '当前用户输入');
    const followupMessage = makeTextMessage(
      'assistant_text',
      'assistant',
      'final_answer',
      '可保留的历史回答'
    );
    const states: MessageProcessingState[] = [
      {
        message: coreMessage,
        originalIndex: 0,
        action: 'keep_core',
        tokens: 600,
      },
      {
        message: followupMessage,
        originalIndex: 1,
        action: 'skip',
        tokens: 50,
      },
    ];

    const result = await provider.provide(states, 400, {
      ...makeProviderContext(),
      totalBudget: 1000,
    });

    expect(result.states.find(state => state.message.id === 'assistant_text')?.action).toBe(
      'keep_working_memory'
    );
  });

  it('keeps current-turn raw tool pairs and caps historical compressed groups at config limit', async () => {
    const provider = new AgentWorkingMemoryProvider();
    const compressed = Array.from(
      { length: AGENT_CONTEXT_BUILDER_CONFIG.MAX_TOOL_INTERACTION_GROUPS_TO_KEEP + 1 },
      (_, idx) => makeCompressedToolHistory(idx + 1)
    );
    const rawPairs = [makeToolPair(1), makeToolPair(2)];
    const userInput: AiMessage = {
      id: 'user_input_1',
      role: 'user',
      type: 'user_input',
      content: '用户输入',
      timestamp: 600,
      metadata: {},
    };

    const states = buildStates([
      ...compressed,
      userInput,
      rawPairs[0].toolCalls,
      rawPairs[0].toolOutput,
      rawPairs[1].toolCalls,
      rawPairs[1].toolOutput,
    ]);

    const result = await provider.provide(states, 100000, makeProviderContext());
    const kept = result.states
      .filter(state => state.action === 'keep_working_memory')
      .map(state => state.message.id);

    expect(kept).toEqual(expect.arrayContaining(['a_tc_1', 't_out_1', 'a_tc_2', 't_out_2']));

    const keptCompressed = kept.filter(id => id.startsWith('c_tool_'));
    expect(keptCompressed).toHaveLength(
      AGENT_CONTEXT_BUILDER_CONFIG.MAX_TOOL_INTERACTION_GROUPS_TO_KEEP
    );
    expect(keptCompressed).toEqual(
      expect.arrayContaining(
        Array.from(
          { length: AGENT_CONTEXT_BUILDER_CONFIG.MAX_TOOL_INTERACTION_GROUPS_TO_KEEP },
          (_, idx) => `c_tool_${idx + 2}`
        )
      )
    );
  });

  it('treats a multi-tool current-turn group as one preserved raw interaction group', async () => {
    const provider = new AgentWorkingMemoryProvider();
    const compressed = Array.from(
      { length: AGENT_CONTEXT_BUILDER_CONFIG.MAX_TOOL_INTERACTION_GROUPS_TO_KEEP + 1 },
      (_, idx) => makeCompressedToolHistory(idx + 1)
    );
    const multiToolGroup = makeMultiToolGroup('multi_group');
    const userInput: AiMessage = {
      id: 'user_input_1',
      role: 'user',
      type: 'user_input',
      content: '用户输入',
      timestamp: 600,
      metadata: {},
    };

    const states = buildStates([
      ...compressed,
      userInput,
      multiToolGroup.toolCalls,
      ...multiToolGroup.outputs,
    ]);

    const result = await provider.provide(states, 100000, makeProviderContext());
    const kept = result.states
      .filter(state => state.action === 'keep_working_memory')
      .map(state => state.message.id);

    expect(kept).toEqual(
      expect.arrayContaining(['a_multi_group', 't_multi_group_1', 't_multi_group_2'])
    );
    expect(kept.filter(id => id.startsWith('c_tool_'))).toHaveLength(
      AGENT_CONTEXT_BUILDER_CONFIG.MAX_TOOL_INTERACTION_GROUPS_TO_KEEP
    );
  });

  it('keeps every raw tool group in the latest historical turn instead of capping by group count', async () => {
    const provider = new AgentWorkingMemoryProvider({
      MAX_RECENT_TOOL_RUNS_TO_KEEP: 2,
      MAX_TOOL_INTERACTION_GROUPS_TO_KEEP: 12,
    });
    const oldPair = makeToolPair(100);
    const latestTurnPairs = Array.from({ length: 4 }, (_, index) => makeToolPair(index + 1));
    const states = buildStates([
      makeTextMessage('user_old_turn', 'user', 'user_input', '旧 turn'),
      oldPair.toolCalls,
      oldPair.toolOutput,
      makeTextMessage('user_latest_tool_turn', 'user', 'user_input', '最近有工具的 turn'),
      ...latestTurnPairs.flatMap(pair => [pair.toolCalls, pair.toolOutput]),
      makeTextMessage('user_current_turn', 'user', 'user_input', '当前 turn'),
    ]);

    const result = await provider.provide(states, 100000, makeProviderContext());
    const kept = result.states
      .filter(state => state.action === 'keep_working_memory')
      .map(state => state.message.id);

    for (const pair of latestTurnPairs) {
      expect(kept).toEqual(expect.arrayContaining([pair.toolCalls.id, pair.toolOutput.id]));
    }
    expect(kept).not.toContain(oldPair.toolCalls.id);
    expect(kept).not.toContain(oldPair.toolOutput.id);
  });

  it('honors constructor customConfig instead of hardcoding AGENT_CONTEXT_BUILDER_CONFIG', async () => {
    const provider = new AgentWorkingMemoryProvider({
      MAX_TOOL_INTERACTION_GROUPS_TO_KEEP: 2,
      MAX_RECENT_TOOL_RUNS_TO_KEEP: 2,
    });
    const compressed = Array.from({ length: 5 }, (_, idx) => makeCompressedToolHistory(idx + 1));
    const userInput: AiMessage = {
      id: 'user_input_1',
      role: 'user',
      type: 'user_input',
      content: '用户输入',
      timestamp: 600,
      metadata: {},
    };

    const states = buildStates([...compressed, userInput]);

    const result = await provider.provide(states, 100000, makeProviderContext());
    const keptCompressed = result.states
      .filter(state => state.action === 'keep_working_memory')
      .map(state => state.message.id)
      .filter(id => id.startsWith('c_tool_'));

    expect(keptCompressed).toHaveLength(2);
    expect(keptCompressed).toEqual(['c_tool_4', 'c_tool_5']);
  });

  it('prioritizes the latest complete tool group during post_tool_call phase', async () => {
    const provider = new AgentWorkingMemoryProvider({
      MAX_RECENT_TOOL_RUNS_TO_KEEP: 0,
      MAX_TOOL_INTERACTION_GROUPS_TO_KEEP: 0,
    });
    const oldPair = makeToolPair(1);
    const latestPair = makeToolPair(2);
    const states = buildStates([
      makeTextMessage('user_1', 'user', 'user_input', '用户输入'),
      oldPair.toolCalls,
      oldPair.toolOutput,
      latestPair.toolCalls,
      latestPair.toolOutput,
    ]);

    const result = await provider.provide(
      states,
      100000,
      makeProviderContextWithPhase('post_tool_call')
    );
    const kept = result.states
      .filter(state => state.action === 'keep_working_memory')
      .map(state => state.message.id);

    expect(result.strategiesApplied).toContain('post_tool_call_priority');
    expect(kept).toEqual(expect.arrayContaining(['a_tc_2', 't_out_2']));
  });

  it('does not admit UI thought projections into working memory', async () => {
    const provider = new AgentWorkingMemoryProvider();
    const states = buildStates([
      makeTextMessage('thought_1', 'assistant', 'thought', '第一段思考'),
      makeTextMessage('thought_2', 'assistant', 'thought', '第二段思考'),
      makeTextMessage('thought_3', 'assistant', 'thought', '第三段思考'),
      makeTextMessage('assistant_text', 'assistant', 'final_answer', '普通回复'),
    ]);

    const result = await provider.provide(states, 100000, makeProviderContext());
    const kept = result.states
      .filter(state => state.action === 'keep_working_memory')
      .map(state => state.message.id);

    expect(kept).toEqual(['assistant_text']);
    expect(result.strategiesApplied).toEqual(['text_conversation']);
  });

  it('keeps configured minimum tool groups even when working-memory budget is exhausted', async () => {
    const provider = new AgentWorkingMemoryProvider({
      MIN_TOOL_INTERACTIONS_TO_KEEP: 1,
      MAX_RECENT_TOOL_RUNS_TO_KEEP: 1,
      MAX_TOOL_INTERACTION_GROUPS_TO_KEEP: 1,
    });
    const pair = makeToolPair(1);
    const states = buildStates([
      pair.toolCalls,
      pair.toolOutput,
      makeTextMessage('user_1', 'user', 'user_input', '继续'),
    ]);

    const result = await provider.provide(states, 1, makeProviderContext());
    const kept = result.states
      .filter(state => state.action === 'keep_working_memory')
      .map(state => state.message.id);

    expect(kept).toEqual(expect.arrayContaining(['a_tc_1', 't_out_1']));
  });

  it('keeps current-turn write_file arguments raw even when the pair exceeds budget', async () => {
    const provider = new AgentWorkingMemoryProvider({
      MIN_TOOL_INTERACTIONS_TO_KEEP: 0,
      MAX_RECENT_TOOL_RUNS_TO_KEEP: 1,
      MAX_TOOL_INTERACTION_GROUPS_TO_KEEP: 1,
    });
    const pair = makeWriteFilePairWithLargeArguments();
    const user = makeTextMessage('user_write_large_args', 'user', 'user_input', '创建测试 slides');
    const states = buildStates([user, pair.toolCalls, pair.toolOutput]);
    const toolCallState = states.find(state => state.message.id === pair.toolCalls.id);
    if (!toolCallState) {
      throw new Error('Expected tool call state');
    }
    toolCallState.tokens = 5_000;
    const originalArguments = readFirstToolArguments(pair.toolCalls);

    const result = await provider.provide(states, 10, {
      ...makeProviderContext(),
      totalBudget: 10,
    });
    const kept = result.states
      .filter(state => state.action === 'keep_working_memory')
      .map(state => state.message.id);

    expect(kept).toEqual(expect.arrayContaining(['a_write_large_args', 't_write_large_args']));
    expect(result.strategiesApplied).toContain('tool_interaction_pairing_forced');
    expect(toolCallState.overrideMetadata).toBeUndefined();
    expect(readFirstToolArguments(toolCallState.message)).toBe(originalArguments);
    expect(originalArguments).toContain('大量正文');
    expect(originalArguments).not.toContain(legacyTruncatedToolArgumentsMarker);
  });

  it('keeps latest historical turn write_file arguments raw when budget is exhausted', async () => {
    const provider = new AgentWorkingMemoryProvider({
      MIN_TOOL_INTERACTIONS_TO_KEEP: 1,
      MAX_RECENT_TOOL_RUNS_TO_KEEP: 2,
      MAX_TOOL_INTERACTION_GROUPS_TO_KEEP: 1,
    });
    const pair = makeWriteFilePairWithLargeArguments();
    const states = buildStates([
      pair.toolCalls,
      pair.toolOutput,
      makeTextMessage('user_after_large_args', 'user', 'user_input', '继续'),
    ]);
    const toolCallState = states.find(state => state.message.id === pair.toolCalls.id);
    if (!toolCallState) {
      throw new Error('Expected tool call state');
    }
    toolCallState.tokens = 5_000;
    const originalArguments = readFirstToolArguments(pair.toolCalls);

    const result = await provider.provide(states, 10, {
      ...makeProviderContext(),
      totalBudget: 20,
    });

    const kept = result.states
      .filter(state => state.action === 'keep_working_memory')
      .map(state => state.message.id);
    expect(kept).toEqual(expect.arrayContaining(['a_write_large_args', 't_write_large_args']));
    expect(result.strategiesApplied).toContain('tool_interaction_pairing_forced');
    expect(toolCallState.overrideMetadata).toBeUndefined();
    expect(readFirstToolArguments(toolCallState.message)).toBe(originalArguments);
    expect(originalArguments).not.toContain(legacyTruncatedToolArgumentsMarker);
  });

  it('honors toolPairingSearchRange when matching tool outputs', async () => {
    const pair = makeToolPair(1);
    const farMessages = [
      pair.toolCalls,
      makeTextMessage('assistant_gap', 'assistant', 'final_answer', '间隔消息'),
      pair.toolOutput,
    ];
    const narrowProvider = new AgentWorkingMemoryProvider({
      TOOL_PAIRING_SEARCH_RANGE: 1,
      MIN_TOOL_INTERACTIONS_TO_KEEP: 0,
      MAX_RECENT_TOOL_RUNS_TO_KEEP: 1,
      MAX_TOOL_INTERACTION_GROUPS_TO_KEEP: 1,
    });

    const narrowResult = await narrowProvider.provide(
      buildStates(farMessages),
      100000,
      makeProviderContext()
    );
    const narrowKept = narrowResult.states
      .filter(state => state.action === 'keep_working_memory')
      .map(state => state.message.id);

    expect(narrowKept).not.toContain('a_tc_1');
    expect(narrowKept).not.toContain('t_out_1');

    const wideProvider = new AgentWorkingMemoryProvider({
      TOOL_PAIRING_SEARCH_RANGE: 2,
      MIN_TOOL_INTERACTIONS_TO_KEEP: 0,
      MAX_RECENT_TOOL_RUNS_TO_KEEP: 1,
      MAX_TOOL_INTERACTION_GROUPS_TO_KEEP: 1,
    });

    const wideResult = await wideProvider.provide(
      buildStates(farMessages),
      100000,
      makeProviderContext()
    );
    const wideKept = wideResult.states
      .filter(state => state.action === 'keep_working_memory')
      .map(state => state.message.id);

    expect(wideKept).toEqual(expect.arrayContaining(['a_tc_1', 't_out_1']));
  });

  it('keeps plain text conversation messages when budget allows', async () => {
    const provider = new AgentWorkingMemoryProvider();
    const states = buildStates([
      makeTextMessage('user_old', 'user', 'user_input', '旧问题'),
      makeTextMessage('assistant_old', 'assistant', 'final_answer', '旧回答'),
      makeTextMessage('user_new', 'user', 'user_input', '新问题'),
    ]);

    const result = await provider.provide(states, 100000, makeProviderContext());
    const kept = result.states
      .filter(state => state.action === 'keep_working_memory')
      .map(state => state.message.id);

    expect(kept).toEqual(expect.arrayContaining(['user_old', 'assistant_old', 'user_new']));
    expect(result.strategiesApplied).toContain('text_conversation');
  });

  it('does not refill historical raw tool groups through P3 when turn protection is disabled', async () => {
    const provider = new AgentWorkingMemoryProvider({
      MAX_RECENT_TOOL_RUNS_TO_KEEP: 0,
      MAX_TOOL_INTERACTION_GROUPS_TO_KEEP: 1,
    });
    const historicalPair = makeToolPair(1);
    const states = buildStates([
      historicalPair.toolCalls,
      historicalPair.toolOutput,
      makeTextMessage('user_1', 'user', 'user_input', '继续'),
    ]);

    const result = await provider.provide(states, 100000, makeProviderContext());
    const kept = result.states
      .filter(state => state.action === 'keep_working_memory')
      .map(state => state.message.id);

    expect(result.strategiesApplied).not.toContain('historical_tool_interaction');
    expect(kept).not.toContain('a_tc_1');
    expect(kept).not.toContain('t_out_1');
  });
});
