import { describe, expect, it } from 'vitest';
import { defineContextPolicy, type AiMessage, ToolCallIdSchema } from '../../../contracts';
import type { ContextTrace } from '../../../context-manager';
import { assertContextPolicyInvariants, validateContextPolicyInvariants } from '../invariants';
import { createMockTokenizerPort } from '../../mocks/tokenizerPort';

function systemMessage(id: string, content: string): AiMessage {
  const result = {
    id,
    role: 'system',
    type: 'system_prompt',
    content,
    timestamp: 1,
  } satisfies AiMessage;
  return result;
}

function userMessage(id: string, content: string): AiMessage {
  const result = {
    id,
    role: 'user',
    type: 'user_input',
    content,
    timestamp: 1,
  } satisfies AiMessage;
  return result;
}

function toolCallsMessage(id: string, toolCallId: string): AiMessage {
  const result = {
    id,
    role: 'assistant',
    type: 'tool_calls',
    content: '',
    timestamp: 1,
    metadata: {
      tool_calls: [
        {
          id: ToolCallIdSchema.parse(toolCallId),
          type: 'function',
          function: {
            name: 'search',
            arguments: '{}',
          },
        },
      ],
    },
  } satisfies AiMessage;
  return result;
}

function toolOutputMessage(id: string, toolCallId: string): AiMessage {
  const result = {
    id,
    role: 'tool',
    type: 'tool_output',
    content: 'result',
    timestamp: 1,
    metadata: {
      tool_call_id: ToolCallIdSchema.parse(toolCallId),
      tool_name: 'search',
    },
  } satisfies AiMessage;
  return result;
}

function createHealthyTrace(
  policy: ReturnType<typeof defineContextPolicy>,
  originalMessages: readonly AiMessage[],
  finalMessages: readonly AiMessage[]
): ContextTrace {
  return {
    enabled: true,
    includeMessageIds: true,
    includeTokenBreakdown: true,
    maxTraceEvents: 20,
    overflowed: false,
    effectivePolicy: policy,
    totalBudget: 100,
    originalCount: originalMessages.length,
    finalCount: finalMessages.length,
    finalTokens: 4,
    truncated: originalMessages.length !== finalMessages.length,
    events: [
      {
        kind: 'provider',
        providerName: 'AgentCoreContextProvider',
        skipped: false,
        durationMs: 1,
        beforeTokens: 0,
        afterTokens: 4,
        tokenDelta: 4,
        tokensUsed: 4,
        beforeKeptCount: 0,
        afterKeptCount: finalMessages.length,
        strategiesApplied: ['CORE_CONTEXT'],
        remainingBudget: 96,
      },
      ...originalMessages.map((item, index) => ({
        kind: 'message-decision' as const,
        originalIndex: index,
        messageId: item.id,
        role: item.role,
        type: item.type,
        action: 'keep_core' as const,
        phase: 'CORE_CONTEXT',
        tokens: 1,
        kept: true,
        reason: 'kept_by_CORE_CONTEXT',
      })),
    ],
  };
}

