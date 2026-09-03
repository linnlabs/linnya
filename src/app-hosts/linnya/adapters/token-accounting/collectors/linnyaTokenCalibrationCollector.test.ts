import { describe, expect, it } from 'vitest';
import type { telemetry } from '@linnlabs/linnkit/runtime-kernel';
import type { CanonicalLlmUsage, TokenRoute } from '@linnlabs/linnkit/contracts';

import { LinnyaTokenCalibrationCollector } from './linnyaTokenCalibrationCollector';

const route: TokenRoute = {
  capabilityId: 'openrouter',
  baseURL: 'https://openrouter.ai/api/v1',
  modelId: 'glm-via-openrouter',
  endpointModelId: 'z-ai/glm-4.5',
};

const otherRoute: TokenRoute = {
  capabilityId: 'zai',
  baseURL: 'https://api.z.ai',
  modelId: 'glm-direct',
  endpointModelId: 'glm-4.5',
};

function contextBuildEvent(params?: {
  route?: TokenRoute;
  omitRoute?: boolean;
  localEstimateTokens?: number;
  calibratedEstimateTokens?: number;
  runId?: string;
  turnId?: string;
}): telemetry.TelemetryEvent {
  const localEstimateTokens = params?.localEstimateTokens ?? 100;
  const calibratedEstimateTokens = params?.calibratedEstimateTokens ?? localEstimateTokens;
  const eventRoute = params?.omitRoute ? undefined : (params?.route ?? route);
  return {
    kind: 'context_build',
    modelId: eventRoute?.modelId ?? route.modelId,
    tokenEstimate: {
      ...(eventRoute ? { route: eventRoute } : {}),
      localEstimateTokens,
      calibratedEstimateTokens,
      finalTokens: calibratedEstimateTokens,
      source: 'local-estimate',
      confidence: 'estimate',
    },
    scope: {
      conversationId: 'conv-calibration',
      turnId: params?.turnId ?? 'turn-1',
      runId: params?.runId ?? 'run-1',
    },
  };
}

function llmCallEvent(params?: {
  usage?: CanonicalLlmUsage;
  runId?: string;
  turnId?: string;
  ledgerEntryId?: string;
  phase?: 'main' | 'context-internal';
  purpose?: string;
}): telemetry.TelemetryEvent {
  const usage = params?.usage ?? actualUsage();
  return {
    kind: 'llm_call',
    modelId: route.modelId,
    stream: false,
    durationMs: 120,
    canonicalUsage: usage,
    ...(params?.phase ? { phase: params.phase } : {}),
    ...(params?.purpose ? { purpose: params.purpose } : {}),
    tokenLedgerEntry: {
      id: params?.ledgerEntryId ?? 'ledger-1',
      kind: 'llm-usage',
      runId: params?.runId ?? 'run-1',
      route,
      modelId: route.modelId,
      usage,
    },
    scope: {
      conversationId: 'conv-calibration',
      turnId: params?.turnId ?? 'turn-1',
      runId: params?.runId ?? 'run-1',
    },
  };
}

function actualUsage(overrides: Partial<CanonicalLlmUsage> = {}): CanonicalLlmUsage {
  return {
    inputTokens: 120,
    outputTokens: 40,
    cacheReadTokens: 30,
    cacheWriteTokens: 5,
    source: 'provider-response-usage',
    confidence: 'actual',
    ...overrides,
  };
}

