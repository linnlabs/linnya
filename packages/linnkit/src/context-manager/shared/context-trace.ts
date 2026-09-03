import type {
  AgentSpecContextPolicy,
  AgentSpecContextTracePolicy,
  AiMessage,
  ContextTokenComponent,
  TokenUsageCalibrationTrace,
} from '../../contracts';
import type { MessageProcessingState, RemoteTokenCountTrace } from './providers/base';

export type ContextTraceEvent =
  | ContextTraceProviderEvent
  | ContextTraceMessageDecisionEvent;

export interface ContextTraceProviderEvent {
  kind: 'provider';
  providerName: string;
  skipped: boolean;
  durationMs: number;
  beforeTokens: number;
  afterTokens: number;
  tokenDelta: number;
  tokensUsed: number;
  beforeKeptCount: number;
  afterKeptCount: number;
  strategiesApplied: string[];
  remainingBudget: number;
}

export interface ContextTraceMessageDecisionEvent {
  kind: 'message-decision';
  originalIndex: number;
  messageId?: string;
  role: AiMessage['role'];
  type: AiMessage['type'];
  action: MessageProcessingState['action'];
  phase?: string;
  tokens: number;
  kept: boolean;
  reason: string;
  replacementSourceIds?: string[];
  tokenCalibration?: TokenUsageCalibrationTrace;
}

export interface ContextTrace {
  enabled: true;
  includeMessageIds: boolean;
  includeTokenBreakdown: boolean;
  maxTraceEvents: number;
  overflowed: boolean;
  effectivePolicy?: AgentSpecContextPolicy;
  totalBudget: number;
  originalCount: number;
  finalCount: number;
  finalTokens: number;
  tokenLedgerEntryIds?: string[];
  tokenComponents?: ContextTokenComponent[];
  tokenCalibration?: TokenUsageCalibrationTrace;
  remoteTokenCount?: RemoteTokenCountTrace;
  truncated: boolean;
  events: ContextTraceEvent[];
}

interface ContextTraceCollectorOptions {
  policy?: AgentSpecContextTracePolicy;
  effectivePolicy?: AgentSpecContextPolicy;
  totalBudget: number;
  originalCount: number;
  tokenCalibration?: TokenUsageCalibrationTrace;
  remoteTokenCount?: RemoteTokenCountTrace;
}

interface ProviderSnapshot {
  tokens: number;
  keptCount: number;
}

interface ProviderTraceInput {
  providerName: string;
  skipped: boolean;
  durationMs: number;
  beforeStates: ReadonlyArray<MessageProcessingState>;
  afterStates: ReadonlyArray<MessageProcessingState>;
  tokensUsed: number;
  strategiesApplied: readonly string[];
  remainingBudget: number;
}

/**
 * ContextTrace 的最小采集器。
 *
 * 中文备注：
 * - trace 只描述“本次上下文构建如何选择消息”，不进入 LLM 输入；
 * - 采集器内部做 maxTraceEvents 限流，避免观测数据反过来膨胀。
 */
export class ContextTraceCollector {
  private readonly includeMessageIds: boolean;
  private readonly includeTokenBreakdown: boolean;
  private readonly maxTraceEvents: number;
  private readonly effectivePolicy?: AgentSpecContextPolicy;
  private readonly totalBudget: number;
  private readonly originalCount: number;
  private readonly tokenCalibration?: TokenUsageCalibrationTrace;
  private remoteTokenCount?: RemoteTokenCountTrace;
  private tokenComponents?: ContextTokenComponent[];
  private readonly events: ContextTraceEvent[] = [];
  private overflowed = false;

  private constructor(options: Required<Pick<ContextTraceCollectorOptions, 'totalBudget' | 'originalCount'>> & {
    policy?: AgentSpecContextTracePolicy;
    effectivePolicy?: AgentSpecContextPolicy;
    tokenCalibration?: TokenUsageCalibrationTrace;
    remoteTokenCount?: RemoteTokenCountTrace;
  }) {
    this.includeMessageIds = options.policy?.includeMessageIds ?? true;
    this.includeTokenBreakdown = options.policy?.includeTokenBreakdown ?? true;
    this.maxTraceEvents = options.policy?.maxTraceEvents ?? 200;
    this.effectivePolicy = options.effectivePolicy;
    this.totalBudget = options.totalBudget;
    this.originalCount = options.originalCount;
    this.tokenCalibration = options.tokenCalibration;
    this.remoteTokenCount = options.remoteTokenCount;
  }

