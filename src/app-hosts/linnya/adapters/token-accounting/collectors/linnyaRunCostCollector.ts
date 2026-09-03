import { tokenAccounting } from '@linnlabs/linnkit/runtime-kernel';
import type { runSupervisor, telemetry } from '@linnlabs/linnkit/runtime-kernel';
import type {
  CanonicalLlmUsage,
  ContextComponentTokenLedgerEntry,
  LlmUsageTokenLedgerEntry,
  RunTokenUsageAggregate,
  TokenLedgerAggregate,
  TokenLedgerEntry,
  TokenPricing,
  TokenRoute,
} from '@linnlabs/linnkit/contracts';
import { modelCatalog } from 'src/domains/model-catalog';

type RunCost = runSupervisor.RunCost;
type RunCostCollector = runSupervisor.RunCostCollector;
type TelemetryEvent = telemetry.TelemetryEvent;

interface ModelTokenAccountingMetadata {
  pricing?: TokenPricing;
  route?: TokenRoute;
}

export type ModelTokenAccountingResolver = (modelId: string) => ModelTokenAccountingMetadata | undefined;

interface RunCostAccumulator {
  tokensInput: number;
  tokensOutput: number;
  latencyMs: number;
  llmCallCount: number;
  tokenLedgerEntries: TokenLedgerEntry[];
  tokenLedgerSequence: number;
  contextLedgerSequence: number;
  computedCostUsd: number;
  computedActualCostCount: number;
  unknownActualCostCount: number;
  childRunIds: Set<string>;
}

function createEmptyCost(): RunCost {
  return {
    tokensInput: 0,
    tokensOutput: 0,
    latencyMs: 0,
  };
}

/**
 * Linnya 宿主侧的 run cost 聚合器。
 *
 * 中文备注：
 * - 数据源只来自 linnkit `TelemetryPort.emit({ kind: 'llm_call' })`；
 * - runId 由调用方传入，N-3.A 方案 A 下等于 turnId；
 * - tokenUsage 是真实聚合载体，legacy tokensInput/tokensOutput 只保留兼容读法；
 * - 仅对 confidence=actual 且价格完整的 usage 填 totalCostUsd，缺价保持 unknown。
 */
export class LinnyaRunCostCollector implements RunCostCollector {
  private readonly buckets = new Map<string, RunCostAccumulator>();
  private readonly parentByRunId = new Map<string, string>();

  constructor(
    private readonly resolveTokenAccounting: ModelTokenAccountingResolver = defaultResolveTokenAccounting,
  ) {}

  ingest(runId: string, event: TelemetryEvent): void {
    if (event.kind === 'context_build') {
      this.ingestContextBuild(runId, event);
      return;
    }

    if (event.kind !== 'llm_call') {
      return;
    }

    this.linkParentRun(runId, event.scope.parentRunId);
    const bucket = this.ensureBucket(runId);
    const usage = readCanonicalUsage(event);
    bucket.tokensInput += usage?.inputTokens ?? event.usage?.promptTokens ?? 0;
    bucket.tokensOutput += usage?.outputTokens ?? event.usage?.completionTokens ?? 0;
    bucket.latencyMs += event.durationMs;
    bucket.llmCallCount += 1;

    if (usage) {
      const metadata = this.resolveTokenAccounting(event.modelId);
      const ledgerEntry = event.tokenLedgerEntry ?? this.createLedgerEntry(runId, event, usage, metadata?.route, bucket);
      bucket.tokenLedgerEntries.push(ledgerEntry);
      this.recordCost(bucket, usage, metadata?.pricing);
    }
  }

  ingestTelemetry(event: TelemetryEvent): void {
    const runId = event.scope?.runId ?? event.scope?.turnId;
    if (!runId) {
      return;
    }
    this.ingest(runId, event);
  }

