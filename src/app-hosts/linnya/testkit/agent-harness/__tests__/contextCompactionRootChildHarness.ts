import { PromptKeys } from '@app/schemas';
import {
  createHistorySummaryEvent,
  createToolCallDecisionEvent,
  createToolOutputEvent,
  createUserInputEvent,
  DEFAULT_CONTEXT_COMPACTION_POLICY,
  RunIdSchema,
  type RuntimeEvent,
} from 'linnkit/contracts';
import type {
  AgentInvocationRequest,
  CanonicalInferenceMessage,
  LlmRequestMessage,
  TokenizerPort,
} from 'linnkit/ports';
import { childRuns, execution, graph, llm, runSupervisor, tools } from 'linnkit/runtime-kernel';

import { LinnyaRegisteredChildRunLifecycle } from 'src/app-hosts/linnya/adapters/child-runs/childRunLifecycle';
import {
  RegisteredChildRunInvoker,
  type RegisteredChildRunInvokerPort,
} from 'src/app-hosts/linnya/adapters/child-runs/registeredSubagentInvoker';
import { defaultObservationPreviewPort } from 'src/app-hosts/linnya/adapters/tools/defaultPorts';
import { SCRIPTED_MODEL_ID } from 'src/app-hosts/linnya/testkit/agent-harness/modelCatalogHarness';
import { BaseTool, type ToolExecutionContext } from 'src/tools/types';
import { runRegisteredSubagentsInParallel } from 'src/tools/agent_control/subrun/shared';

export const CONVERSATION_ID = 'conversation-context-compaction-root-child';
export const ROOT_RUN_ID = RunIdSchema.parse('root-context-compaction');
export const ROOT_TURN_ID = 'turn-context-compaction-root';

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

function tokenMarkedContent(content: string, tokens: number): string {
  return `${content} [tokens:${tokens}]`;
}

function estimateMessage(message: LlmRequestMessage): number {
  const content =
    'content' in message && typeof message.content === 'string' ? message.content : '';
  const match = /\[tokens:(\d+)\]/u.exec(content);
  return match ? Number(match[1]) : 0;
}

export const tokenizer: TokenizerPort = {
  estimateText: () => 0,
  estimateMessage,
};

export function validCheckpoint(marker: string): string {
  return [
    '<context-checkpoint version="1" trust="untrusted-memory">',
    '## Current Goal',
    `${marker} 当前目标。`,
    '## Hard Constraints',
    `${marker} 约束。`,
    '## Completed Work',
    `${marker} 已完成事实。`,
    '## Key Facts and Evidence',
    `${marker} 证据。`,
    '## Artifacts and External Handles',
    `${marker} 产物。`,
    '## Failures and Lessons',
    `${marker} 无失败。`,
    '## Open Work',
    `${marker} 待办。`,
    '## Next Action',
    `${marker} 下一步事实。`,
    '</context-checkpoint>',
  ].join('\n');
}

export function messageText(messages: readonly CanonicalInferenceMessage[]): string {
  return messages
    .flatMap(message => {
      if (message.role === 'system') return [message.content];
      if (message.role === 'assistant') {
        return message.parts.flatMap(part =>
          part.type === 'tool_call' ? [JSON.stringify(part.call.arguments)] : [part.text]
        );
      }
      return message.content.flatMap(block => (block.type === 'text' ? [block.text] : []));
    })
    .join('\n');
}

export function createCompactionModelCatalog(): llm.ModelCatalogLike {
  const model: llm.ModelCatalogEntry = {
    id: SCRIPTED_MODEL_ID,
    enabled: true,
    api_key: 'scripted-fixture-key',
    capabilities: ['chat'],
    inference_route: {
      context_window_tokens: 120,
      max_output_tokens: 20,
    },
  };
  return {
    getModelById: modelId => (modelId === SCRIPTED_MODEL_ID ? model : undefined),
    getModelsByCapability: capability => (capability === 'chat' ? [model] : []),
    getModelsByUIVisibility: () => [],
  };
}

export function createOldToolHistory(marker: string): RuntimeEvent[] {
  const turnId = `turn-${marker}-old`;
  const toolCallId = `call-${marker}-old`;
  return [
    createUserInputEvent(`${marker}-old-user`, CONVERSATION_ID, turnId, `${marker} old user fact`),
    createToolCallDecisionEvent(
      `${marker}-old-decision`,
      CONVERSATION_ID,
      turnId,
      'old_fact_tool',
      toolCallId
    ),
    createToolOutputEvent(
      `${marker}-old-output`,
      CONVERSATION_ID,
      turnId,
      'old_fact_tool',
      toolCallId,
      {
        status: 'success',
        observation: `${marker} isolated old tool fact`,
        data: { marker },
      }
    ),
  ];
}

