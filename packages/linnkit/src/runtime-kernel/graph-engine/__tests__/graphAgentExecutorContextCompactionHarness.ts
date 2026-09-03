import { vi } from 'vitest';
import {
  createHistorySummaryEvent,
  DEFAULT_CONTEXT_COMPACTION_POLICY,
  RunIdSchema,
  type HistorySummaryEvent,
  type RuntimeEvent,
} from '../../../contracts';
import type {
  LlmCallOptions,
  LlmRequestMessage,
  TokenizerPort,
} from '../../../ports';
import type { FunctionToolSchema } from '../../tools/toolContracts';
import type { TelemetryEvent } from '../../telemetry';
import { GraphAgentExecutor, type TickEvent } from '../executor';
import type {
  GraphExecutorContextApplyInput,
  GraphExecutorContextApplyOutput,
  GraphExecutorContextBuildInput,
  GraphExecutorContextBuildOutput,
  GraphExecutorContextBuilder,
} from '../executorContextBuilder';
import type { ExecutorLocalState } from '../types';

const promptBudget = {
  effectiveWindowTokens: 120,
  outputLimitTokens: 20,
  inputBudgetTokens: 100,
  toolDefinitionTokens: 0,
  messageBudgetTokens: 100,
};
const measurementPolicy = {
  remote_count_enabled: false,
  remote_count_failure_behavior: 'use-local-estimate' as const,
};

interface BuildScenario {
  promptTokens: number;
  candidate?: boolean;
  fingerprint?: string;
  summarySeq?: number;
  replaceableRangeExhausted?: boolean;
  rebuiltTokens?: number;
}

interface HarnessOptions {
  builds?: readonly BuildScenario[];
  compactionFailure?: Error;
  commitFailure?: Error;
  publishFailure?: Error;
  invalidOutputReason?: string;
  ineffectiveRatio?: number;
  mainOutcomes?: readonly (string | Error)[];
  toolNames?: readonly string[];
  abortController?: AbortController;
  abortAfterRebuild?: boolean;
  maxCompactionsPerRun?: number;
  mainOutputLimitTokens?: number;
  routeMaxOutputTokens?: number;
  omitCommitPort?: boolean;
}

function tokenMarkedContent(label: string, tokens: number): string {
  return `${label} [tokens:${tokens}]`;
}

function estimateMessage(message: LlmRequestMessage): number {
  const content = 'content' in message && typeof message.content === 'string'
    ? message.content
    : '';
  const match = /\[tokens:(\d+)\]/u.exec(content);
  return match ? Number(match[1]) : 0;
}

function toolSchema(name: string): FunctionToolSchema {
  return {
    type: 'function',
    function: {
      name,
      description: `${name} description`,
      parameters: { type: 'object', properties: {} },
    },
  };
}

function latestHistorySummary(history: readonly RuntimeEvent[]): HistorySummaryEvent | undefined {
  return [...history].reverse().find(
    (event): event is HistorySummaryEvent => event.type === 'history_summary',
  );
}

