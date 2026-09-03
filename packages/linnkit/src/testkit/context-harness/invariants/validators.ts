import type { AgentSpecContextTracePolicy } from '../../../contracts';
import {
  decisionsByMessageId,
  failure,
  messageDecisionEvents,
  providerEvents,
  stableJson,
  toolCallIds,
  toolOutputCallId,
} from './helpers';
import type {
  ContextPolicyInvariantContext,
  ContextPolicyInvariantFailure,
  ContextPolicyInvariantValidator,
} from './types';

function tracePolicy(context: ContextPolicyInvariantContext): AgentSpecContextTracePolicy | undefined {
  return context.trace?.effectivePolicy?.contextTrace ?? context.expectedPolicy?.contextTrace;
}

export const validateC1TraceEnabledMatchesPolicy: ContextPolicyInvariantValidator = (context) => {
  const enabled = context.expectedPolicy?.contextTrace?.enabled === true;
  if (enabled && !context.trace) {
    return [failure(
      'C1_TRACE_ENABLED_MATCHES_POLICY',
      'ContextTrace 未产出',
      'contextPolicy.contextTrace.enabled=true，但本次构建没有 contextTrace',
    )];
  }
  if (!enabled && context.trace) {
    return [failure(
      'C1_TRACE_ENABLED_MATCHES_POLICY',
      'ContextTrace 意外产出',
      'contextPolicy.contextTrace.enabled 未开启，但本次构建产出了 contextTrace',
    )];
  }
  return [];
};

export const validateC2EffectivePolicyMatchesExpected: ContextPolicyInvariantValidator = (context) => {
  if (!context.trace || !context.expectedPolicy) {
    return [];
  }
  if (!context.trace.effectivePolicy) {
    return [failure(
      'C2_EFFECTIVE_POLICY_MATCHES_EXPECTED',
      'trace 缺 effectivePolicy',
      'ContextTrace 必须记录最终生效的 contextPolicy，方便外部接入方定位 fallback / agent 覆盖关系',
    )];
  }
  if (stableJson(context.trace.effectivePolicy) !== stableJson(context.expectedPolicy)) {
    return [failure(
      'C2_EFFECTIVE_POLICY_MATCHES_EXPECTED',
      'effectivePolicy 与期望不一致',
      'ContextTrace.effectivePolicy 必须等于本次实际用于构建上下文的 policy',
      { expectedPolicy: context.expectedPolicy, effectivePolicy: context.trace.effectivePolicy },
    )];
  }
  return [];
};

export const validateC3TraceOptionsMatchPolicy: ContextPolicyInvariantValidator = (context) => {
  if (!context.trace) {
    return [];
  }
  const policy = tracePolicy(context);
  if (!policy) {
    return [];
  }

  const failures: ContextPolicyInvariantFailure[] = [];
  if (policy.includeMessageIds !== undefined && context.trace.includeMessageIds !== policy.includeMessageIds) {
    failures.push(failure(
      'C3_TRACE_OPTIONS_MATCH_POLICY',
      'includeMessageIds 未生效',
      `trace.includeMessageIds=${context.trace.includeMessageIds}，policy.includeMessageIds=${policy.includeMessageIds}`,
    ));
  }
  if (policy.includeTokenBreakdown !== undefined && context.trace.includeTokenBreakdown !== policy.includeTokenBreakdown) {
    failures.push(failure(
      'C3_TRACE_OPTIONS_MATCH_POLICY',
      'includeTokenBreakdown 未生效',
      `trace.includeTokenBreakdown=${context.trace.includeTokenBreakdown}，policy.includeTokenBreakdown=${policy.includeTokenBreakdown}`,
    ));
  }
  if (policy.maxTraceEvents !== undefined && context.trace.maxTraceEvents !== policy.maxTraceEvents) {
    failures.push(failure(
      'C3_TRACE_OPTIONS_MATCH_POLICY',
      'maxTraceEvents 未生效',
      `trace.maxTraceEvents=${context.trace.maxTraceEvents}，policy.maxTraceEvents=${policy.maxTraceEvents}`,
    ));
  }
  return failures;
};

export const validateC4TraceEventLimit: ContextPolicyInvariantValidator = (context) => {
  if (!context.trace) {
    return [];
  }
  if (context.trace.events.length > context.trace.maxTraceEvents) {
    return [failure(
      'C4_TRACE_EVENT_LIMIT',
      'ContextTrace 事件超过上限',
      `events.length=${context.trace.events.length}，maxTraceEvents=${context.trace.maxTraceEvents}`,
    )];
  }
  if (context.trace.overflowed && context.trace.events.length !== context.trace.maxTraceEvents) {
    return [failure(
      'C4_TRACE_EVENT_LIMIT',
      'ContextTrace overflow 标记不一致',
      'overflowed=true 时，事件数量应该正好等于 maxTraceEvents',
      { eventsLength: context.trace.events.length, maxTraceEvents: context.trace.maxTraceEvents },
    )];
  }
  return [];
};