  static create(options: ContextTraceCollectorOptions): ContextTraceCollector | undefined {
    if (options.policy?.enabled !== true) {
      return undefined;
    }
    return new ContextTraceCollector(options);
  }

  recordProvider(input: ProviderTraceInput): void {
    const before = snapshotStates(input.beforeStates);
    const after = snapshotStates(input.afterStates);
    this.push({
      kind: 'provider',
      providerName: input.providerName,
      skipped: input.skipped,
      durationMs: input.durationMs,
      beforeTokens: this.includeTokenBreakdown ? before.tokens : 0,
      afterTokens: this.includeTokenBreakdown ? after.tokens : 0,
      tokenDelta: this.includeTokenBreakdown ? after.tokens - before.tokens : 0,
      tokensUsed: this.includeTokenBreakdown ? input.tokensUsed : 0,
      beforeKeptCount: before.keptCount,
      afterKeptCount: after.keptCount,
      strategiesApplied: [...input.strategiesApplied],
      remainingBudget: input.remainingBudget,
    });
  }

  recordMessageDecisions(states: ReadonlyArray<MessageProcessingState>): void {
    for (const state of states) {
      const kept = state.action.startsWith('keep_');
      this.push({
        kind: 'message-decision',
        originalIndex: state.originalIndex,
        ...(this.includeMessageIds ? { messageId: state.message.id } : {}),
        role: state.message.role,
        type: state.message.type,
        action: state.action,
        ...(state.phase ? { phase: state.phase } : {}),
        tokens: this.includeTokenBreakdown ? state.tokens : 0,
        kept,
        reason: buildDecisionReason(state, kept),
        ...(state.replacementSourceIds ? { replacementSourceIds: [...state.replacementSourceIds] } : {}),
        ...(this.includeTokenBreakdown && state.tokenCalibration ? { tokenCalibration: state.tokenCalibration } : {}),
      });
    }
  }

  recordRemoteTokenCount(trace: RemoteTokenCountTrace): void {
    this.remoteTokenCount = trace;
  }

  recordTokenComponents(components: ReadonlyArray<ContextTokenComponent>): void {
    if (!this.includeTokenBreakdown) {
      return;
    }
    this.tokenComponents = [...components];
  }

  build(finalMessages: ReadonlyArray<AiMessage>, finalTokens: number): ContextTrace {
    return {
      enabled: true,
      includeMessageIds: this.includeMessageIds,
      includeTokenBreakdown: this.includeTokenBreakdown,
      maxTraceEvents: this.maxTraceEvents,
      overflowed: this.overflowed,
      ...(this.effectivePolicy ? { effectivePolicy: this.effectivePolicy } : {}),
      totalBudget: this.totalBudget,
      originalCount: this.originalCount,
      finalCount: finalMessages.length,
      finalTokens,
      ...(this.tokenCalibration ? { tokenCalibration: this.tokenCalibration } : {}),
      ...(this.remoteTokenCount ? { remoteTokenCount: this.remoteTokenCount } : {}),
      ...(this.tokenComponents ? { tokenComponents: [...this.tokenComponents] } : {}),
      truncated: this.originalCount !== finalMessages.length,
      events: [...this.events],
    };
  }

  private push(event: ContextTraceEvent): void {
    if (this.events.length >= this.maxTraceEvents) {
      this.overflowed = true;
      return;
    }
    this.events.push(event);
  }
}

function snapshotStates(states: ReadonlyArray<MessageProcessingState>): ProviderSnapshot {
  return states.reduce<ProviderSnapshot>(
    (acc, state) => {
      if (state.action.startsWith('keep_')) {
        acc.tokens += state.tokens;
        acc.keptCount += 1;
      }
      return acc;
    },
    { tokens: 0, keptCount: 0 },
  );
}

function buildDecisionReason(state: MessageProcessingState, kept: boolean): string {
  if (kept) {
    return state.phase ? `kept_by_${state.phase}` : `kept_by_${state.action}`;
  }
  if (state.phase) {
    return `dropped_by_${state.phase}`;
  }
  return 'dropped_by_budget_or_priority';
}
