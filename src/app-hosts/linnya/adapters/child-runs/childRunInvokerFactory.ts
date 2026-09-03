import type { AgentDefinition } from 'src/app-hosts/linnya/agent-registry/types';
import { agentUtils } from 'linnkit/context-manager';
import { childRuns, graph, llm, telemetry, tools } from 'linnkit/runtime-kernel';
import type {
  AuditPort,
  LlmImageInputEstimatorPort,
  LlmInputMaterializerPort,
} from 'linnkit/ports';
import {
  createDefaultLlmNode,
  createDefaultModelResolver,
  type DefaultGraphRuntimeLlmCaller,
} from 'src/app-hosts/linnya/adapters/runtime-assembly/graphRuntimeFactory';
import {
  defaultObservationPreviewPort,
  defaultToolRuntimePort,
} from 'src/app-hosts/linnya/adapters/tools/defaultPorts';
import { createToolModelInputCapabilityValidator } from 'src/app-hosts/linnya/adapters/tools/modelInputCapabilityValidator';
import type { RuntimeEvent } from 'linnkit/contracts';

export interface LinnyaChildRunInvokerDependencies {
  telemetryPort: telemetry.TelemetryPort;
  auditPort: AuditPort;
  llmInputMaterializer?: LlmInputMaterializerPort;
  modelInputResolver?: tools.ToolModelInputResolverPort;
  modelResolver?: llm.ModelResolver;
  modelCatalog?: llm.ModelCatalogLike;
  llmCaller?: DefaultGraphRuntimeLlmCaller;
  createLlmNode?: () => graph.GraphNode;
  toolRuntime?: Pick<tools.ToolRuntimePort, 'getToolDefinition' | 'executeTool'>;
  observationPreview?: tools.ObservationPreviewPort;
  modelInputCapabilityValidator?: tools.ToolModelInputCapabilityValidatorPort;
  llmImageInputEstimator?: LlmImageInputEstimatorPort;
  eventToMessageConverter?: (events: RuntimeEvent[]) => unknown[];
  defaultJudgeToolName?: string;
}

export function toChildRunAgentConfig(agentDefinition: AgentDefinition): childRuns.ChildRunAgentConfig {
  const systemReminderPolicy = agentDefinition.config?.contextPolicy?.systemReminder;

  return {
    id: agentDefinition.id,
    promptKey: agentDefinition.promptKey,
    availableTools: agentDefinition.config?.availableTools,
    modelPolicy:
      agentDefinition.config?.modelPolicy?.kind === 'fixed'
        ? { kind: 'fixed', modelId: agentDefinition.config.modelPolicy.modelId }
        : undefined,
    stepPolicy: agentDefinition.config?.stepPolicy
      ? {
          kind: agentDefinition.config.stepPolicy.kind,
          lastStepsHintThreshold: agentDefinition.config.stepPolicy.lastStepsHintThreshold,
          forcedTools: agentDefinition.config.stepPolicy.forcedTools,
        }
      : undefined,
    ...(agentDefinition.config?.contextPolicy ? { contextPolicy: agentDefinition.config.contextPolicy } : {}),
    ...(systemReminderPolicy ? { systemReminderPolicy } : {}),
    systemPromptBuilder: agentDefinition.task?.systemPromptBuilder,
  };
}

/**
 * 当前 Linnya 宿主对 child-run runtime 的默认装配。
 *
 * 中文备注：
 * - 原 `core/graph-engine/internal/index.ts` facade 已退役；
 * - 真正的默认 model resolver / llm node / event converter 装配显式留在 host layer；
 * - 调用方若要定制，可直接覆写这里的依赖，而不是继续往 compatibility facade 塞逻辑。
 */
export function createLinnyaChildRunInvoker(
  dependencies: LinnyaChildRunInvokerDependencies,
): childRuns.ChildRunInvoker {
  const modelResolver = dependencies.modelResolver ?? createDefaultModelResolver();
  const telemetryPort = dependencies.telemetryPort;
  const auditPort = dependencies.auditPort;

  return new childRuns.ChildRunInvoker({
    modelResolver,
    createLlmNode: dependencies.createLlmNode ?? (() => createDefaultLlmNode({
      modelResolver,
      modelCatalog: dependencies.modelCatalog,
      llmCaller: dependencies.llmCaller,
      telemetryPort,
      auditPort,
      llmInputMaterializer: dependencies.llmInputMaterializer,
      llmImageInputEstimator: dependencies.llmImageInputEstimator,
    })),
    toolRuntime: dependencies.toolRuntime ?? defaultToolRuntimePort,
    observationPreview: dependencies.observationPreview ?? defaultObservationPreviewPort,
    modelInputCapabilityValidator: dependencies.modelInputCapabilityValidator
      ?? createToolModelInputCapabilityValidator(dependencies.modelCatalog),
    modelInputResolver: dependencies.modelInputResolver,
    eventToMessageConverter: dependencies.eventToMessageConverter ?? agentUtils.convertEventsToAiMessages,
    defaultJudgeToolName: dependencies.defaultJudgeToolName ?? 'assemble_documents',
    telemetryPort,
    auditPort,
  });
}
