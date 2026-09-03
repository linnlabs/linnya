import { describe, expect, it } from 'vitest';
import type { telemetry } from 'linnkit/runtime-kernel';
import type { CanonicalLlmUsage, TokenPricing, TokenRoute } from 'linnkit/contracts';
import { LinnyaRunCostCollector } from './linnyaRunCostCollector';

function llmCallEvent(params?: {
  promptTokens?: number;
  completionTokens?: number;
  durationMs?: number;
  runId?: string;
  parentRunId?: string;
  modelId?: string;
  canonicalUsage?: CanonicalLlmUsage;
  phase?: 'main' | 'context-internal';
  purpose?: string;
}): telemetry.TelemetryEvent {
  return {
    kind: 'llm_call',
    modelId: params?.modelId ?? 'test-model',
    stream: true,
    durationMs: params?.durationMs ?? 100,
    usage: {
      promptTokens: params?.promptTokens ?? 100,
      completionTokens: params?.completionTokens ?? 50,
      totalTokens: (params?.promptTokens ?? 100) + (params?.completionTokens ?? 50),
      ...(params?.canonicalUsage ? { canonicalUsage: params.canonicalUsage } : {}),
    },
    ...(params?.canonicalUsage ? { canonicalUsage: params.canonicalUsage } : {}),
    ...(params?.phase ? { phase: params.phase } : {}),
    ...(params?.purpose ? { purpose: params.purpose } : {}),
    scope: {
      conversationId: 'conv-test',
      turnId: params?.runId ?? 'run-test',
      ...(params?.runId ? { runId: params.runId } : {}),
      ...(params?.parentRunId ? { parentRunId: params.parentRunId } : {}),
    },
  };
}

function canonicalUsage(overrides: Partial<CanonicalLlmUsage> = {}): CanonicalLlmUsage {
  return {
    inputTokens: 100,
    outputTokens: 40,
    source: 'provider-response-usage',
    confidence: 'actual',
    ...overrides,
  };
}

function contextBuildEvent(params?: {
  runId?: string;
  parentRunId?: string;
}): telemetry.TelemetryEvent {
  return {
    kind: 'context_build',
    modelId: route.modelId,
    tokenEstimate: {
      route,
      localEstimateTokens: 30,
      calibratedEstimateTokens: 40,
      finalTokens: 40,
      source: 'local-estimate',
      confidence: 'estimate',
    },
    tokenComponents: [
      {
        componentId: '0:user-1',
        kind: 'user',
        tokens: 25,
        source: 'local-estimate',
        confidence: 'estimate',
        kept: true,
      },
      {
        componentId: '1:old-answer',
        kind: 'assistant',
        tokens: 15,
        source: 'local-estimate',
        confidence: 'estimate',
        kept: false,
      },
    ],
    scope: {
      conversationId: 'conv-test',
      runId: params?.runId ?? 'run-test',
      turnId: params?.runId ?? 'run-test',
      ...(params?.parentRunId ? { parentRunId: params.parentRunId } : {}),
    },
  };
}

const pricing: TokenPricing = {
  currency: 'USD',
  unit: 'per_1m_tokens',
  input: 10,
  output: 20,
  reasoning: 30,
  cacheRead: 1,
  cacheWrite: 5,
};

const route: TokenRoute = {
  capabilityId: 'openai',
  modelId: 'gpt-test',
  endpointModelId: 'gpt-test-upstream',
  capabilities: {
    supportsResponseUsage: true,
    supportsCachedInputBilling: true,
  },
};

