import { describe, expect, it } from 'vitest';
import {
  AiMessage as AiMessageSchema,
  ToolCallIdSchema,
  type AiMessage,
  type RuntimeResourceRef,
} from '../../../../contracts';
import { DEFAULT_MUST_KEEP_POLICY } from '../../../shared/policies';
import { HistoryPurificationPreprocessor } from '../../../shared/preprocessors';
import {
  CONTEXT_CHECKPOINT_CLOSE_TAG,
  CONTEXT_CHECKPOINT_OPEN_TAG,
  CONTEXT_CHECKPOINT_SECTION_HEADINGS,
} from '../definitions/contextCheckpointFormat';
import { createHistorySummaryDraft } from './createHistorySummaryDraft';
import { resolveContextCompactionPolicy } from './resolveContextCompactionPolicy';
import { selectContextCompactionCandidate } from './selectContextCompactionCandidate';

function message(input: {
  id: string;
  role: AiMessage['role'];
  type: AiMessage['type'];
  content?: string;
  timestamp: number;
  metadata?: AiMessage['metadata'];
  attachments?: readonly RuntimeResourceRef[];
}): AiMessage {
  return AiMessageSchema.parse({
    ...input,
    content: input.content ?? input.id,
  });
}

function toolGroup(name: string, timestamp: number, outputCount = 1): AiMessage[] {
  const callIds = Array.from(
    { length: outputCount },
    (_, index) => ToolCallIdSchema.parse(`call_${name}_${index}`),
  );
  return [
    message({
      id: `assistant_${name}`,
      role: 'assistant',
      type: 'tool_calls',
      content: '',
      timestamp,
      metadata: {
        tool_calls: callIds.map((id, index) => ({
          id,
          type: 'function',
          function: { name: `tool_${index}`, arguments: '{}' },
        })),
      },
    }),
    ...callIds.map((toolCallId, index) => message({
      id: `output_${name}_${index}`,
      role: 'tool',
      type: 'tool_output',
      timestamp: timestamp + index + 1,
      metadata: {
        tool_call_id: toolCallId,
        tool_name: `tool_${index}`,
        data: { value: name },
      },
    })),
  ];
}

const estimateTokens = (value: AiMessage): number => Math.max(1, value.content.length);

function validCheckpoint(): string {
  return [
    CONTEXT_CHECKPOINT_OPEN_TAG,
    ...CONTEXT_CHECKPOINT_SECTION_HEADINGS.flatMap(heading => [heading, '保留既有事实。']),
    CONTEXT_CHECKPOINT_CLOSE_TAG,
  ].join('\n');
}