export const validateC5FinalCountsMatchMessages: ContextPolicyInvariantValidator = (context) => {
  if (!context.trace) {
    return [];
  }
  const failures: ContextPolicyInvariantFailure[] = [];
  if (context.originalMessages && context.trace.originalCount !== context.originalMessages.length) {
    failures.push(failure(
      'C5_FINAL_COUNTS_MATCH_MESSAGES',
      'originalCount 与原始消息数不一致',
      `trace.originalCount=${context.trace.originalCount}，originalMessages.length=${context.originalMessages.length}`,
    ));
  }
  if (context.finalMessages && context.trace.finalCount !== context.finalMessages.length) {
    failures.push(failure(
      'C5_FINAL_COUNTS_MATCH_MESSAGES',
      'finalCount 与最终消息数不一致',
      `trace.finalCount=${context.trace.finalCount}，finalMessages.length=${context.finalMessages.length}`,
    ));
  }
  return failures;
};

export const validateC6FinalTokensWithinBudget: ContextPolicyInvariantValidator = (context) => {
  if (!context.trace) {
    return [];
  }
  if (context.trace.finalTokens < 0 || context.trace.totalBudget < 0) {
    return [failure(
      'C6_FINAL_TOKENS_WITHIN_BUDGET',
      'token 计数出现负数',
      `finalTokens=${context.trace.finalTokens}，totalBudget=${context.trace.totalBudget}`,
    )];
  }
  if (context.trace.finalTokens > context.trace.totalBudget) {
    return [failure(
      'C6_FINAL_TOKENS_WITHIN_BUDGET',
      '最终上下文超过预算',
      `finalTokens=${context.trace.finalTokens} > totalBudget=${context.trace.totalBudget}`,
    )];
  }
  return [];
};

export const validateC7ProviderTokenDelta: ContextPolicyInvariantValidator = (context) => {
  if (!context.trace) {
    return [];
  }
  return providerEvents(context.trace)
    .filter((event) => event.tokenDelta !== event.afterTokens - event.beforeTokens)
    .map((event) => failure(
      'C7_PROVIDER_TOKEN_DELTA',
      'provider tokenDelta 不自洽',
      `${event.providerName} tokenDelta=${event.tokenDelta}，但 after-before=${event.afterTokens - event.beforeTokens}`,
      { event },
    ));
};

export const validateC8TraceDetailOptions: ContextPolicyInvariantValidator = (context) => {
  if (!context.trace) {
    return [];
  }

  const failures: ContextPolicyInvariantFailure[] = [];
  if (!context.trace.includeMessageIds) {
    for (const event of messageDecisionEvents(context.trace)) {
      if (event.messageId !== undefined) {
        failures.push(failure(
          'C8_TRACE_DETAIL_OPTIONS',
          'includeMessageIds=false 但泄露了 messageId',
          `originalIndex=${event.originalIndex} 仍包含 messageId`,
          { event },
        ));
      }
    }
  }

  if (!context.trace.includeTokenBreakdown) {
    for (const event of messageDecisionEvents(context.trace)) {
      if (event.tokens !== 0) {
        failures.push(failure(
          'C8_TRACE_DETAIL_OPTIONS',
          'includeTokenBreakdown=false 但 message-decision 仍包含 token',
          `originalIndex=${event.originalIndex} tokens=${event.tokens}`,
          { event },
        ));
      }
    }
    for (const event of providerEvents(context.trace)) {
      const tokenValues = [event.beforeTokens, event.afterTokens, event.tokenDelta, event.tokensUsed];
      if (tokenValues.some((value) => value !== 0)) {
        failures.push(failure(
          'C8_TRACE_DETAIL_OPTIONS',
          'includeTokenBreakdown=false 但 provider 仍包含 token 明细',
          `${event.providerName} token fields must be zero`,
          { event },
        ));
      }
    }
  }
  return failures;
};

export const validateC9MessageDecisionReason: ContextPolicyInvariantValidator = (context) => {
  if (!context.trace) {
    return [];
  }
  return messageDecisionEvents(context.trace)
    .filter((event) => {
      return event.kept
        ? !event.reason.startsWith('kept_by_')
        : !event.reason.startsWith('dropped_by_');
    })
    .map((event) => failure(
      'C9_MESSAGE_DECISION_REASON',
      'message-decision reason 与 kept 状态不一致',
      `message ${event.messageId ?? event.originalIndex} kept=${event.kept} reason=${event.reason}`,
      { event },
    ));
};