  release(runId: string): void {
    const bucket = this.buckets.get(runId);
    if (bucket) {
      for (const childRunId of bucket.childRunIds) {
        this.parentByRunId.delete(childRunId);
        this.buckets.delete(childRunId);
      }
    }
    const parentRunId = this.parentByRunId.get(runId);
    if (parentRunId) {
      this.buckets.get(parentRunId)?.childRunIds.delete(runId);
      this.parentByRunId.delete(runId);
    }
    this.buckets.delete(runId);
  }

  snapshot(runId: string): RunCost {
    const bucket = this.buckets.get(runId);
    if (!bucket) {
      return createEmptyCost();
    }

    const childrenTotal = this.snapshotChildren(bucket.childRunIds);
    const tokenUsage = this.snapshotTokenUsage(bucket, childrenTotal?.tokenUsage);
    const tokenLedgerEntryIds = collectTokenLedgerEntryIds(bucket);
    const totalCostUsd = this.snapshotCost(bucket);

    return {
      tokensInput: bucket.tokensInput,
      tokensOutput: bucket.tokensOutput,
      latencyMs: bucket.latencyMs,
      ...(tokenUsage ? { tokenUsage } : {}),
      ...(tokenLedgerEntryIds.length > 0 ? { tokenLedgerEntryIds } : {}),
      ...(totalCostUsd !== undefined ? { totalCostUsd } : {}),
      ...(childrenTotal ? { childrenTotal } : {}),
    };
  }

  private linkParentRun(runId: string, parentRunId: string | undefined): void {
    if (!parentRunId || parentRunId === runId) {
      return;
    }
    this.parentByRunId.set(runId, parentRunId);
    this.ensureBucket(parentRunId).childRunIds.add(runId);
  }

  private snapshotChildren(childRunIds: ReadonlySet<string>): RunCost | undefined {
    if (childRunIds.size === 0) {
      return undefined;
    }

    const total = createEmptyCost();
    let childTokenUsage: RunTokenUsageAggregate | undefined;
    let totalCostUsd = 0;
    let hasComputedCost = false;
    let costComplete = true;

    for (const childRunId of childRunIds) {
      const childCost = this.snapshot(childRunId);
      total.tokensInput += childCost.tokensInput;
      total.tokensOutput += childCost.tokensOutput;
      total.latencyMs = (total.latencyMs ?? 0) + (childCost.latencyMs ?? 0);
      childTokenUsage = mergeRunTokenUsage(childTokenUsage, childCost.tokenUsage);
      if (childCost.totalCostUsd !== undefined) {
        totalCostUsd += childCost.totalCostUsd;
        hasComputedCost = true;
      } else if (hasLlmUsage(childCost.tokenUsage)) {
        costComplete = false;
      }
      if (childCost.childrenTotal) {
        total.tokensInput += childCost.childrenTotal.tokensInput;
        total.tokensOutput += childCost.childrenTotal.tokensOutput;
        total.latencyMs = (total.latencyMs ?? 0) + (childCost.childrenTotal.latencyMs ?? 0);
        childTokenUsage = mergeRunTokenUsage(childTokenUsage, childCost.childrenTotal.tokenUsage);
        if (childCost.childrenTotal.totalCostUsd !== undefined) {
          totalCostUsd += childCost.childrenTotal.totalCostUsd;
          hasComputedCost = true;
        } else if (hasLlmUsage(childCost.childrenTotal.tokenUsage)) {
          costComplete = false;
        }
      }
    }
    if (childTokenUsage) {
      total.tokenUsage = childTokenUsage;
    }
    if (hasComputedCost && costComplete) {
      total.totalCostUsd = totalCostUsd;
    }
    return total;
  }

  private ensureBucket(runId: string): RunCostAccumulator {
    const existing = this.buckets.get(runId);
    if (existing) {
      return existing;
    }

    const bucket: RunCostAccumulator = {
      tokensInput: 0,
      tokensOutput: 0,
      latencyMs: 0,
      llmCallCount: 0,
      tokenLedgerEntries: [],
      tokenLedgerSequence: 0,
      contextLedgerSequence: 0,
      computedCostUsd: 0,
      computedActualCostCount: 0,
      unknownActualCostCount: 0,
      childRunIds: new Set<string>(),
    };
    this.buckets.set(runId, bucket);
    return bucket;
  }

