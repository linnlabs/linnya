import type { AgentInvocationRequest } from '../../ports';
import type { ExecutorLocalState, GraphNode, RuntimeEventSink } from '../graph-engine/types';
import type { LlmCaller } from '../llm/caller';
import type {
  ObservationPreviewPort,
  ToolExecutionContext,
  ToolModelInputCapabilityValidatorPort,
  ToolModelInputResolverPort,
  ToolRuntimePort,
} from '../tools';
import {
  type RoutedRuntimeEvent,
  type RuntimeEvent,
} from '../../contracts';
import { createDefaultGraphExecutor } from './defaultGraphExecutor';
import type { AuditPort } from '../../ports';
import type { TelemetryPort } from '../telemetry/telemetryPort';

export interface GraphLoopLlmNodeFactoryParams {
  llmCaller: LlmCaller;
  toolRuntime: ToolRuntimePort;
}

export interface GraphLoopHarnessOptions {
  conversationId: string;
  turnId: string;
  /** Graph checkpoint 身份；不传时测试 harness 以单次 turnId 作为 run-scoped key。 */
  runId?: string;
  query: string;
  request: AgentInvocationRequest;
  toolContext: ToolExecutionContext;
  llmCaller: LlmCaller;
  toolRuntime: ToolRuntimePort;
  observationPreview: ObservationPreviewPort;
  createLlmNode: (params: GraphLoopLlmNodeFactoryParams) => GraphNode;
  executorLocal?: ExecutorLocalState;
  history?: RuntimeEvent[];
  maxSteps?: number;
  signal?: AbortSignal;
  auditPort?: AuditPort;
  telemetryPort?: TelemetryPort;
  modelInputCapabilityValidator?: ToolModelInputCapabilityValidatorPort;
  modelInputResolver?: ToolModelInputResolverPort;
  /** Host/testkit 装配提供的唯一 RuntimeEvent admission/publish 入口。 */
  runtimeEventSink: RuntimeEventSink;
}

export interface GraphLoopHarnessRunResult {
  checkpointNodeId: string;
  stepCount: number;
  events: RoutedRuntimeEvent[];
}

export interface GraphLoopHarness {
  run(): Promise<GraphLoopHarnessRunResult>;
}

function buildUserInputEvent(params: {
  conversationId: string;
  turnId: string;
  query: string;
}): RuntimeEvent {
  return {
    type: 'user_input',
    id: `user_${params.turnId}`,
    conversation_id: params.conversationId,
    turn_id: params.turnId,
    timestamp: Date.now(),
    version: 1,
    content: params.query,
    source: 'user',
  };
}

export function createGraphLoopHarness(options: GraphLoopHarnessOptions): GraphLoopHarness {
  const maxSteps = options.maxSteps ?? 8;
  const executorLocal: ExecutorLocalState = {
    stepCount: 0,
    ...(options.executorLocal ?? {}),
  };

  return {
    async run(): Promise<GraphLoopHarnessRunResult> {
      const checkpointKey = options.runId ?? options.turnId;
      const executor = createDefaultGraphExecutor({
        llmNode: options.createLlmNode({
          llmCaller: options.llmCaller,
          toolRuntime: options.toolRuntime,
        }),
        toolRuntime: options.toolRuntime,
        observationPreview: options.observationPreview,
        maxSteps,
        auditPort: options.auditPort,
        telemetryPort: options.telemetryPort,
        modelInputCapabilityValidator: options.modelInputCapabilityValidator,
        modelInputResolver: options.modelInputResolver,
      });

      const local = {
        conversationId: options.conversationId,
        turnId: options.turnId,
        request: options.request,
        toolContext: options.toolContext,
        history: options.history ?? [],
        newEvents: [
          buildUserInputEvent({
            conversationId: options.conversationId,
            turnId: options.turnId,
            query: options.query,
          }),
        ],
        runtimeEventSink: options.runtimeEventSink,
        signal: options.signal ?? options.toolContext.abortSignal,
        executorLocal,
      };

      await executor.prime(checkpointKey, local, 'user');
      const result = await executor.runUntilYield(checkpointKey);

      return {
        checkpointNodeId: result.checkpoint.nodeId,
        stepCount: result.stepCount,
        events: result.events,
      };
    },
  };
}
