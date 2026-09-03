import { describe, expect, it } from 'vitest';
import { ToolHistoryCompressorPreprocessor } from '../../../preprocessors/toolHistoryCompressor';
import { ToolReplayProtocolGuardPreprocessor } from '../../../preprocessors/toolReplayProtocolGuard';
import { AgentWorkingMemoryProvider } from '../AgentWorkingMemoryProvider';
import { HistoryPurificationPreprocessor } from '../../../../../shared/preprocessors';
import { formatAgentLlmMessages } from '../../../../../shared';
import { createContextPipelineHarness } from '../../../../../../testkit/context-harness/contextPipelineHarness';
import type { AiMessage } from '../../../../../../contracts';
import { ToolCallIdSchema } from '../../../../../../contracts';

function makeMultiToolMessages(): AiMessage[] {
  return [
    {
      id: 'user_old',
      role: 'user',
      type: 'user_input',
      content: '先测试多工具调用',
      timestamp: 1000,
    },
    {
      id: 'assistant_multi',
      role: 'assistant',
      type: 'tool_calls',
      content: '',
      timestamp: 1100,
      metadata: {
        tool_calls: [
          {
            id: ToolCallIdSchema.parse('call_list'),
            type: 'function',
            function: {
              name: 'resource_list',
              arguments: JSON.stringify({ source: 'workspace' }),
            },
          },
          {
            id: ToolCallIdSchema.parse('call_read'),
            type: 'function',
            function: {
              name: 'resource_read',
              arguments: JSON.stringify({ uri: 'kb://doc-1' }),
            },
          },
        ],
      },
    },
    {
      id: 'tool_list',
      role: 'tool',
      type: 'tool_output',
      content: '{"observation":"列出 3 个资源"}',
      timestamp: 1200,
      metadata: {
        tool_call_id: ToolCallIdSchema.parse('call_list'),
        tool_name: 'resource_list',
        data: { count: 3 },
      },
    },
    {
      id: 'tool_read',
      role: 'tool',
      type: 'tool_output',
      content: '{"observation":"读取文档成功"}',
      timestamp: 1300,
      metadata: {
        tool_call_id: ToolCallIdSchema.parse('call_read'),
        tool_name: 'resource_read',
        data: { content: '读取文档成功' },
      },
    },
    {
      id: 'user_new',
      role: 'user',
      type: 'user_input',
      content: '继续追问',
      timestamp: 2000,
    },
  ];
}