  private createLedgerEntry(
    runId: string,
    event: Extract<TelemetryEvent, { kind: 'llm_call' }>,
    usage: CanonicalLlmUsage,
    route: TokenRoute | undefined,
    bucket: RunCostAccumulator,
  ): LlmUsageTokenLedgerEntry {
    bucket.tokenLedgerSequence += 1;
    return tokenAccounting.createLlmUsageLedgerEntry({
      id: `run-cost:${runId}:llm:${bucket.tokenLedgerSequence}`,
      runId,
      ...(event.scope.parentRunId ? { parentRunId: event.scope.parentRunId } : {}),
      ...(event.scope.conversationId ? { conversationId: event.scope.conversationId } : {}),
      ...(event.scope.turnId ? { turnId: event.scope.turnId } : {}),
      ...(event.scope.stepId ? { stepId: event.scope.stepId } : {}),
      ...(route ? { route } : {}),
      modelId: event.modelId,
      usage,
    });
  }

  private ingestContextBuild(runId: string, event: Extract<TelemetryEvent, { kind: 'context_build' }>): void {
    this.linkParentRun(runId, event.scope.parentRunId);
    const bucket = this.ensureBucket(runId);
    const ledgerEntry = event.tokenLedgerEntry ?? this.createContextLedgerEntry(runId, event, bucket);
    if (!ledgerEntry) {
      return;
    }
    bucket.tokenLedgerEntries.push(ledgerEntry);
  }

  private createContextLedgerEntry(
    runId: string,
    event: Extract<TelemetryEvent, { kind: 'context_build' }>,
    bucket: RunCostAccumulator,
  ): ContextComponentTokenLedgerEntry | undefined {
    const components = event.tokenComponents?.filter((component) => component.kept !== false) ?? [];
    if (components.length === 0) {
      return undefined;
    }
    bucket.contextLedgerSequence += 1;
    return tokenAccounting.createContextComponentLedgerEntry({
      id: `run-cost:${runId}:context:${bucket.contextLedgerSequence}`,
      runId,
      ...(event.scope.parentRunId ? { parentRunId: event.scope.parentRunId } : {}),
      ...(event.scope.conversationId ? { conversationId: event.scope.conversationId } : {}),
      ...(event.scope.turnId ? { turnId: event.scope.turnId } : {}),
      ...(event.scope.stepId ? { stepId: event.scope.stepId } : {}),
      ...(event.tokenEstimate.route ? { route: event.tokenEstimate.route } : {}),
      components,
    });
  }

  private recordCost(bucket: RunCostAccumulator, usage: CanonicalLlmUsage, pricing: TokenPricing | undefined): void {
    if (usage.confidence !== 'actual') {
      return;
    }

    const cost = tokenAccounting.computeCost(usage, pricing);
    if (cost.status === 'computed' && cost.currency === 'USD' && cost.totalCost !== undefined) {
      bucket.computedCostUsd += cost.totalCost;
      bucket.computedActualCostCount += 1;
      return;
    }
    bucket.unknownActualCostCount += 1;
  }

  private snapshotTokenUsage(
    bucket: RunCostAccumulator,
    children: RunTokenUsageAggregate | undefined,
  ): RunTokenUsageAggregate | undefined {
    if (bucket.tokenLedgerEntries.length === 0 && !children) {
      return undefined;
    }

    const own = tokenAccounting.aggregateTokenLedgerEntries(bucket.tokenLedgerEntries);
    if (!children) {
      return { own };
    }

    return {
      own,
      children: flattenRunTokenUsage(children),
    };
  }

  private snapshotCost(bucket: RunCostAccumulator): number | undefined {
    if (bucket.unknownActualCostCount > 0 || bucket.computedActualCostCount === 0) {
      return undefined;
    }
    return bucket.computedCostUsd;
  }
}