export function createContextCompactionGraphHarness(options: HarnessOptions = {}) {
  const activePromptBudget = options.mainOutputLimitTokens === undefined
    ? promptBudget
    : {
        ...promptBudget,
        outputLimitTokens: options.mainOutputLimitTokens,
        inputBudgetTokens:
          promptBudget.effectiveWindowTokens - options.mainOutputLimitTokens,
        messageBudgetTokens:
          promptBudget.effectiveWindowTokens - options.mainOutputLimitTokens,
      };
  const scenarios = options.builds ?? [{ promptTokens: 85 }];
  const contextCompactionPolicy = {
    ...DEFAULT_CONTEXT_COMPACTION_POLICY,
    ...(options.maxCompactionsPerRun !== undefined
      ? { maxCompactionsPerRun: options.maxCompactionsPerRun }
      : {}),
  };
  const order: string[] = [];
  const telemetryEvents: TelemetryEvent[] = [];
  const committedSummaries: HistorySummaryEvent[] = [];
  const publishedSummaries: HistorySummaryEvent[] = [];
  let buildIndex = 0;

  const build = vi.fn(async (
    input: GraphExecutorContextBuildInput,
  ): Promise<GraphExecutorContextBuildOutput> => {
    const scenario = scenarios[Math.min(buildIndex, scenarios.length - 1)]!;
    buildIndex += 1;
    const previousSummary = latestHistorySummary(input.history);
    const summarySeq = scenario.summarySeq ?? (previousSummary?.summary_seq ?? 0) + 1;
    const fingerprint = scenario.fingerprint ?? `plan-${summarySeq}`;
    const candidateEnabled = scenario.candidate !== false;
    const replacedMessageIds = [
      ...(previousSummary ? [previousSummary.id] : []),
      `tool-old-${summarySeq}`,
    ];

    return {
      llmMessages: [
        ...(previousSummary
          ? [{ role: 'system' as const, content: previousSummary.content }]
          : []),
        {
          role: 'user',
          content: tokenMarkedContent('PRIMARY PROMPT', scenario.promptTokens),
        },
      ],
      promptBudget: activePromptBudget,
      promptUsageMeasurementPolicy: measurementPolicy,
      contextCompactionPolicy,
      ...(candidateEnabled
        ? {
            contextCompactionCandidate: {
              plan: {
                fingerprint,
                sourceMessageIds: ['primary-system', 'current-user', ...replacedMessageIds],
                replacedMessageIds,
                originalMessageCount: replacedMessageIds.length,
                includedOldSummary: previousSummary !== undefined,
                nextSummarySeq: summarySeq,
                sourceTokenEstimate: 40,
                replacedTokenEstimate: 100,
                replacedToolGroupCount: 1,
                keptToolGroupCount: 2,
                replaceableRangeExhausted:
                  scenario.replaceableRangeExhausted ?? true,
              },
              policy: contextCompactionPolicy,
              reminder: tokenMarkedContent('COMPACTION CONTROL', 3),
            },
          }
        : {}),
    };
  });

  const applyCompaction = vi.fn(async (
    input: GraphExecutorContextApplyInput,
  ): Promise<GraphExecutorContextApplyOutput> => {
    if (options.invalidOutputReason !== undefined) {
      return {
        kind: 'invalid' as const,
        reason: options.invalidOutputReason,
      };
    }
    if (options.ineffectiveRatio !== undefined) {
      return {
        kind: 'ineffective' as const,
        compressionRatio: options.ineffectiveRatio,
        summaryTokenEstimate: 100,
      };
    }
    const scenario = scenarios.find(
      item => (item.fingerprint ?? `plan-${item.summarySeq ?? 1}`) === input.plan.fingerprint,
    ) ?? scenarios[0]!;
    const pendingSummaryEvent = createHistorySummaryEvent(
      input.summaryId,
      input.conversationId,
      input.turnId,
      input.checkpointContent,
      [...input.plan.replacedMessageIds],
      input.plan.originalMessageCount,
      input.plan.nextSummarySeq,
      {
        timestamp: input.timestamp,
        compression_ratio: 0.2,
        included_old_summary: input.plan.includedOldSummary,
      },
    );
    if (options.abortAfterRebuild) {
      options.abortController?.abort();
    }
    return {
      kind: 'ready' as const,
      rebuiltContext: {
        llmMessages: [{
          role: 'user',
          content: tokenMarkedContent('REBUILT PROMPT', scenario.rebuiltTokens ?? 40),
        }],
        promptBudget: activePromptBudget,
        promptUsageMeasurementPolicy: measurementPolicy,
        contextCompactionPolicy,
      },
      pendingSummaryEvent,
      compressionRatio: 0.2,
      summaryTokenEstimate: 20,
    };
  });
  const contextBuilder = { build, applyCompaction } satisfies GraphExecutorContextBuilder;

  const compactionCall = vi.fn(async (
    _modelId: string,
    _messages: LlmRequestMessage[],
    _llmOptions: LlmCallOptions,
    _signal?: AbortSignal,
  ) => {
    order.push('compaction-call');
    if (options.abortController && !options.abortAfterRebuild) {
      options.abortController.abort();
      throw new DOMException('Aborted', 'AbortError');
    }
    if (options.compactionFailure) throw options.compactionFailure;
    return {
      content: `checkpoint-${compactionCall.mock.calls.length}`,
      canonicalUsage: {
        inputTokens: 11,
        outputTokens: 5,
        cacheReadTokens: 7,
        source: 'test-fixture' as const,
        confidence: 'actual' as const,
      },
    };
  });
  let mainCallIndex = 0;
  const mainCall = vi.fn(async (
    _modelId: string,
    _messages: LlmRequestMessage[],
    _llmOptions: LlmCallOptions,
  ) => {
    order.push('main-call');
    const outcome = options.mainOutcomes?.[mainCallIndex] ?? 'done';
    mainCallIndex += 1;
    if (outcome instanceof Error) throw outcome;
    return { content: outcome };
  });
  const tokenizer: TokenizerPort = {
    estimateText: () => 0,
    estimateMessage,
  };
  const schemas = (options.toolNames ?? []).map(toolSchema);
  const executor = new GraphAgentExecutor({
    llmCaller: {
      call: compactionCall,
      callWithRetries: mainCall,
    },
    toolRuntime: {
      getToolSchemas: () => schemas,
      getToolDefinition: () => undefined,
    },
    contextBuilder,
    modelCatalog: {
      getModelById: modelId => ({
        id: modelId,
        enabled: true,
        capabilities: ['chat'],
        inference_route: {
          context_window_tokens: 120,
          max_output_tokens: options.routeMaxOutputTokens ?? 20,
        },
      }),
      getModelsByCapability: () => [],
      getModelsByUIVisibility: () => [],
    },
    modelResolver: { resolveModelId: modelId => modelId ?? 'model' },
    tokenizer,
    telemetryPort: {
      emit: event => telemetryEvents.push(event),
    },
  });
  const eventHandler = vi.fn((event: TickEvent) => {
    if (event.type !== 'history_summary') return;
    order.push('summary-event');
    if (options.publishFailure) throw options.publishFailure;
    publishedSummaries.push(event);
  });
  const summarizationCallbacks = {
    onSummarizationStart: vi.fn(() => order.push('start')),
    onSummarizationEnd: vi.fn(() => order.push('end')),
    onSummarizationError: vi.fn(() => order.push('error')),
  };
  const runtimeEventCommitPort = vi.fn(async (event: RuntimeEvent) => {
    order.push('durable-commit');
    if (options.commitFailure) throw options.commitFailure;
    if (event.type === 'history_summary') committedSummaries.push(event);
  });

  return {
    executor,
    build,
    applyCompaction,
    compactionCall,
    mainCall,
    eventHandler,
    summarizationCallbacks,
    runtimeEventCommitPort,
    tickRuntimeEventCommitPort: options.omitCommitPort
      ? undefined
      : runtimeEventCommitPort,
    telemetryEvents,
    committedSummaries,
    publishedSummaries,
    order,
  };
}

export function runContextCompactionTick(
  harness: ReturnType<typeof createContextCompactionGraphHarness>,
  options: {
    history?: RuntimeEvent[];
    executorLocal?: ExecutorLocalState;
    forceFinalAnswer?: boolean;
    enableTools?: boolean;
    availableTools?: string[];
    signal?: AbortSignal;
  } = {},
) {
  return harness.executor.tick({
    request: {
      query: '继续',
      promptKey: 'default',
      model_id: 'model',
      enableTools: options.enableTools ?? false,
      availableTools: options.availableTools,
    },
    history: options.history ?? [],
    toolContext: {
      conversationId: 'conversation-compaction',
      turnId: 'turn-compaction',
      runId: RunIdSchema.parse('run-compaction'),
    },
    forceFinalAnswer: options.forceFinalAnswer,
    executorLocal: options.executorLocal,
    summarizationCallbacks: harness.summarizationCallbacks,
    runtimeEventCommitPort: harness.tickRuntimeEventCommitPort,
    signal: options.signal,
  }, harness.eventHandler);
}

export function readContextCompactionTelemetry(
  harness: ReturnType<typeof createContextCompactionGraphHarness>,
) {
  return harness.telemetryEvents.filter(event => event.kind === 'context_compaction');
}