describe('multi tool follow-up integration', () => {
  it('应保留压缩后的多工具摘要，并在净化阶段通过 replacementSourceIds 移除', async () => {
    const sourceMessages = makeMultiToolMessages();
    const pipelineHarness = createContextPipelineHarness({
      messages: sourceMessages,
      estimateTokens: () => 1,
      totalBudget: 100_000,
    });

    const compressedResult = await pipelineHarness.runPreprocessors([
      new ToolHistoryCompressorPreprocessor({
        strategy: 'per-pair',
        retentionMode: 'compress',
        keepLatestToolPairs: 0,
      }),
    ]);
    const compressedSummary = compressedResult.messages.find(
      message => message.metadata?.isCompressedToolHistory === true
    );

    expect(compressedSummary).toBeDefined();
    expect(compressedSummary?.metadata?.replacementSourceIds).toHaveLength(3);

    const workingMemoryResult = await pipelineHarness.runProvider(
      new AgentWorkingMemoryProvider(),
      {
        messages: compressedResult.messages,
        coreMessageIds: ['user_new'],
      }
    );
    const keptCompressedSummary = workingMemoryResult.states.find(
      state => state.message.id === compressedSummary?.id
    );

    expect(keptCompressedSummary?.action).toBe('keep_working_memory');

    const replacementSourceIds = compressedSummary?.metadata?.replacementSourceIds;
    const historySummary: AiMessage = {
      id: 'history_summary_1',
      role: 'system',
      type: 'history_summary',
      content: '历史摘要',
      timestamp: 3000,
      metadata: {
        summarySeq: 1,
        replacedMessageIds: Array.isArray(replacementSourceIds)
          ? replacementSourceIds.filter((id): id is string => typeof id === 'string')
          : [],
      },
    };
    const purifiedResult = await createContextPipelineHarness({
      messages: [
        historySummary,
        ...(compressedSummary ? [compressedSummary] : []),
        {
          id: 'user_after_summary',
          role: 'user',
          type: 'user_input',
          content: '摘要后继续提问',
          timestamp: 4000,
        },
      ],
      estimateTokens: () => 1,
    }).runPreprocessors([
      new HistoryPurificationPreprocessor({ logPrefix: 'MultiToolFollowupTest' }),
    ]);

    expect(purifiedResult.messages.some(message => message.id === compressedSummary?.id)).toBe(
      false
    );
  });

  it('应让带 producer identity 的 continuation 经过三阶段后仍随 assistant(tool_calls) 出关', async () => {
    const providerContinuations = [{
      schema_version: 2 as const,
      producer: {
        model_id: 'deepseek-reasoner',
        endpoint_id: 'deepseek',
        api_surface: 'openai_chat_completions',
        capability_id: 'test:chat-codec',
        endpoint_model_id: 'deepseek-reasoner',
      },
      kind: 'reasoning_content',
      payload: { provider: 'deepseek', type: 'reasoning_content', reasoning_content: 'Need the tool.' },
    }];
    const sourceMessages: AiMessage[] = [
      {
        id: 'user_old_sidecar',
        role: 'user',
        type: 'user_input',
        content: '先读文档',
        timestamp: 1000,
      },
      {
        id: 'assistant_sidecar',
        role: 'assistant',
        type: 'tool_calls',
        content: '',
        timestamp: 1100,
        metadata: {
          provider_continuations: providerContinuations,
          assistant_replay_parts: [{
            type: 'tool_call',
            tool_call_id: 'call_sidecar',
            provider_continuations: providerContinuations,
          }],
          tool_calls: [
            {
              id: ToolCallIdSchema.parse('call_sidecar'),
              type: 'function',
              function: {
                name: 'workspace_read',
                arguments: JSON.stringify({ path: 'README.md' }),
              },
            },
          ],
        },
      },
      {
        id: 'tool_sidecar',
        role: 'tool',
        type: 'tool_output',
        content: '{"observation":"README 内容"}',
        timestamp: 1200,
        metadata: {
          tool_call_id: ToolCallIdSchema.parse('call_sidecar'),
          tool_name: 'workspace_read',
          data: { content: 'README 内容' },
        },
      },
      {
        id: 'assistant_after_tool',
        role: 'assistant',
        type: 'final_answer',
        content: '已读完。',
        timestamp: 1300,
      },
      {
        id: 'user_followup_sidecar',
        role: 'user',
        type: 'user_input',
        content: '继续',
        timestamp: 2000,
      },
    ];

    const pipelineHarness = createContextPipelineHarness({
      messages: sourceMessages,
      estimateTokens: () => 1,
      totalBudget: 100_000,
    });
    const compressedResult = await pipelineHarness.runPreprocessors([
      new ToolHistoryCompressorPreprocessor({ strategy: 'per-pair', keepLatestToolPairs: 2 }),
      new HistoryPurificationPreprocessor({ logPrefix: 'SidecarRootCauseTest' }),
    ]);
    const workingMemoryResult = await pipelineHarness.runProvider(
      new AgentWorkingMemoryProvider(),
      {
        messages: compressedResult.messages,
        coreMessageIds: ['user_followup_sidecar'],
      }
    );
    const selectedMessages = workingMemoryResult.states
      .filter(state => state.action === 'keep_core' || state.action === 'keep_working_memory')
      .map(state => state.message);
    const llmMessages = formatAgentLlmMessages(selectedMessages);
    const assistantToolCalls = llmMessages.find(message => {
      return message.role === 'assistant' && 'tool_calls' in message;
    });

    expect(assistantToolCalls).toBeDefined();
    expect(assistantToolCalls?.provider_continuations).toEqual(providerContinuations);
    expect(assistantToolCalls?.assistant_replay_parts).toEqual([{
      type: 'tool_call',
      tool_call_id: 'call_sidecar',
      provider_continuations: providerContinuations,
    }]);
  });

  it('required route 的历史工具组缺 continuation 时应直接失败', async () => {
    const sourceMessages: AiMessage[] = [
      {
        id: 'user_old_missing_sidecar',
        role: 'user',
        type: 'user_input',
        content: '先读文档',
        timestamp: 1000,
      },
      {
        id: 'assistant_missing_sidecar',
        role: 'assistant',
        type: 'tool_calls',
        content: '',
        timestamp: 1100,
        metadata: {
          tool_calls: [
            {
              id: ToolCallIdSchema.parse('call_missing_sidecar'),
              type: 'function',
              function: {
                name: 'workspace_read',
                arguments: JSON.stringify({ path: 'README.md' }),
              },
            },
          ],
        },
      },
      {
        id: 'tool_missing_sidecar',
        role: 'tool',
        type: 'tool_output',
        content: '{"observation":"README 内容"}',
        timestamp: 1200,
        metadata: {
          tool_call_id: ToolCallIdSchema.parse('call_missing_sidecar'),
          tool_name: 'workspace_read',
          data: { content: 'README 内容' },
        },
      },
      {
        id: 'user_followup_missing_sidecar',
        role: 'user',
        type: 'user_input',
        content: '继续',
        timestamp: 2000,
      },
    ];

    const pipelineHarness = createContextPipelineHarness({
      messages: sourceMessages,
      estimateTokens: () => 1,
      totalBudget: 100_000,
    });
    const processing = pipelineHarness.runPreprocessors([
      new ToolHistoryCompressorPreprocessor({ strategy: 'per-pair', keepLatestToolPairs: 2 }),
      new ToolReplayProtocolGuardPreprocessor({
        policy: {
          provider: 'deepseek',
          requiresProviderContinuationForToolReplay: true,
        },
      }),
      new HistoryPurificationPreprocessor({ logPrefix: 'SidecarGuardTest' }),
    ]);
    await expect(processing).rejects.toThrow(/要求工具回放携带有序 provider continuation/);
  });
});
