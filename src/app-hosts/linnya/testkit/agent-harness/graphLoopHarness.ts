import { PromptKeys } from '@app/schemas';

import { runtimeKernel } from '@linnlabs/linnkit';
import * as testkit from '@linnlabs/linnkit/testkit';
import type {
  GraphLoopHarness as PublicGraphLoopHarness,
  ScriptedInferenceHarness,
  ScriptedLlmTurn,
  ToolContextFixtureOptions,
} from '@linnlabs/linnkit/testkit';
import { BaseTool } from 'src/tools/types';
import { createDefaultLlmNode } from 'src/app-hosts/linnya/adapters/runtime-assembly/graphRuntimeFactory';
import { defaultObservationPreviewPort } from 'src/app-hosts/linnya/adapters/tools/defaultPorts';
import {
  createToolRuntimeHarness,
  type ToolRuntimeHarness,
} from 'src/app-hosts/linnya/testkit/agent-harness/toolRegistryHarness';
import type { RoutedRuntimeEvent, RuntimeEvent } from '@linnlabs/linnkit/contracts';
import type {
  AuditPort,
  LlmImageInputEstimatorPort,
  LlmInputMaterializerPort,
} from '@linnlabs/linnkit/ports';
import type { telemetry } from '@linnlabs/linnkit/runtime-kernel';
import { createToolModelInputCapabilityValidator } from 'src/app-hosts/linnya/adapters/tools/modelInputCapabilityValidator';
import { RunIdSchema } from '@linnlabs/linnkit/contracts';
import {
  createScriptedChatModelCatalog,
  SCRIPTED_MODEL_ID,
} from './modelCatalogHarness';

type PublicGraphLoopOptions = Parameters<typeof testkit.createGraphLoopHarness>[0];

export interface GraphLoopHarnessOptions {
  turns: ScriptedLlmTurn[];
  tools: BaseTool[];
  query?: string;
  conversationId?: string;
  turnId?: string;
  maxSteps?: number;
  history?: RuntimeEvent[];
  requestPatch?: Partial<PublicGraphLoopOptions['request']>;
  executorLocalPatch?: Partial<NonNullable<PublicGraphLoopOptions['executorLocal']>>;
  toolContextPatch?: ToolContextFixtureOptions['patch'];
  signal?: AbortSignal;
  installSubrunTracePublisher?: boolean;
  auditPort?: AuditPort;
  telemetryPort?: telemetry.TelemetryPort;
  modelInput?: GraphLoopModelInputFixture;
}

export interface GraphLoopModelInputFixture {
  modelCatalog: runtimeKernel.llm.ModelCatalogLike;
  imageInputEstimator: LlmImageInputEstimatorPort;
  llmInputMaterializer: LlmInputMaterializerPort;
  toolModelInputResolver: runtimeKernel.tools.ToolModelInputResolverPort;
}

export interface GraphLoopHarnessRunResult {
  events: RoutedRuntimeEvent[];
  checkpointNodeId: string;
  stepCount: number;
}

export interface GraphLoopHarness {
  run(): Promise<GraphLoopHarnessRunResult>;
  getLlmCalls(): ReturnType<ScriptedInferenceHarness['getCalls']>;
  getToolExecutions(): ReturnType<ToolRuntimeHarness['getExecutions']>;
  getSinkRuntimeEvents(): RoutedRuntimeEvent[];
  assertAllTurnsConsumed(): void;
  restore(): void;
}

