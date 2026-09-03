import type { telemetry } from '@linnlabs/linnkit/runtime-kernel';
import type {
  CanonicalLlmUsage,
  ContextBuildTokenEstimate,
  TokenRoute,
  TokenUsageCalibrationSample,
} from '@linnlabs/linnkit/contracts';

type TelemetryEvent = telemetry.TelemetryEvent;

interface PendingContextBuild {
  scopeKey: string;
  route: TokenRoute;
  tokenEstimate: ContextBuildTokenEstimate;
}

export interface LinnyaTokenCalibrationCollectorOptions {
  maxSamplesPerRoute?: number;
  now?: () => number;
}

const DEFAULT_MAX_SAMPLES_PER_ROUTE = 64;

/**
 * Telemetry 驱动的 token 校准样本收集器。
 *
 * 中文备注：
 * - 只把同一 turn/run 的 context_build 本地估算与后续 llm_call actual usage 配对；
 * - 只采 `confidence=actual`，estimate / provider-estimate 都不进入样本；
 * - 样本按 TokenRoute 隔离，避免中转 route 与官方 route 混用。
 */
export class LinnyaTokenCalibrationCollector {
  private readonly pendingByScope = new Map<string, PendingContextBuild>();
  private readonly samplesByRoute = new Map<string, TokenUsageCalibrationSample[]>();
  private readonly maxSamplesPerRoute: number;
  private readonly now: () => number;

  constructor(options: LinnyaTokenCalibrationCollectorOptions = {}) {
    this.maxSamplesPerRoute = options.maxSamplesPerRoute ?? DEFAULT_MAX_SAMPLES_PER_ROUTE;
    this.now = options.now ?? Date.now;
  }

  ingestTelemetry(event: TelemetryEvent): void {
    if (event.kind === 'context_build') {
      this.ingestContextBuild(event);
      return;
    }
    if (event.kind === 'llm_call') {
      if (event.phase === 'context-internal') {
        return;
      }
      this.ingestLlmCall(event);
    }
  }

  getSamples(route: TokenRoute): readonly TokenUsageCalibrationSample[] {
    return [...(this.samplesByRoute.get(routeKey(route)) ?? [])];
  }

  clear(): void {
    this.pendingByScope.clear();
    this.samplesByRoute.clear();
  }

  private ingestContextBuild(event: Extract<TelemetryEvent, { kind: 'context_build' }>): void {
    const scopeKey = calibrationScopeKey(event.scope);
    const route = event.tokenEstimate.route;
    if (!scopeKey || !route) {
      return;
    }

    this.pendingByScope.set(scopeKey, {
      scopeKey,
      route,
      tokenEstimate: event.tokenEstimate,
    });
  }

  private ingestLlmCall(event: Extract<TelemetryEvent, { kind: 'llm_call' }>): void {
    const scopeKey = calibrationScopeKey(event.scope);
    if (!scopeKey) {
      return;
    }

    const pending = this.pendingByScope.get(scopeKey);
    if (!pending) {
      return;
    }

    const usage = event.tokenLedgerEntry?.usage ?? event.canonicalUsage ?? event.usage?.canonicalUsage;
    if (!usage || usage.confidence !== 'actual') {
      return;
    }

    this.pendingByScope.delete(scopeKey);
    const sample: TokenUsageCalibrationSample = {
      route: pending.route,
      localEstimateTokens: pending.tokenEstimate.localEstimateTokens,
      actualInputTokens: actualInputTokensForCalibrationSample(usage),
      source: usage.source === 'host-supplied' ? 'host-supplied' : 'provider-response-usage',
      confidence: 'actual',
      observedAt: this.now(),
      ...(event.scope.runId ? { runId: event.scope.runId } : {}),
      ...(event.tokenLedgerEntry?.id ? { ledgerEntryId: event.tokenLedgerEntry.id } : {}),
    };

    this.pushSample(sample);
  }

  private pushSample(sample: TokenUsageCalibrationSample): void {
    const key = routeKey(sample.route);
    const existing = this.samplesByRoute.get(key) ?? [];
    existing.push(sample);
    if (existing.length > this.maxSamplesPerRoute) {
      existing.splice(0, existing.length - this.maxSamplesPerRoute);
    }
    this.samplesByRoute.set(key, existing);
  }
}

function calibrationScopeKey(scope: telemetry.TelemetryScope): string | undefined {
  return scope.turnId ?? scope.runId;
}

function actualInputTokensForCalibrationSample(usage: CanonicalLlmUsage): number {
  return usage.inputTokens + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0);
}

function routeKey(route: TokenRoute): string {
  return JSON.stringify({
    capabilityId: route.capabilityId,
    baseURL: route.baseURL,
    modelId: route.modelId,
    endpointModelId: route.endpointModelId,
  });
}