describe('LinnyaRunCostCollector', () => {
  it('按单个 run 累计 LLM token 与耗时', () => {
    const collector = new LinnyaRunCostCollector();

    collector.ingest('run1', llmCallEvent({ promptTokens: 100, completionTokens: 50, durationMs: 20 }));
    collector.ingest('run1', llmCallEvent({ promptTokens: 100, completionTokens: 50, durationMs: 30 }));

    expect(collector.snapshot('run1')).toEqual({
      tokensInput: 200,
      tokensOutput: 100,
      latencyMs: 50,
    });
  });

  it('多个 run 互相隔离', () => {
    const collector = new LinnyaRunCostCollector();

    collector.ingest('run1', llmCallEvent({ promptTokens: 10, completionTokens: 2 }));
    collector.ingest('run2', llmCallEvent({ promptTokens: 30, completionTokens: 4 }));

    expect(collector.snapshot('run1').tokensInput).toBe(10);
    expect(collector.snapshot('run2').tokensInput).toBe(30);
  });

  it('按 parentRunId 聚合 child-run cost，同时保留父子 run 独立快照', () => {
    const collector = new LinnyaRunCostCollector();

    collector.ingest('parent-run', llmCallEvent({ promptTokens: 10, completionTokens: 5, runId: 'parent-run' }));
    collector.ingest(
      'child-run-1',
      llmCallEvent({ promptTokens: 30, completionTokens: 7, runId: 'child-run-1', parentRunId: 'parent-run' }),
    );
    collector.ingest(
      'child-run-2',
      llmCallEvent({ promptTokens: 40, completionTokens: 8, runId: 'child-run-2', parentRunId: 'parent-run' }),
    );

    expect(collector.snapshot('child-run-1')).toEqual({
      tokensInput: 30,
      tokensOutput: 7,
      latencyMs: 100,
    });
    expect(collector.snapshot('parent-run')).toEqual({
      tokensInput: 10,
      tokensOutput: 5,
      latencyMs: 100,
      childrenTotal: {
        tokensInput: 70,
        tokensOutput: 15,
        latencyMs: 200,
      },
    });
  });

  it('未注册 run 收到 telemetry 时静默创建 bucket', () => {
    const collector = new LinnyaRunCostCollector();

    expect(() => collector.ingest('run_unknown', llmCallEvent())).not.toThrow();
    expect(collector.snapshot('run_unknown').tokensInput).toBe(100);
  });

  it('release 后清空 bucket', () => {
    const collector = new LinnyaRunCostCollector();

    collector.ingest('run1', llmCallEvent());
    collector.release('run1');

    expect(collector.snapshot('run1')).toEqual({
      tokensInput: 0,
      tokensOutput: 0,
      latencyMs: 0,
    });
  });

  it('缺 usage 字段不崩溃', () => {
    const collector = new LinnyaRunCostCollector();

    collector.ingest('run1', {
      kind: 'llm_call',
      modelId: 'test-model',
      stream: false,
      durationMs: 12,
      scope: { turnId: 'run1' },
    });

    expect(collector.snapshot('run1')).toEqual({
      tokensInput: 0,
      tokensOutput: 0,
      latencyMs: 12,
    });
  });

  it('snapshot 返回独立对象，不暴露内部 bucket', () => {
    const collector = new LinnyaRunCostCollector();

    collector.ingest('run1', llmCallEvent({ promptTokens: 10, completionTokens: 2 }));
    const snapshot = collector.snapshot('run1');
    snapshot.tokensInput = 999;

    expect(collector.snapshot('run1').tokensInput).toBe(10);
  });

  it('以 canonicalUsage 聚合 tokenUsage，并用 legacy tokensInput/tokensOutput 保持兼容', () => {
    const collector = new LinnyaRunCostCollector(() => ({ route, pricing }));

    collector.ingest('run1', llmCallEvent({
      modelId: 'gpt-test',
      promptTokens: 999,
      completionTokens: 999,
      canonicalUsage: canonicalUsage({
        inputTokens: 90,
        outputTokens: 25,
        reasoningTokens: 5,
        cacheReadTokens: 30,
        totalTokens: 150,
      }),
    }));

    expect(collector.snapshot('run1')).toMatchObject({
      tokensInput: 90,
      tokensOutput: 25,
      totalCostUsd: 0.0015800000000000002,
      tokenLedgerEntryIds: ['run-cost:run1:llm:1'],
      tokenUsage: {
        own: {
          llmUsage: {
            inputTokens: 90,
            outputTokens: 25,
            reasoningTokens: 5,
            cacheReadTokens: 30,
            totalTokens: 150,
            usageCount: 1,
          },
          llmCallCount: 1,
          entryCount: 1,
        },
      },
    });
  });

  it('缺少实际分项价格时不填 totalCostUsd，避免把 unknown 当 0', () => {
    const collector = new LinnyaRunCostCollector(() => ({
      pricing: {
        currency: 'USD',
        unit: 'per_1m_tokens',
        input: 10,
        output: 20,
      },
    }));

    collector.ingest('run1', llmCallEvent({
      canonicalUsage: canonicalUsage({
        inputTokens: 100,
        outputTokens: 20,
        reasoningTokens: 5,
      }),
    }));

    expect(collector.snapshot('run1')).toMatchObject({
      tokensInput: 100,
      tokensOutput: 20,
      tokenUsage: {
        own: {
          llmCallCount: 1,
        },
      },
    });
    expect(collector.snapshot('run1').totalCostUsd).toBeUndefined();
  });

  it('estimate usage 进入 tokenUsage，但不进入真实 cost', () => {
    const collector = new LinnyaRunCostCollector(() => ({ pricing }));

    collector.ingest('run1', llmCallEvent({
      canonicalUsage: canonicalUsage({
        inputTokens: 60,
        outputTokens: 10,
        source: 'local-estimate',
        confidence: 'estimate',
      }),
    }));

    const snapshot = collector.snapshot('run1');
    expect(snapshot.tokenUsage?.own.llmUsage).toMatchObject({
      inputTokens: 60,
      outputTokens: 10,
      usageCount: 1,
    });
    expect(snapshot.totalCostUsd).toBeUndefined();
  });

  it('context_build component 进入 tokenUsage.contextTokens，但不影响 legacy input/output', () => {
    const collector = new LinnyaRunCostCollector();

    collector.ingestTelemetry(contextBuildEvent({ runId: 'run1' }));

    expect(collector.snapshot('run1')).toMatchObject({
      tokensInput: 0,
      tokensOutput: 0,
      tokenLedgerEntryIds: ['run-cost:run1:context:1'],
      tokenUsage: {
        own: {
          contextTokens: 25,
          entryCount: 1,
          contextComponentCount: 1,
          llmCallCount: 0,
        },
      },
    });
  });

  it('内部摘要 LLM usage 计入触发它的主 run', () => {
    const collector = new LinnyaRunCostCollector(() => ({ pricing }));

    collector.ingestTelemetry(llmCallEvent({
      runId: 'run-summary',
      modelId: 'summary-model',
      canonicalUsage: canonicalUsage({
        inputTokens: 70,
        outputTokens: 9,
        totalTokens: 79,
      }),
      phase: 'context-internal',
      purpose: 'summarization',
    }));

    expect(collector.snapshot('run-summary')).toMatchObject({
      tokensInput: 70,
      tokensOutput: 9,
      tokenUsage: {
        own: {
          llmUsage: {
            inputTokens: 70,
            outputTokens: 9,
            totalTokens: 79,
            usageCount: 1,
          },
          llmCallCount: 1,
        },
      },
    });
  });

  it('有内部摘要调用的 run 比无摘要同构 run 多出摘要 token', () => {
    const collector = new LinnyaRunCostCollector(() => ({ pricing }));
    const mainUsage = canonicalUsage({
      inputTokens: 100,
      outputTokens: 20,
      totalTokens: 120,
    });
    const summaryUsage = canonicalUsage({
      inputTokens: 45,
      outputTokens: 8,
      totalTokens: 53,
    });

    collector.ingestTelemetry(llmCallEvent({
      runId: 'run-without-summary',
      modelId: 'main-model',
      canonicalUsage: mainUsage,
      phase: 'main',
    }));
    collector.ingestTelemetry(llmCallEvent({
      runId: 'run-with-summary',
      modelId: 'main-model',
      canonicalUsage: mainUsage,
      phase: 'main',
    }));
    collector.ingestTelemetry(llmCallEvent({
      runId: 'run-with-summary',
      modelId: 'summary-model',
      canonicalUsage: summaryUsage,
      phase: 'context-internal',
      purpose: 'summarization',
    }));

    const withoutSummary = collector.snapshot('run-without-summary');
    const withSummary = collector.snapshot('run-with-summary');

    expect(withoutSummary.tokenUsage?.own.llmUsage).toBeDefined();
    expect(withSummary.tokenUsage?.own.llmUsage).toBeDefined();
    expect(withSummary.tokensInput - withoutSummary.tokensInput).toBe(summaryUsage.inputTokens);
    expect(withSummary.tokensOutput - withoutSummary.tokensOutput).toBe(summaryUsage.outputTokens);
    expect(withSummary.tokenUsage?.own.llmUsage?.totalTokens).toBe(173);
    expect(withoutSummary.tokenUsage?.own.llmCallCount).toBe(1);
    expect(withSummary.tokenUsage?.own.llmCallCount).toBe(2);
  });

  it('父 run 的 own cost 与 childrenTotal 分离，避免重复计费', () => {
    const collector = new LinnyaRunCostCollector(() => ({ pricing }));

    collector.ingest('parent-run', llmCallEvent({
      runId: 'parent-run',
      canonicalUsage: canonicalUsage({ inputTokens: 100, outputTokens: 50 }),
    }));
    collector.ingest('child-run', llmCallEvent({
      runId: 'child-run',
      parentRunId: 'parent-run',
      canonicalUsage: canonicalUsage({ inputTokens: 200, outputTokens: 100 }),
    }));

    const parent = collector.snapshot('parent-run');
    expect(parent.totalCostUsd).toBe(0.002);
    expect(parent.childrenTotal?.totalCostUsd).toBe(0.004);
    expect(parent.tokenUsage?.own.llmUsage).toMatchObject({
      inputTokens: 100,
      outputTokens: 50,
    });
    expect(parent.tokenUsage?.children?.llmUsage).toMatchObject({
      inputTokens: 200,
      outputTokens: 100,
    });
  });

  it('父 run 汇总多个 child 的图片输入分项，但 legacy input 与费用不重复累计', () => {
    const collector = new LinnyaRunCostCollector(() => ({ pricing }));

    collector.ingest('child-image-1', llmCallEvent({
      runId: 'child-image-1',
      parentRunId: 'parent-image',
      canonicalUsage: canonicalUsage({
        inputTokens: 100,
        imageInputTokens: 25,
        outputTokens: 20,
      }),
    }));
    collector.ingest('child-image-2', llmCallEvent({
      runId: 'child-image-2',
      parentRunId: 'parent-image',
      canonicalUsage: canonicalUsage({
        inputTokens: 40,
        imageInputTokens: 10,
        outputTokens: 5,
      }),
    }));

    const parent = collector.snapshot('parent-image');
    expect(parent.childrenTotal).toMatchObject({
      tokensInput: 140,
      tokensOutput: 25,
      totalCostUsd: 0.0019,
      tokenUsage: {
        own: {
          llmUsage: {
            inputTokens: 140,
            imageInputTokens: 35,
            outputTokens: 25,
          },
        },
      },
    });
  });
});