export const validateC10ToolPairDecisionsStayTogether: ContextPolicyInvariantValidator = (context) => {
  if (!context.trace || !context.originalMessages || context.trace.overflowed || !context.trace.includeMessageIds) {
    return [];
  }
  const decisions = decisionsByMessageId(context.trace);
  const outputMessageIdByCallId = new Map<string, string>();
  for (const message of context.originalMessages) {
    const callId = toolOutputCallId(message);
    if (callId) {
      outputMessageIdByCallId.set(callId, message.id);
    }
  }

  const failures: ContextPolicyInvariantFailure[] = [];
  for (const message of context.originalMessages) {
    const callDecision = decisions.get(message.id);
    if (!callDecision) {
      continue;
    }
    for (const callId of toolCallIds(message)) {
      const outputMessageId = outputMessageIdByCallId.get(callId);
      const outputDecision = outputMessageId ? decisions.get(outputMessageId) : undefined;
      if (!outputDecision) {
        continue;
      }
      if (callDecision.kept !== outputDecision.kept) {
        failures.push(failure(
          'C10_TOOL_PAIR_DECISIONS_STAY_TOGETHER',
          'tool_calls / tool_output 保留决策不一致',
          `tool_call_id=${callId} 的 tool_calls kept=${callDecision.kept}，tool_output kept=${outputDecision.kept}`,
          { callId, toolCallsMessageId: message.id, toolOutputMessageId: outputMessageId },
        ));
      }
    }
  }
  return failures;
};

export const validateC11MustKeepTypesKept: ContextPolicyInvariantValidator = (context) => {
  if (!context.trace || !context.originalMessages || context.trace.overflowed || !context.trace.includeMessageIds) {
    return [];
  }
  const mustKeepTypes = new Set<string>(context.expectedPolicy?.mustKeep?.alwaysKeepTypes ?? []);
  if (mustKeepTypes.size === 0) {
    return [];
  }

  const decisions = decisionsByMessageId(context.trace);
  return context.originalMessages
    .filter((message) => mustKeepTypes.has(message.type))
    .filter((message) => decisions.get(message.id)?.kept !== true)
    .map((message) => failure(
      'C11_MUST_KEEP_TYPES_KEPT',
      'mustKeep 类型消息未保留',
      `message ${message.id} type=${message.type} 被 mustKeep 声明但 trace 中没有 kept=true 决策`,
      { messageId: message.id, messageType: message.type },
    ));
};

export const validateC12HostTokenizerDrivesBudget: ContextPolicyInvariantValidator = (context) => {
  if (!context.tokenizer || !context.trace || !context.trace.includeTokenBreakdown || context.trace.overflowed) {
    return [];
  }
  const tokenizer = context.tokenizer;

  if (!context.originalMessages) {
    return [failure(
      'C12_HOST_TOKENIZER_DRIVES_BUDGET',
      '缺少原始消息，无法校验 host tokenizer',
      '传入 tokenizer 后，C12 需要 originalMessages 才能核对每条 message-decision.tokens 是否来自 host tokenizer',
    )];
  }

  const failures: ContextPolicyInvariantFailure[] = [];
  const messagesByOriginalIndex = new Map<number, typeof context.originalMessages[number]>();
  context.originalMessages.forEach((message, index) => {
    messagesByOriginalIndex.set(index, message);
  });

  for (const event of messageDecisionEvents(context.trace)) {
    const message = messagesByOriginalIndex.get(event.originalIndex);
    if (!message) {
      failures.push(failure(
        'C12_HOST_TOKENIZER_DRIVES_BUDGET',
        'message-decision 找不到原始消息',
        `originalIndex=${event.originalIndex} 不在 originalMessages 范围内`,
        { event },
      ));
      continue;
    }

    const expectedTokens = tokenizer.estimateMessage(message, context.tokenizerModelId);
    if (event.tokens !== expectedTokens) {
      failures.push(failure(
        'C12_HOST_TOKENIZER_DRIVES_BUDGET',
        'message-decision tokens 未使用 host tokenizer',
        `message ${event.messageId ?? event.originalIndex} tokens=${event.tokens}，host tokenizer 估算=${expectedTokens}`,
        {
          originalIndex: event.originalIndex,
          messageId: event.messageId,
          actualTokens: event.tokens,
          expectedTokens,
          modelId: context.tokenizerModelId,
        },
      ));
    }
  }

  if (context.finalMessages) {
    const expectedFinalTokens = context.finalMessages.reduce((sum, message) => {
      return sum + tokenizer.estimateMessage(message, context.tokenizerModelId);
    }, 0);
    if (context.trace.finalTokens !== expectedFinalTokens) {
      failures.push(failure(
        'C12_HOST_TOKENIZER_DRIVES_BUDGET',
        'finalTokens 未使用 host tokenizer',
        `trace.finalTokens=${context.trace.finalTokens}，host tokenizer 对 finalMessages 的总估算=${expectedFinalTokens}`,
        {
          actualFinalTokens: context.trace.finalTokens,
          expectedFinalTokens,
          modelId: context.tokenizerModelId,
        },
      ));
    }
  }

  return failures;
};