export function createGraphLoopHarness(options: GraphLoopHarnessOptions): GraphLoopHarness {
  const conversationId = options.conversationId ?? 'conv_graph_loop_test';
  const turnId = options.turnId ?? 'turn_graph_loop_test';
  const query = options.query ?? '请执行这个测试任务';
  const maxSteps = options.maxSteps ?? 8;
  const modelCatalog = options.modelInput?.modelCatalog ?? createScriptedChatModelCatalog();
  const modelResolver = new runtimeKernel.llm.ModelResolver({ modelCatalog });
  const aiHarness = testkit.createScriptedInferenceHarness(options.turns, {
    modelCatalog,
    llmInputMaterializer: options.modelInput?.llmInputMaterializer,
  });
  const toolHarness = createToolRuntimeHarness(options.tools);
  const sequencer = new runtimeKernel.execution.EventSequencer(conversationId);
  const eventBus = new runtimeKernel.execution.EventBus(sequencer.getExecutionId());
  const runtimeEventPublisher = new runtimeKernel.execution.RuntimeEventPublisher(
    eventBus,
    sequencer,
    {
      run_id: RunIdSchema.parse(turnId),
      lane: 'foreground',
      visibility: 'conversation',
    }
  );
  const runtimeEventSink: runtimeKernel.graph.RuntimeEventSink = (event, source) =>
    runtimeEventPublisher.publish(event, source);

  const toolContext = testkit.createToolContextFixture({
    conversationId,
    turnId,
    historyEvents: options.history ?? [],
    patch: {
      abortSignal: options.signal ?? new AbortController().signal,
      ...(options.installSubrunTracePublisher
        ? {
            createSubRunTracePublisher: publisherOptions =>
              new runtimeKernel.childRunTrace.RuntimeEventSubRunTracePublisher({
                runtimeEventSink,
                conversationId,
                turnId,
                parentToolCallId: publisherOptions.parentToolCallId,
                subrunId: publisherOptions.subrunId,
                subrunParentId: publisherOptions.subrunParentId,
                source: publisherOptions.source,
                metadata: publisherOptions.metadata,
              }),
          }
        : {}),
      ...(options.toolContextPatch ?? {}),
    },
  });

  const request: PublicGraphLoopOptions['request'] = {
    query,
    promptKey: PromptKeys.DEFAULT,
    model_id: SCRIPTED_MODEL_ID,
    maxSteps,
    enableTools: options.tools.length > 0,
    availableTools: options.tools.map(tool => tool.name),
    ...(options.requestPatch ?? {}),
  };

  const executorLocal: NonNullable<PublicGraphLoopOptions['executorLocal']> = {
    stepCount: 0,
    ...(options.executorLocalPatch ?? {}),
  };

  const graphHarness: PublicGraphLoopHarness = testkit.createGraphLoopHarness({
    conversationId,
    turnId,
    query,
    maxSteps,
    request,
    toolContext,
    llmCaller: aiHarness.getLlmCaller(),
    toolRuntime: toolHarness.toolRuntime,
    observationPreview: defaultObservationPreviewPort,
    createLlmNode: ({ llmCaller, toolRuntime }) =>
      createDefaultLlmNode({
        llmCaller,
        toolRuntime,
        modelCatalog,
        modelResolver,
        llmImageInputEstimator: options.modelInput?.imageInputEstimator,
        auditPort: options.auditPort,
        telemetryPort: options.telemetryPort,
      }),
    executorLocal,
    history: options.history ?? [],
    auditPort: options.auditPort,
    telemetryPort: options.telemetryPort,
    modelInputCapabilityValidator: options.modelInput
      ? createToolModelInputCapabilityValidator(options.modelInput.modelCatalog)
      : undefined,
    modelInputResolver: options.modelInput?.toolModelInputResolver,
    runtimeEventSink,
    signal: options.signal,
  });

  return {
    async run(): Promise<GraphLoopHarnessRunResult> {
      const result = await graphHarness.run();
      return {
        events: runtimeEventPublisher.getGeneratedEvents(),
        checkpointNodeId: result.checkpointNodeId,
        stepCount: result.stepCount,
      };
    },
    getLlmCalls() {
      return aiHarness.getCalls();
    },
    getToolExecutions() {
      return toolHarness.getExecutions();
    },
    getSinkRuntimeEvents(): RoutedRuntimeEvent[] {
      return runtimeEventPublisher.getGeneratedEvents();
    },
    assertAllTurnsConsumed(): void {
      aiHarness.assertAllTurnsConsumed();
    },
    restore(): void {
      toolHarness.restore();
    },
  };
}