describe('selectContextCompactionCandidate', () => {
  it('按完整工具组替换当前 run 的旧组，并保留最新两组', () => {
    const messages: AiMessage[] = [
      message({ id: 'system', role: 'system', type: 'system_prompt', timestamp: 1 }),
      message({ id: 'user', role: 'user', type: 'user_input', timestamp: 2 }),
      ...toolGroup('one', 10, 2),
      ...toolGroup('two', 20),
      ...toolGroup('three', 30),
      ...toolGroup('four', 40),
    ];

    const candidate = selectContextCompactionCandidate({
      messages,
      totalBudget: 10,
      inputBudgetTokens: 10,
      policy: resolveContextCompactionPolicy(undefined),
      mustKeepPolicy: DEFAULT_MUST_KEEP_POLICY,
      estimateTokens,
    });

    expect(candidate).toBeDefined();
    expect(candidate?.plan.replacedMessageIds).toEqual([
      'assistant_one',
      'output_one_0',
      'output_one_1',
      'assistant_two',
      'output_two_0',
    ]);
    expect(candidate?.plan.keptToolGroupCount).toBe(2);
    expect(candidate?.plan.replacedToolGroupCount).toBe(2);
    expect(candidate?.plan.sourceMessageIds).toEqual(messages.map(value => value.id));
  });

  it('合并 history_summary 已持久化的替换闭包与当前派生消息来源', () => {
    const summary = message({
      id: 'summary_old',
      role: 'system',
      type: 'history_summary',
      timestamp: 3,
      metadata: {
        messageType: 'summary',
        originalMessageCount: 2,
        includedOldSummary: false,
        replacedMessageIds: ['original_a', 'origin_root', 'original_b'],
        summarySeq: 3,
      },
    });
    const compressed = message({
      id: 'compressed_tool',
      role: 'assistant',
      type: 'final_answer',
      timestamp: 4,
      metadata: { replacementSourceIds: ['tool_call_old', 'tool_output_old'] },
    });
    const candidate = selectContextCompactionCandidate({
      messages: [
        message({ id: 'system', role: 'system', type: 'system_prompt', timestamp: 1 }),
        summary,
        compressed,
        message({ id: 'user', role: 'user', type: 'user_input', timestamp: 5 }),
      ],
      totalBudget: 100,
      inputBudgetTokens: 100,
      policy: resolveContextCompactionPolicy(undefined),
      mustKeepPolicy: DEFAULT_MUST_KEEP_POLICY,
      estimateTokens,
    });

    expect(candidate?.plan.replacedMessageIds).toEqual([
      'summary_old',
      'original_a',
      'origin_root',
      'original_b',
      'compressed_tool',
      'tool_call_old',
      'tool_output_old',
    ]);
    expect(candidate?.plan.nextSummarySeq).toBe(4);
    expect(candidate?.plan.sourceMessageIds).toEqual([
      'system',
      'summary_old',
      'compressed_tool',
      'user',
    ]);
  });

  it('不会跨过 must-keep fence 拼出离散替换区段', () => {
    const candidate = selectContextCompactionCandidate({
      messages: [
        message({ id: 'system', role: 'system', type: 'system_prompt', timestamp: 1 }),
        message({ id: 'user', role: 'user', type: 'user_input', timestamp: 2 }),
        ...toolGroup('before_fence', 10),
        message({
          id: 'approval-fence',
          role: 'system',
          type: 'context_injection',
          timestamp: 20,
          metadata: { fenceKind: 'approval' },
        }),
        ...toolGroup('after_fence', 30),
      ],
      totalBudget: 10,
      inputBudgetTokens: 10,
      policy: resolveContextCompactionPolicy({ keepLatestToolGroups: 0 }),
      mustKeepPolicy: {
        ...DEFAULT_MUST_KEEP_POLICY,
        alwaysKeepFenceKinds: ['approval'],
      },
      estimateTokens,
    });

    expect(candidate?.plan.replacedMessageIds).toEqual([
      'assistant_before_fence',
      'output_before_fence_0',
    ]);
    expect(candidate?.plan.replaceableRangeExhausted).toBe(true);
  });

  it('工具调用与输出之间存在 must-keep fence 时，不把该完整组选入压缩', () => {
    const crossingGroup = toolGroup('crossing_fence', 10);
    const laterGroup = toolGroup('later', 30);
    const candidate = selectContextCompactionCandidate({
      messages: [
        message({ id: 'system', role: 'system', type: 'system_prompt', timestamp: 1 }),
        message({ id: 'user', role: 'user', type: 'user_input', timestamp: 2 }),
        crossingGroup[0],
        message({
          id: 'approval-fence',
          role: 'system',
          type: 'context_injection',
          timestamp: 11,
          metadata: { fenceKind: 'approval' },
        }),
        crossingGroup[1],
        ...laterGroup,
      ],
      totalBudget: 10,
      inputBudgetTokens: 10,
      policy: resolveContextCompactionPolicy({ keepLatestToolGroups: 0 }),
      mustKeepPolicy: {
        ...DEFAULT_MUST_KEEP_POLICY,
        alwaysKeepFenceKinds: ['approval'],
      },
      estimateTokens,
    });

    expect(candidate?.plan.replacedMessageIds).toEqual([
      'assistant_later',
      'output_later_0',
    ]);
    expect(candidate?.plan.replacedMessageIds).not.toContain('assistant_crossing_fence');
    expect(candidate?.plan.replacedMessageIds).not.toContain('output_crossing_fence_0');
  });

  it('不跨越未完成工具组，也不产生半组替换计划', () => {
    const complete = toolGroup('complete', 10);
    const incomplete = toolGroup('incomplete', 20).slice(0, 1);
    const later = toolGroup('later', 30);
    const candidate = selectContextCompactionCandidate({
      messages: [
        message({ id: 'system', role: 'system', type: 'system_prompt', timestamp: 1 }),
        message({ id: 'user', role: 'user', type: 'user_input', timestamp: 2 }),
        ...complete,
        ...incomplete,
        ...later,
      ],
      totalBudget: 10,
      inputBudgetTokens: 10,
      policy: resolveContextCompactionPolicy({ keepLatestToolGroups: 0 }),
      mustKeepPolicy: DEFAULT_MUST_KEEP_POLICY,
      estimateTokens,
    });

    expect(candidate?.plan.replacedMessageIds).toEqual([
      'assistant_complete',
      'output_complete_0',
    ]);
    expect(candidate?.plan.replacedMessageIds.some(id => id.includes('incomplete'))).toBe(false);
    expect(candidate?.plan.replacedMessageIds.some(id => id.includes('later'))).toBe(false);
  });

  it('相同替换范围生成稳定 fingerprint', () => {
    const messages = [
      message({ id: 'system', role: 'system', type: 'system_prompt', timestamp: 1 }),
      message({ id: 'user', role: 'user', type: 'user_input', timestamp: 2 }),
      ...toolGroup('one', 10),
      ...toolGroup('two', 20),
      ...toolGroup('three', 30),
    ];
    const input = {
      messages,
      totalBudget: 10,
      inputBudgetTokens: 10,
      policy: resolveContextCompactionPolicy(undefined),
      mustKeepPolicy: DEFAULT_MUST_KEEP_POLICY,
      estimateTokens,
    };

    expect(selectContextCompactionCandidate(input)?.plan.fingerprint).toBe(
      selectContextCompactionCandidate(input)?.plan.fingerprint,
    );
  });

  it('把工具定义的固定成本纳入目标水位计划', () => {
    const candidate = selectContextCompactionCandidate({
      messages: [
        message({ id: 'system', role: 'system', type: 'system_prompt', timestamp: 1 }),
        message({ id: 'user', role: 'user', type: 'user_input', timestamp: 2 }),
        ...toolGroup('one', 10),
        ...toolGroup('two', 20),
        ...toolGroup('three', 30),
      ],
      // 消息可用 60 token、工具定义占 40 token。目标是完整 Prompt 的 50%。
      totalBudget: 60,
      inputBudgetTokens: 100,
      policy: resolveContextCompactionPolicy({
        keepLatestToolGroups: 0,
        maxOutputTokens: 1,
      }),
      mustKeepPolicy: DEFAULT_MUST_KEEP_POLICY,
      estimateTokens: value => {
        if (value.type === 'tool_calls') return 7;
        if (value.type === 'tool_output') return 8;
        return 2;
      },
    });

    expect(candidate?.plan.replacedToolGroupCount).toBe(3);
    expect(candidate?.plan.replacedTokenEstimate).toBe(45);
  });

  it('只从 materialized Prompt 选择候选，并用来源历史展开替换闭包与摘要序号', () => {
    const system = message({
      id: 'system',
      role: 'system',
      type: 'system_prompt',
      timestamp: 1,
    });
    const hiddenSummary = message({
      id: 'hidden-summary',
      role: 'system',
      type: 'history_summary',
      timestamp: 2,
      metadata: {
        messageType: 'summary',
        originalMessageCount: 2,
        includedOldSummary: false,
        replacedMessageIds: ['already-replaced'],
        summarySeq: 7,
      },
    });
    const rawToolGroup = toolGroup('raw-source', 10);
    const materializedToolSummary = message({
      id: 'visible-derived',
      role: 'assistant',
      type: 'final_answer',
      content: 'VISIBLE TOOL SUMMARY',
      timestamp: 20,
      metadata: {
        replacementSourceIds: rawToolGroup.map(value => value.id),
      },
    });
    const currentUser = message({
      id: 'current-user',
      role: 'user',
      type: 'user_input',
      timestamp: 30,
    });

    const candidate = selectContextCompactionCandidate({
      messages: [system, materializedToolSummary, currentUser],
      replacementSourceMessages: [
        system,
        hiddenSummary,
        message({
          id: 'omitted-old-message',
          role: 'assistant',
          type: 'final_answer',
          content: 'X'.repeat(1_000),
          timestamp: 3,
        }),
        ...rawToolGroup,
        materializedToolSummary,
        currentUser,
      ],
      totalBudget: 10,
      inputBudgetTokens: 10,
      policy: resolveContextCompactionPolicy({
        keepLatestToolGroups: 0,
        maxOutputTokens: 1,
      }),
      mustKeepPolicy: DEFAULT_MUST_KEEP_POLICY,
      estimateTokens,
    });

    expect(candidate?.plan.replacedMessageIds).toEqual([
      'visible-derived',
      'assistant_raw-source',
      'output_raw-source_0',
    ]);
    expect(candidate?.plan.replacedMessageIds).not.toContain('omitted-old-message');
    expect(candidate?.plan.replacedMessageIds).not.toContain('hidden-summary');
    expect(candidate?.plan.nextSummarySeq).toBe(8);
  });

  it('跨 must-keep 边界选择新段时仍吞掉上一代摘要，净化后旧来源不会复活', async () => {
    const system = message({
      id: 'system',
      role: 'system',
      type: 'system_prompt',
      timestamp: 1,
    });
    const oldSources = [
      message({ id: 'old-source-a', role: 'assistant', type: 'final_answer', timestamp: 2 }),
      message({ id: 'old-source-b', role: 'assistant', type: 'final_answer', timestamp: 3 }),
    ];
    const oldSummary = message({
      id: 'summary-old',
      role: 'system',
      type: 'history_summary',
      timestamp: 4,
      metadata: {
        messageType: 'summary',
        originalMessageCount: 2,
        includedOldSummary: false,
        replacedMessageIds: oldSources.map(value => value.id),
        summarySeq: 3,
      },
    });
    const currentUser = message({
      id: 'current-user',
      role: 'user',
      type: 'user_input',
      timestamp: 5,
    });
    const approvalFence = message({
      id: 'approval-fence',
      role: 'system',
      type: 'context_injection',
      timestamp: 6,
      metadata: { fenceKind: 'approval' },
    });
    const recentTools = [...toolGroup('one', 10), ...toolGroup('two', 20)];
    const materializedMessages = [
      system,
      oldSummary,
      currentUser,
      approvalFence,
      ...recentTools,
    ];
    const candidate = selectContextCompactionCandidate({
      messages: materializedMessages,
      replacementSourceMessages: [
        system,
        ...oldSources,
        oldSummary,
        currentUser,
        approvalFence,
        ...recentTools,
      ],
      totalBudget: 100,
      inputBudgetTokens: 100,
      policy: resolveContextCompactionPolicy({
        keepLatestToolGroups: 0,
        maxOutputTokens: 1,
      }),
      mustKeepPolicy: {
        ...DEFAULT_MUST_KEEP_POLICY,
        alwaysKeepFenceKinds: ['approval'],
      },
      estimateTokens: value => {
        if (value.id === oldSummary.id) return 2;
        if (recentTools.some(toolMessage => toolMessage.id === value.id)) return 50;
        return 1;
      },
    });

    expect(candidate).toBeDefined();
    if (!candidate) return;
    expect(candidate.plan.includedOldSummary).toBe(true);
    expect(candidate.plan.originalMessageCount).toBe(5);
    expect(candidate.plan.replacedTokenEstimate).toBe(202);
    expect(candidate.plan.replacedMessageIds).toEqual([
      'summary-old',
      'old-source-a',
      'old-source-b',
      'assistant_one',
      'output_one_0',
      'assistant_two',
      'output_two_0',
    ]);

    const draft = createHistorySummaryDraft({
      id: 'summary-new',
      conversationId: 'conversation-1',
      turnId: 'turn-1',
      timestamp: 30,
      checkpointContent: validCheckpoint(),
      plan: candidate.plan,
      estimateTokens: () => 10,
    });
    expect(draft.kind).toBe('ready');
    if (draft.kind !== 'ready') return;

    const purified = await new HistoryPurificationPreprocessor().process(
      [
        system,
        ...oldSources,
        oldSummary,
        currentUser,
        approvalFence,
        ...recentTools,
        draft.message,
      ],
      {},
    );
    const remainingIds = purified.messages.map(value => value.id);
    expect(remainingIds).toEqual([
      'system',
      'current-user',
      'approval-fence',
      'summary-new',
    ]);
  });

  it('附件消息不可替换，但 source 仍覆盖完整 Prompt', () => {
    const image: RuntimeResourceRef = {
      id: 'attachment-current',
      kind: 'image',
      resourceId: 'asset-current',
      mediaType: 'image/png',
      byteLength: 128,
      width: 16,
      height: 8,
      sha256: 'a'.repeat(64),
    };
    const candidate = selectContextCompactionCandidate({
      messages: [
        message({ id: 'system', role: 'system', type: 'system_prompt', timestamp: 1 }),
        message({
          id: 'old-image-user',
          role: 'user',
          type: 'user_input',
          timestamp: 2,
          attachments: [{ ...image, id: 'attachment-old', resourceId: 'asset-old' }],
        }),
        message({ id: 'old-answer', role: 'assistant', type: 'final_answer', timestamp: 3 }),
        message({
          id: 'current-user',
          role: 'user',
          type: 'user_input',
          timestamp: 4,
          attachments: [image],
        }),
      ],
      totalBudget: 10,
      inputBudgetTokens: 10,
      policy: resolveContextCompactionPolicy({ maxOutputTokens: 1 }),
      mustKeepPolicy: DEFAULT_MUST_KEEP_POLICY,
      estimateTokens,
    });

    expect(candidate?.plan.replacedMessageIds).toEqual(['old-answer']);
    expect(candidate?.plan.sourceMessageIds).toEqual([
      'system',
      'old-image-user',
      'old-answer',
      'current-user',
    ]);
  });
});