export interface ContextHarness {
  readonly builder: graph.GraphExecutorContextBuilder;
  readonly histories: readonly (readonly string[])[];
}

export function createNearThresholdContextHarness(options: {
  marker: string;
  replacedEventId: string;
  compactFirstBuild?: boolean;
}): ContextHarness {
  const histories: string[][] = [];
  let buildCount = 0;

  const builder: graph.GraphExecutorContextBuilder = {
    async build(input) {
      const currentBuild = buildCount;
      buildCount += 1;
      const historyIds = input.history.map(event => event.id);
      histories.push(historyIds);

      if (!historyIds.includes(options.replacedEventId)) {
        throw new Error(`${options.marker} context 缺少自己的旧历史：${options.replacedEventId}`);
      }

      const shouldCompact = options.compactFirstBuild !== false && currentBuild === 0;
      const promptTokens = shouldCompact ? 85 : 40;
      return {
        llmMessages: [
          {
            role: 'user',
            content: tokenMarkedContent(
              `${options.marker} prompt history=${historyIds.join(',')}`,
              promptTokens
            ),
          },
        ],
        promptBudget,
        promptUsageMeasurementPolicy: measurementPolicy,
        contextCompactionPolicy: DEFAULT_CONTEXT_COMPACTION_POLICY,
        ...(shouldCompact
          ? {
              contextCompactionCandidate: {
                plan: {
                  fingerprint: `${options.marker}-plan`,
                  sourceMessageIds: [
                    `${options.marker}-system`,
                    `${options.marker}-current-user`,
                    options.replacedEventId,
                  ],
                  replacedMessageIds: [options.replacedEventId],
                  originalMessageCount: 1,
                  includedOldSummary: false,
                  nextSummarySeq: 1,
                  sourceTokenEstimate: 40,
                  replacedTokenEstimate: 100,
                  replacedToolGroupCount: 1,
                  keptToolGroupCount: 2,
                  replaceableRangeExhausted: true,
                },
                policy: DEFAULT_CONTEXT_COMPACTION_POLICY,
                reminder: tokenMarkedContent(`${options.marker} compaction control`, 3),
              },
            }
          : {}),
      };
    },

    async applyCompaction(input) {
      const pendingSummaryEvent = createHistorySummaryEvent(
        `${options.marker}-summary`,
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
        }
      );
      return {
        kind: 'ready' as const,
        rebuiltContext: {
          llmMessages: [
            {
              role: 'user',
              content: tokenMarkedContent(`${options.marker} rebuilt prompt`, 40),
            },
          ],
          promptBudget,
          promptUsageMeasurementPolicy: measurementPolicy,
          contextCompactionPolicy: DEFAULT_CONTEXT_COMPACTION_POLICY,
        },
        pendingSummaryEvent,
        compressionRatio: 0.2,
        summaryTokenEstimate: 20,
      };
    },
  };

  return { builder, histories };
}

export function createBelowThresholdContextBuilder(
  marker: string
): graph.GraphExecutorContextBuilder {
  return {
    async build(input) {
      return {
        llmMessages: [
          {
            role: 'user',
            content: tokenMarkedContent(
              `${marker} running history=${input.history.map(event => event.id).join(',')}`,
              40
            ),
          },
        ],
        promptBudget,
        promptUsageMeasurementPolicy: measurementPolicy,
        contextCompactionPolicy: DEFAULT_CONTEXT_COMPACTION_POLICY,
      };
    },
    async applyCompaction() {
      throw new Error(`${marker} 不应进入压缩提交阶段`);
    },
  };
}

export function createRootEventHost(options: {
  eventStore: graph.EventStore;
  nextEventStoreId: () => string;
  runId: typeof ROOT_RUN_ID;
}) {
  const sequencer = new execution.EventSequencer(CONVERSATION_ID);
  const eventBus = new execution.EventBus(sequencer.getExecutionId());
  const publisher = new execution.RuntimeEventPublisher(eventBus, sequencer, {
    run_id: options.runId,
    lane: 'foreground',
    visibility: 'conversation',
  });
  const persistence = new execution.EventBusEventPersistence({
    eventBus,
    eventStore: options.eventStore,
    nextEventStoreId: options.nextEventStoreId,
  });
  persistence.connect();

  return {
    eventBus,
    publisher,
    persistence,
    runtimeEventSink: ((event, source) =>
      publisher.publish(event, source)) satisfies graph.RuntimeEventSink,
    runtimeEventCommitPort: (async event => {
      await persistence.commitBeforePublish(publisher.route(event));
    }) satisfies graph.RuntimeEventCommitPort,
  };
}