describe('LinnyaTokenCalibrationCollector', () => {
  it('把同一 turn 的 context_build local estimate 与 llm_call actual usage 配对成样本', () => {
    const collector = new LinnyaTokenCalibrationCollector({ now: () => 1234 });

    collector.ingestTelemetry(contextBuildEvent({
      route,
      localEstimateTokens: 100,
      calibratedEstimateTokens: 160,
      runId: 'run-1',
      turnId: 'turn-1',
    }));
    collector.ingestTelemetry(llmCallEvent({
      runId: 'run-1',
      turnId: 'turn-1',
      ledgerEntryId: 'ledger-actual-1',
    }));

    expect(collector.getSamples(route)).toEqual([
      {
        route,
        localEstimateTokens: 100,
        actualInputTokens: 155,
        source: 'provider-response-usage',
        confidence: 'actual',
        observedAt: 1234,
        runId: 'run-1',
        ledgerEntryId: 'ledger-actual-1',
      },
    ]);
  });

  it('按 route 隔离样本，避免中转 route 与官方 route 混用', () => {
    const collector = new LinnyaTokenCalibrationCollector();

    collector.ingestTelemetry(contextBuildEvent({ route, turnId: 'turn-1', runId: 'run-1' }));
    collector.ingestTelemetry(llmCallEvent({ turnId: 'turn-1', runId: 'run-1' }));
    collector.ingestTelemetry(contextBuildEvent({ route: otherRoute, turnId: 'turn-2', runId: 'run-2' }));
    collector.ingestTelemetry(llmCallEvent({ turnId: 'turn-2', runId: 'run-2' }));

    expect(collector.getSamples(route)).toHaveLength(1);
    expect(collector.getSamples(otherRoute)).toHaveLength(1);
    expect(collector.getSamples(route)[0]?.route).toEqual(route);
    expect(collector.getSamples(otherRoute)[0]?.route).toEqual(otherRoute);
  });

  it('每条 route 使用有上限的环形样本窗口', () => {
    const collector = new LinnyaTokenCalibrationCollector({
      maxSamplesPerRoute: 2,
      now: () => 1,
    });

    for (let index = 1; index <= 3; index += 1) {
      collector.ingestTelemetry(contextBuildEvent({
        route,
        runId: `run-${index}`,
        turnId: `turn-${index}`,
        localEstimateTokens: index * 10,
      }));
      collector.ingestTelemetry(llmCallEvent({
        runId: `run-${index}`,
        turnId: `turn-${index}`,
        ledgerEntryId: `ledger-${index}`,
      }));
    }

    expect(collector.getSamples(route).map(sample => sample.ledgerEntryId)).toEqual([
      'ledger-2',
      'ledger-3',
    ]);
  });

  it('缺少 context_build 或 actual usage 时不生成样本', () => {
    const collector = new LinnyaTokenCalibrationCollector();

    collector.ingestTelemetry(llmCallEvent({ runId: 'run-missing-context', turnId: 'turn-missing-context' }));
    collector.ingestTelemetry(contextBuildEvent({ route, runId: 'run-estimate', turnId: 'turn-estimate' }));
    collector.ingestTelemetry(llmCallEvent({
      runId: 'run-estimate',
      turnId: 'turn-estimate',
      usage: actualUsage({
        source: 'local-estimate',
        confidence: 'estimate',
      }),
    }));

    expect(collector.getSamples(route)).toEqual([]);
  });

  it('默认排除 context build 内部 LLM 调用，避免污染主调用校准样本', () => {
    const collector = new LinnyaTokenCalibrationCollector();

    collector.ingestTelemetry(contextBuildEvent({ route, runId: 'run-internal', turnId: 'turn-internal' }));
    collector.ingestTelemetry(llmCallEvent({
      runId: 'run-internal',
      turnId: 'turn-internal',
      phase: 'context-internal',
      purpose: 'summarization',
    }));

    expect(collector.getSamples(route)).toEqual([]);
  });

  it('context_build 没有 route 时不生成样本', () => {
    const collector = new LinnyaTokenCalibrationCollector();

    collector.ingestTelemetry(contextBuildEvent({ omitRoute: true, runId: 'run-no-route', turnId: 'turn-no-route' }));
    collector.ingestTelemetry(llmCallEvent({ runId: 'run-no-route', turnId: 'turn-no-route' }));

    expect(collector.getSamples(route)).toEqual([]);
  });
});
