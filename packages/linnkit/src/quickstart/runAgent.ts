import {
  createUserInputEvent,
  toSerializableJsonRecord,
  type RoutedRuntimeEvent,
  type RuntimeEvent,
  type RuntimeEventRoutingIdentity,
  type SerializableJsonRecord,
  generateConversationId,
  generateRunId,
  RunIdSchema,
  generateRuntimeEventId,
  generateTurnId,
} from '../contracts';
import {
  GraphAgentExecutor,
  LlmCaller,
  LlmNode,
  MemoryCheckpointer,
  type ObservationPreviewPort,
  type ToolExecutionContext,
  createDefaultGraphExecutor,
  createFixedChatModelCatalog,
  events,
  execution,
  graph,
  events as runtimeEvents,
  runSupervisor,
} from '../runtime-kernel';
import type { DefinedAgent, RunAgentOptions, RunAgentResult } from './types';
import { QuickstartContextBuilder } from './contextBuilder';
import { resolveQuickstartMaxSteps } from './functions/contextTrace';
import { QuickstartMemoryToolRuntime } from './toolRuntime';
import { QuickstartRunCostCollector, createQuickstartTelemetryPort } from './runCost';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function resolveModelId(agent: DefinedAgent, options: RunAgentOptions): string {
  const modelId = readString(options.modelId) ?? readString(agent.modelId);
  if (!modelId) {
    throw new Error(
      '[linnkit] runAgent requires modelId. Pass opts.modelId or defineAgent({ modelId }).'
    );
  }
  return modelId;
}

function createNoopObservationPreview(): ObservationPreviewPort {
  return {
    async truncateObservation(params) {
      return { truncated: false, preview: params.text };
    },
  };
}

function readFinalAnswer(events: RuntimeEvent[], checkpointLocal: unknown): string {
  const finalAnswerEvent = runtimeEvents.findTerminalFinalAnswer(events);
  if (finalAnswerEvent) {
    return finalAnswerEvent.content;
  }

  if (isRecord(checkpointLocal)) {
    const finalAnswer = checkpointLocal['finalAnswer'];
    if (typeof finalAnswer === 'string') {
      return finalAnswer;
    }
  }

  return '';
}

function readContextTrace(checkpointLocal: unknown): SerializableJsonRecord | undefined {
  if (!isRecord(checkpointLocal)) return undefined;
  return toSerializableJsonRecord(checkpointLocal['contextTrace']);
}

async function emitRunEvent(
  event: RoutedRuntimeEvent,
  sink: RunAgentOptions['onEvent']
): Promise<void> {
  await sink?.(event);
}

/**
 * 运行一个 quickstart agent。
 *
 * 中文备注：
 * - 这个 helper 用于“npm install 后立即跑通”的最小体验；
 * - 生产 host 仍应自行装配 EventStore / ToolRuntime / ContextManager / RunSupervisor。
 */
export async function runAgent(
  agent: DefinedAgent,
  options: RunAgentOptions
): Promise<RunAgentResult> {
  const modelId = resolveModelId(agent, options);
  const maxSteps = resolveQuickstartMaxSteps(options.maxSteps);
  const conversationId = options.conversationId ?? generateConversationId();
  const runId = RunIdSchema.parse(options.runId ?? generateRunId());
  const checkpointKey = runId;
  const turnId = generateTurnId();
  const routingIdentity: RuntimeEventRoutingIdentity = {
    run_id: runId,
    lane: 'foreground',
    visibility: 'conversation',
  };
  const costCollector = new QuickstartRunCostCollector();
  const telemetryPort = createQuickstartTelemetryPort(costCollector);
  const toolRuntime = new QuickstartMemoryToolRuntime(agent.tools);
  const eventStore = new graph.MemoryEventStore();
  const sequencer = new execution.EventSequencer(conversationId);
  const eventBus = new execution.EventBus(sequencer.getExecutionId());
  const publisher = new execution.RuntimeEventPublisher(eventBus, sequencer, routingIdentity);
  const nextEventStoreId = graph.createMonotonicEventStoreIdFactory();
  const registryStore = new runSupervisor.MemoryRunRegistryStore();
  const supervisor = new runSupervisor.DefaultRunSupervisor({
    registryStore,
  });

  const handle = await supervisor.registerRun({
    runId,
    parentSignal: options.signal,
    conversationId,
    agentSpec: agent.spec,
    request: { query: options.input, promptKey: agent.spec.id, model_id: modelId },
    eventBus,
    eventStore,
    costCollector,
  });

  const llmCaller = new LlmCaller({
    inferencePort: options.inference,
    modelCatalog: createFixedChatModelCatalog(modelId),
    maxRetries: 0,
    enableEmptyResponseRetry: false,
  });
  const reasoner = new GraphAgentExecutor({
    llmCaller,
    toolRuntime,
    contextBuilder: new QuickstartContextBuilder(agent),
    telemetryPort,
  });
  const executor = createDefaultGraphExecutor({
    llmNode: new LlmNode({ reasoner }),
    toolRuntime,
    observationPreview: createNoopObservationPreview(),
    checkpointer: new MemoryCheckpointer(),
    telemetryPort,
    maxSteps,
  });

  const runtimeEvents: RoutedRuntimeEvent[] = [];
  let callbackTail: Promise<void> = Promise.resolve();
  let persistenceTail: Promise<void> = Promise.resolve();
  eventBus.on('event', envelope => {
    const event = envelope.payload;
    runtimeEvents.push(event);
    callbackTail = callbackTail.then(() => emitRunEvent(event, options.onEvent));
    if (events.shouldPersistRuntimeEvent(event)) {
      persistenceTail = persistenceTail.then(() =>
        eventStore.append({
          eventStoreId: nextEventStoreId(),
          event,
        })
      );
    }
  });
  publisher.publish(
    createUserInputEvent(generateRuntimeEventId(), conversationId, turnId, options.input),
    'Quickstart.user_input'
  );
  const toolContext: ToolExecutionContext = {
    runId,
    conversationId,
    turnId,
    abortSignal: handle.signal,
  };

  await handle.markRunning({ currentNode: 'user' });
  try {
    await executor.prime(checkpointKey, {
      conversationId,
      turnId,
      request: {
        query: options.input,
        promptKey: agent.spec.id,
        model_id: modelId,
        maxSteps,
        enableTools: agent.tools.length > 0,
        availableTools: agent.tools.map(tool => tool.name),
      },
      history: [],
      newEvents: [...runtimeEvents],
      toolContext,
      signal: handle.signal,
      runtimeEventSink: (event: RuntimeEvent, source: string) => publisher.publish(event, source),
    });
    const result = await executor.runUntilYield(checkpointKey);
    await Promise.all([callbackTail, persistenceTail]);
    await handle.markCompleted({
      currentNode: result.checkpoint.nodeId,
      iterationsUsed: result.stepCount,
    });
    return {
      runId,
      finalAnswer: readFinalAnswer(runtimeEvents, result.checkpoint.local),
      events: runtimeEvents,
      cost: await handle.cost(),
      contextTrace: readContextTrace(result.checkpoint.local),
    };
  } catch (error) {
    await handle.markFailed({
      errorCode: 'RUN_FAILED',
      message: error instanceof Error ? error.message : String(error),
      recoverable: false,
    });
    throw error;
  } finally {
    eventBus.close();
  }
}