export function createChildLifecycle(options: {
  supervisor: runSupervisor.DefaultRunSupervisor<AgentInvocationRequest>;
  eventStore: graph.EventStore;
  nextEventStoreId: () => string;
}) {
  return new LinnyaRegisteredChildRunLifecycle({
    supervisor: options.supervisor,
    eventStore: options.eventStore,
    nextEventStoreId: options.nextEventStoreId,
    costCollector: {
      snapshot: () => ({ tokensInput: 0, tokensOutput: 0, latencyMs: 0 }),
    },
  });
}

export function createRegisteredChildInvoker(options: {
  lifecycle: LinnyaRegisteredChildRunLifecycle;
  childRunInvoker: Pick<childRuns.ChildRunInvoker, 'invoke'>;
}): RegisteredChildRunInvokerPort {
  return new RegisteredChildRunInvoker({
    agentResolver: {
      resolveByPromptKey: () => ({
        agentDefinition: {
          id: 'context-compaction-child',
          promptKey: PromptKeys.DEFAULT,
          defaultMode: 'agent',
          description: 'root/child context compaction integration test child',
        },
        agentConfig: {
          id: 'context-compaction-child',
          promptKey: PromptKeys.DEFAULT,
        },
      }),
    },
    childRunInvoker: options.childRunInvoker,
    lifecycle: options.lifecycle,
  });
}

export class RunTwoCompactingChildrenTool extends BaseTool {
  readonly name = 'run_two_compacting_children';
  readonly description = 'Run two deterministic child agents in parallel.';
  readonly parameters = {
    type: 'object' as const,
    properties: {},
    additionalProperties: false,
  };

  results: Awaited<ReturnType<typeof runRegisteredSubagentsInParallel>> = [];

  async run(_args: Record<string, unknown>, context: ToolExecutionContext): Promise<string> {
    this.results = await runRegisteredSubagentsInParallel({
      context,
      maxConcurrency: 2,
      subruns: [
        {
          promptKey: PromptKeys.DEFAULT,
          description: 'child a',
          userMessage: 'child-a-task',
          inheritTurns: 1,
          maxSteps: 4,
          modelId: SCRIPTED_MODEL_ID,
          subrunSource: 'test:context-compaction:child-a',
          subrunMetadata: { marker: 'child-a' },
          subrunId: 'child-a',
        },
        {
          promptKey: PromptKeys.DEFAULT,
          description: 'child b',
          userMessage: 'child-b-task',
          inheritTurns: 1,
          maxSteps: 4,
          modelId: SCRIPTED_MODEL_ID,
          subrunSource: 'test:context-compaction:child-b',
          subrunMetadata: { marker: 'child-b' },
          subrunId: 'child-b',
        },
      ],
    });

    return JSON.stringify({
      childA: this.results[0]?.finalAnswer,
      childB: this.results[1]?.finalAnswer,
    });
  }
}

export function createRootGraph(options: {
  llmNode: graph.GraphNode;
  toolRuntime: tools.ToolRuntimePort;
  maxSteps?: number;
}): graph.GraphExecutor {
  const executor = new graph.GraphExecutor(new graph.MemoryCheckpointer(), {
    maxSteps: options.maxSteps ?? 8,
  });
  executor.registerNode(options.llmNode);
  executor.registerNode(
    new graph.ToolNode({
      toolRuntime: options.toolRuntime,
      observationPreview: defaultObservationPreviewPort,
    })
  );
  executor.registerNode(new graph.WaitUserNode());
  return executor;
}

export function createLatch() {
  let release!: () => void;
  const promise = new Promise<void>(resolve => {
    release = resolve;
  });
  return { promise, release };
}

export function waitUntilAborted(
  signal: AbortSignal | undefined,
  started: ReturnType<typeof createLatch>
) {
  started.release();
  if (!signal) {
    return Promise.reject(new Error('测试调用缺少 AbortSignal'));
  }
  if (signal.aborted) {
    return Promise.reject(new DOMException('Aborted', 'AbortError'));
  }
  return new Promise<never>((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), {
      once: true,
    });
  });
}