describe('context policy invariants', () => {
  it('通过 ContextTrace 验证 policy、预算、消息决策与工具配对都自洽', () => {
    const policy = defineContextPolicy({
      mustKeep: {
        alwaysKeepTypes: ['system_prompt', 'user_input'],
      },
      contextTrace: {
        enabled: true,
        includeMessageIds: true,
        includeTokenBreakdown: true,
        maxTraceEvents: 20,
      },
    });
    const originalMessages = [
      systemMessage('system-1', 'system'),
      userMessage('user-1', 'question'),
      toolCallsMessage('tool-calls-1', 'call-1'),
      toolOutputMessage('tool-output-1', 'call-1'),
    ];
    const trace = createHealthyTrace(policy, originalMessages, originalMessages);

    const report = validateContextPolicyInvariants({
      expectedPolicy: policy,
      trace,
      originalMessages,
      finalMessages: originalMessages,
    });

    expect(report.ok).toBe(true);
    expect(() => assertContextPolicyInvariants(report)).not.toThrow();
  });

  it('发现 contextTrace.enabled 与实际 trace 产出不一致', () => {
    const policy = defineContextPolicy();
    const messages = [userMessage('user-1', 'question')];
    const trace = createHealthyTrace(
      defineContextPolicy({ contextTrace: { enabled: true } }),
      messages,
      messages
    );

    const report = validateContextPolicyInvariants(
      {
        expectedPolicy: policy,
        trace,
        originalMessages: messages,
        finalMessages: messages,
      },
      {
        enabled: ['C1_TRACE_ENABLED_MATCHES_POLICY'],
      }
    );

    expect(report.failures).toEqual([
      expect.objectContaining({
        id: 'C1_TRACE_ENABLED_MATCHES_POLICY',
      }),
    ]);
  });

  it('发现 token 预算、provider delta 与 trace 细节开关错误', () => {
    const policy = defineContextPolicy({
      contextTrace: {
        enabled: true,
        includeMessageIds: false,
        includeTokenBreakdown: false,
        maxTraceEvents: 10,
      },
    });
    const messages = [userMessage('user-1', 'question')];
    const trace = createHealthyTrace(policy, messages, messages);
    trace.includeMessageIds = false;
    trace.includeTokenBreakdown = false;
    trace.totalBudget = 1;
    trace.finalTokens = 2;
    const providerEvent = trace.events.find(event => event.kind === 'provider');
    if (providerEvent?.kind === 'provider') {
      providerEvent.tokenDelta = 99;
    }

    const report = validateContextPolicyInvariants({
      expectedPolicy: policy,
      trace,
      originalMessages: messages,
      finalMessages: messages,
    });

    expect(report.failures.map(item => item.id)).toEqual(
      expect.arrayContaining([
        'C6_FINAL_TOKENS_WITHIN_BUDGET',
        'C7_PROVIDER_TOKEN_DELTA',
        'C8_TRACE_DETAIL_OPTIONS',
      ])
    );
  });

  it('发现 mustKeep 消息被丢弃以及 tool_calls / tool_output 保留决策被拆开', () => {
    const policy = defineContextPolicy({
      mustKeep: {
        alwaysKeepTypes: ['system_prompt'],
      },
      contextTrace: {
        enabled: true,
      },
    });
    const originalMessages = [
      systemMessage('system-1', 'system'),
      toolCallsMessage('tool-calls-1', 'call-1'),
      toolOutputMessage('tool-output-1', 'call-1'),
    ];
    const trace = createHealthyTrace(policy, originalMessages, originalMessages.slice(1));
    const decisions = trace.events.filter(event => event.kind === 'message-decision');
    const systemDecision = decisions.find(event => event.messageId === 'system-1');
    const toolOutputDecision = decisions.find(event => event.messageId === 'tool-output-1');
    if (systemDecision) {
      systemDecision.kept = false;
      systemDecision.reason = 'dropped_by_budget_or_priority';
    }
    if (toolOutputDecision) {
      toolOutputDecision.kept = false;
      toolOutputDecision.reason = 'dropped_by_budget_or_priority';
    }

    const report = validateContextPolicyInvariants({
      expectedPolicy: policy,
      trace,
      originalMessages,
      finalMessages: originalMessages.slice(1),
    });

    expect(report.failures.map(item => item.id)).toEqual(
      expect.arrayContaining(['C10_TOOL_PAIR_DECISIONS_STAY_TOGETHER', 'C11_MUST_KEEP_TYPES_KEPT'])
    );
  });

  it('C12 校验 host 注入 tokenizer 后预算决策使用 host tokenizer', () => {
    const policy = defineContextPolicy({
      contextTrace: {
        enabled: true,
        includeTokenBreakdown: true,
      },
    });
    const messages = [systemMessage('system-1', 'system'), userMessage('user-1', 'question')];
    const trace = createHealthyTrace(policy, messages, messages);
    trace.finalTokens = 2;
    const providerEvent = trace.events.find(event => event.kind === 'provider');
    if (providerEvent?.kind === 'provider') {
      providerEvent.afterTokens = 2;
      providerEvent.tokenDelta = 2;
      providerEvent.tokensUsed = 2;
      providerEvent.remainingBudget = 98;
    }
    const tokenizer = createMockTokenizerPort({ tokensPerMessage: 1 });

    const report = validateContextPolicyInvariants(
      {
        expectedPolicy: policy,
        trace,
        originalMessages: messages,
        finalMessages: messages,
        tokenizer,
        tokenizerModelId: 'mock-model',
      },
      {
        enabled: ['C12_HOST_TOKENIZER_DRIVES_BUDGET'],
      }
    );

    expect(report.ok).toBe(true);
  });

  it('C12 发现 trace token 明细没有使用 host tokenizer', () => {
    const policy = defineContextPolicy({
      contextTrace: {
        enabled: true,
        includeTokenBreakdown: true,
      },
    });
    const messages = [userMessage('user-1', 'question')];
    const trace = createHealthyTrace(policy, messages, messages);
    const tokenizer = createMockTokenizerPort({ tokensPerMessage: 10 });

    const report = validateContextPolicyInvariants(
      {
        expectedPolicy: policy,
        trace,
        originalMessages: messages,
        finalMessages: messages,
        tokenizer,
      },
      {
        enabled: ['C12_HOST_TOKENIZER_DRIVES_BUDGET'],
      }
    );

    expect(report.failures).toEqual([
      expect.objectContaining({
        id: 'C12_HOST_TOKENIZER_DRIVES_BUDGET',
        title: 'message-decision tokens 未使用 host tokenizer',
      }),
      expect.objectContaining({
        id: 'C12_HOST_TOKENIZER_DRIVES_BUDGET',
        title: 'finalTokens 未使用 host tokenizer',
      }),
    ]);
  });
});