function defaultResolveTokenAccounting(modelId: string): ModelTokenAccountingMetadata | undefined {
  const model = modelCatalog.getModel(modelId);
  if (!model) {
    return undefined;
  }

  return {
    ...(model.token_pricing ? { pricing: model.token_pricing } : {}),
    ...(model.token_route ? { route: model.token_route } : {}),
  };
}

function readCanonicalUsage(event: Extract<TelemetryEvent, { kind: 'llm_call' }>): CanonicalLlmUsage | undefined {
  return event.tokenLedgerEntry?.usage ?? event.canonicalUsage ?? event.usage?.canonicalUsage;
}

function collectTokenLedgerEntryIds(bucket: RunCostAccumulator): string[] {
  return bucket.tokenLedgerEntries.map((entry) => entry.id);
}

function emptyLedgerAggregate(): TokenLedgerAggregate {
  return {
    contextTokens: 0,
    entryCount: 0,
    llmCallCount: 0,
    contextComponentCount: 0,
  };
}

function mergeOptionalTokenCount(left: number | undefined, right: number | undefined): number | undefined {
  if (left === undefined) {
    return right;
  }
  if (right === undefined) {
    return left;
  }
  return left + right;
}

function mergeTotalTokens(left: number | undefined, right: number | undefined): number | undefined {
  return left === undefined || right === undefined ? undefined : left + right;
}

function mergeLedgerAggregate(
  left: TokenLedgerAggregate | undefined,
  right: TokenLedgerAggregate | undefined,
): TokenLedgerAggregate | undefined {
  if (!left) {
    return right;
  }
  if (!right) {
    return left;
  }

  const leftUsage = left.llmUsage;
  const rightUsage = right.llmUsage;
  const llmUsage = leftUsage && rightUsage
    ? {
        inputTokens: leftUsage.inputTokens + rightUsage.inputTokens,
        imageInputTokens: mergeOptionalTokenCount(
          leftUsage.imageInputTokens,
          rightUsage.imageInputTokens,
        ),
        outputTokens: leftUsage.outputTokens + rightUsage.outputTokens,
        reasoningTokens: mergeOptionalTokenCount(leftUsage.reasoningTokens, rightUsage.reasoningTokens),
        cacheReadTokens: mergeOptionalTokenCount(leftUsage.cacheReadTokens, rightUsage.cacheReadTokens),
        cacheWriteTokens: mergeOptionalTokenCount(leftUsage.cacheWriteTokens, rightUsage.cacheWriteTokens),
        totalTokens: mergeTotalTokens(leftUsage.totalTokens, rightUsage.totalTokens),
        usageCount: leftUsage.usageCount + rightUsage.usageCount,
      }
    : leftUsage ?? rightUsage;

  return {
    ...(llmUsage ? { llmUsage } : {}),
    contextTokens: left.contextTokens + right.contextTokens,
    entryCount: left.entryCount + right.entryCount,
    llmCallCount: left.llmCallCount + right.llmCallCount,
    contextComponentCount: left.contextComponentCount + right.contextComponentCount,
  };
}

function flattenRunTokenUsage(tokenUsage: RunTokenUsageAggregate): TokenLedgerAggregate {
  return mergeLedgerAggregate(tokenUsage.own, tokenUsage.children) ?? emptyLedgerAggregate();
}

function mergeRunTokenUsage(
  left: RunTokenUsageAggregate | undefined,
  right: RunTokenUsageAggregate | undefined,
): RunTokenUsageAggregate | undefined {
  if (!left) {
    return right;
  }
  if (!right) {
    return left;
  }

  const own = mergeLedgerAggregate(left.own, right.own) ?? emptyLedgerAggregate();
  const children = mergeLedgerAggregate(left.children, right.children);
  return children ? { own, children } : { own };
}

function hasLlmUsage(tokenUsage: RunTokenUsageAggregate | undefined): boolean {
  return Boolean(tokenUsage && (
    tokenUsage.own.llmCallCount > 0 ||
    (tokenUsage.children?.llmCallCount ?? 0) > 0
  ));
}
