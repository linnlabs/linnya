import { runtimeKernel } from 'linnkit';
import {
  agentConfig,
  agentOrchestration,
  agentPreprocessors,
  agentTasks,
  agentTools,
  contextPolicyToProviderOptions,
  formatAgentLlmMessages,
  mergeContextPolicy,
} from 'linnkit/context-manager';
import { createDefaultAgentProviderRegistry } from 'src/app-hosts/linnya/context-policies/defaultAgentProviderRegistry';
import { LINNYA_CONTEXT_POLICY_FALLBACK } from 'src/app-hosts/linnya/context-policies/defaultContextPolicy';
import { getAgentTask } from 'src/app-hosts/linnya/agent-registry/agentTaskResolver';
import { findRegisteredAgentDefinitionByPromptKey } from 'src/app-hosts/linnya/agent-registry/agentDefinitionResolver';
import { createDefaultToolManager } from 'src/app-hosts/linnya/adapters/tools/defaultToolManager';
import { recordAfterContextManager } from 'src/domains/audit/features/llm-run-audit';
import type { AgentInvokeRequest } from 'src/app-hosts/linnya/context/agent/contracts';
import { withLinnyaFenceInjections } from 'src/app-hosts/linnya/context/agent/createLinnyaFenceInjections';
import { linnyaFenceRegistry } from 'src/app-hosts/linnya/context/agent/registerLinnyaFences';
import type {
  AiMessage,
  ContextBuildTokenEstimate,
  ContextTokenComponent,
  TokenRoute,
} from 'linnkit/contracts';
import {
  ContextTokenComponent as ContextTokenComponentSchema,
} from 'linnkit/contracts';
import type { AgentSpecContextPolicy } from 'linnkit/contracts';
import type {
  CanonicalInferenceCachePolicy,
  ImageInputAdmissionEvidence,
  LlmImageInputEstimatorPort,
  TokenCounterPort,
  TokenizerPort,
} from 'linnkit/ports';
import type { LinnyaTokenCalibrationCollector } from 'src/app-hosts/linnya/adapters/token-accounting';
import { modelCatalog } from 'src/domains/model-catalog';

type GraphExecutorContextBuildInput = runtimeKernel.graph.GraphExecutorContextBuildInput;
type GraphExecutorContextBuildOutput = runtimeKernel.graph.GraphExecutorContextBuildOutput;
type GraphExecutorContextBuilder = runtimeKernel.graph.GraphExecutorContextBuilder;
type AgentTaskResolver = agentTasks.AgentTaskResolver;
type ToolReplayProtocolPolicy = agentPreprocessors.ToolReplayProtocolPolicy;

export function resolveDefaultToolReplayProtocolPolicyForModel(modelId: string): ToolReplayProtocolPolicy | undefined {
  const modelConfig = modelCatalog.getModel(modelId);
  const route = modelConfig?.inference_route;
  if (route?.continuation.tool_replay !== 'required') {
    return undefined;
  }

  return {
    provider: route.endpoint_id,
    requiresProviderContinuationForToolReplay: true,
  };
}

function readContextTrace(contextBuildResult: unknown): unknown {
  if (!isRecord(contextBuildResult)) {
    return undefined;
  }
  return contextBuildResult.contextTrace;
}

function readTokenEstimate(contextBuildResult: unknown): ContextBuildTokenEstimate | undefined {
  if (!isRecord(contextBuildResult)) {
    return undefined;
  }
  const candidate = contextBuildResult.tokenEstimate;
  return isContextBuildTokenEstimate(candidate) ? candidate : undefined;
}

function readTokenComponents(contextBuildResult: unknown): ContextTokenComponent[] | undefined {
  if (!isRecord(contextBuildResult) || !Array.isArray(contextBuildResult.tokenComponents)) {
    return undefined;
  }
  const parsed: ContextTokenComponent[] = [];
  for (const component of contextBuildResult.tokenComponents) {
    const result = ContextTokenComponentSchema.safeParse(component);
    if (result.success) {
      parsed.push(result.data);
    }
  }
  return parsed.length > 0 ? parsed : undefined;
}

function readImageInputAdmissionEvidence(
  contextBuildResult: unknown,
): ImageInputAdmissionEvidence | undefined {
  if (!isRecord(contextBuildResult) || !isRecord(contextBuildResult.imageInputAdmissionEvidence)) {
    return undefined;
  }
  const evidence = contextBuildResult.imageInputAdmissionEvidence;
  if (
    typeof evidence.inputBudget !== 'number' ||
    typeof evidence.nonImageEstimatedTokens !== 'number' ||
    typeof evidence.initialProfileId !== 'string' ||
    !Array.isArray(evidence.attachments)
  ) {
    return undefined;
  }

  const attachments: ImageInputAdmissionEvidence['attachments'][number][] = [];
  for (const attachment of evidence.attachments) {
    if (
      !isRecord(attachment) ||
      typeof attachment.messageIndex !== 'number' ||
      typeof attachment.attachmentIndex !== 'number' ||
      typeof attachment.id !== 'string' ||
      typeof attachment.resourceId !== 'string' ||
      (attachment.placement !== 'user_image' && attachment.placement !== 'tool_result_image') ||
      typeof attachment.estimatedTokens !== 'number'
    ) {
      return undefined;
    }
    attachments.push({
      messageIndex: attachment.messageIndex,
      attachmentIndex: attachment.attachmentIndex,
      id: attachment.id,
      resourceId: attachment.resourceId,
      placement: attachment.placement,
      estimatedTokens: attachment.estimatedTokens,
    });
  }

  return {
    inputBudget: evidence.inputBudget,
    nonImageEstimatedTokens: evidence.nonImageEstimatedTokens,
    initialProfileId: evidence.initialProfileId,
    attachments,
  };
}

function isContextBuildTokenEstimate(value: unknown): value is ContextBuildTokenEstimate {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.localEstimateTokens === 'number' &&
    typeof value.calibratedEstimateTokens === 'number' &&
    typeof value.finalTokens === 'number' &&
    value.source === 'local-estimate' &&
    value.confidence === 'estimate'
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function resolveTokenRouteByModelId(modelId: string): TokenRoute | undefined {
  const model = modelCatalog.getModel(modelId);
  return model?.token_route;
}

export interface DefaultGraphExecutorContextBuilderDependencies {
  agentOrchestrator?: agentOrchestration.AgentMessageOrchestrator;
  toolManager?: agentTools.ToolManager;
  agentTaskResolver?: AgentTaskResolver;
  tokenizer?: TokenizerPort;
  tokenCounter?: TokenCounterPort;
  imageInputEstimator?: LlmImageInputEstimatorPort;
  tokenCalibrationCollector?: LinnyaTokenCalibrationCollector;
  resolveModelInferenceRoute?: (
    modelId: string,
  ) => runtimeKernel.llm.ModelCatalogEntry['inference_route'];
  resolveTokenRoute?: (modelId: string) => TokenRoute | undefined;
}

interface ResolvedDefaultGraphExecutorContextBuilderDependencies {
  agentOrchestrator: agentOrchestration.AgentMessageOrchestrator;
  toolManager: agentTools.ToolManager;
  agentTaskResolver: AgentTaskResolver;
  resolveModelInferenceRoute: (
    modelId: string,
  ) => runtimeKernel.llm.ModelCatalogEntry['inference_route'];
}

function createDefaultTokenBudget() {
  return {
    maxTokens: agentConfig.DEFAULT_AGENT_CONFIG.tokenBudget.maxTokens,
    reservedForResponse: agentConfig.DEFAULT_AGENT_CONFIG.tokenBudget.reservedForResponse,
  };
}

function resolveRegisteredContextPolicy(promptKey: string): AgentSpecContextPolicy | undefined {
  const registeredPolicy = findRegisteredAgentDefinitionByPromptKey(promptKey)?.config?.contextPolicy;

  return mergeContextPolicy({
    hostFallback: LINNYA_CONTEXT_POLICY_FALLBACK,
    agentSpec: registeredPolicy,
  });
}

function resolveDefaultGraphExecutorContextBuilderDependencies(
  dependencies: DefaultGraphExecutorContextBuilderDependencies,
): ResolvedDefaultGraphExecutorContextBuilderDependencies {
  const tokenBudget = createDefaultTokenBudget();
  const resolveTokenRoute = dependencies.resolveTokenRoute ?? resolveTokenRouteByModelId;

  return {
    agentOrchestrator:
      dependencies.agentOrchestrator ??
      new agentOrchestration.AgentMessageOrchestrator({
        tokenBudget,
        processing: { debugMode: false, preserveMetadata: true },
        taskResolver: dependencies.agentTaskResolver ?? getAgentTask,
        providerRegistry: createDefaultAgentProviderRegistry({
          providerOptions: contextPolicyToProviderOptions(
            mergeContextPolicy({ hostFallback: LINNYA_CONTEXT_POLICY_FALLBACK }),
          ),
        }),
        fenceRegistry: linnyaFenceRegistry,
        tokenizer: dependencies.tokenizer,
        tokenCounter: dependencies.tokenCounter,
        imageInputEstimator: dependencies.imageInputEstimator,
        resolveToolReplayProtocolPolicy: ({ modelId }) => resolveDefaultToolReplayProtocolPolicyForModel(modelId),
        resolveContextPolicy: (request) => resolveRegisteredContextPolicy(request.promptKey),
        resolveTokenRoute: ({ modelId }) => resolveTokenRoute(modelId),
        resolveTokenCalibration: ({ modelId }) => {
          const route = resolveTokenRoute(modelId);
          if (!route) {
            return undefined;
          }
          return {
            route,
            samples: dependencies.tokenCalibrationCollector?.getSamples(route) ?? [],
          };
        },
        createProviderRegistry: ({ contextPolicy, contextBuilderConfig }) =>
          createDefaultAgentProviderRegistry({
            customConfig: contextBuilderConfig,
            providerOptions: contextPolicyToProviderOptions(contextPolicy),
          }),
      }),
    toolManager: dependencies.toolManager ?? createDefaultToolManager(),
    agentTaskResolver: dependencies.agentTaskResolver ?? getAgentTask,
    resolveModelInferenceRoute:
      dependencies.resolveModelInferenceRoute
      ?? (modelId => modelCatalog.getModel(modelId)?.inference_route),
  };
}

export function createDefaultGraphExecutorContextBuilder(
  dependencies: DefaultGraphExecutorContextBuilderDependencies,
): DefaultGraphExecutorContextBuilder {
  return new DefaultGraphExecutorContextBuilder(
    resolveDefaultGraphExecutorContextBuilderDependencies(dependencies),
  );
}

/**
 * 默认上下文构建器属于宿主默认实现，不应继续被当作 runtime kernel 的一部分。
 *
 * 中文备注：
 * - 类本身只消费“已解析好的宿主依赖”；
 * - 默认 orchestrator / ToolManager / task resolver 的创建由工厂负责；
 * - 这样 host port 与默认实现的边界更清楚，后续可替换而不改 runtime 协议。
 */
export class DefaultGraphExecutorContextBuilder implements GraphExecutorContextBuilder {
  private readonly agentOrchestrator: agentOrchestration.AgentMessageOrchestrator;
  private readonly toolManager: agentTools.ToolManager;
  private readonly agentTaskResolver: AgentTaskResolver;
  private readonly resolveModelInferenceRoute:
    ResolvedDefaultGraphExecutorContextBuilderDependencies['resolveModelInferenceRoute'];

  constructor(dependencies: ResolvedDefaultGraphExecutorContextBuilderDependencies) {
    this.agentOrchestrator = dependencies.agentOrchestrator;
    this.toolManager = dependencies.toolManager;
    this.agentTaskResolver = dependencies.agentTaskResolver;
    this.resolveModelInferenceRoute = dependencies.resolveModelInferenceRoute;
  }

  async build(input: GraphExecutorContextBuildInput): Promise<GraphExecutorContextBuildOutput> {
    /**
     * Graph 已完成默认选模与 run lock，context build 必须以这个 prepared model 为唯一模型事实。
     * 显式构造产品请求还能保留 LinnKit 合同的结构类型安全，不再用断言掩盖两层请求类型的差异。
     */
    const resolvedRequest: AgentInvokeRequest = {
      ...input.request,
      model_id: input.modelId,
      modelId: input.modelId,
    };
    const request = withLinnyaFenceInjections(resolvedRequest);
    const route = this.resolveModelInferenceRoute(input.modelId);
    if (!route) {
      throw new Error(`Chat 模型 ${input.modelId} 缺少正式 inference route。`);
    }

    const processingResult = await this.agentOrchestrator.processAgentConversation(
      request,
      input.history,
      this.toolManager,
      {
        promptBudgetLimits: {
          modelContextWindowTokens: route.context_window_tokens,
          modelMaxOutputTokens: route.max_output_tokens,
          toolDefinitionTokens: input.toolDefinitionTokens,
        },
      },
    );

    return this.buildGraphContextOutput(request, processingResult);
  }

  async applyCompaction(
    input: runtimeKernel.graph.GraphExecutorContextApplyInput,
  ): Promise<runtimeKernel.graph.GraphExecutorContextApplyOutput> {
    const resolvedRequest: AgentInvokeRequest = {
      ...input.request,
      model_id: input.modelId,
      modelId: input.modelId,
    };
    const request = withLinnyaFenceInjections(resolvedRequest);
    const route = this.resolveModelInferenceRoute(input.modelId);
    if (!route) {
      throw new Error(`Chat 模型 ${input.modelId} 缺少正式 inference route。`);
    }
    const result = await this.agentOrchestrator.applyContextCompaction(
      request,
      input.history,
      this.toolManager,
      {
        id: input.summaryId,
        conversationId: input.conversationId,
        turnId: input.turnId,
        timestamp: input.timestamp,
        checkpointContent: input.checkpointContent,
        plan: input.plan,
        maxOutputTokens: input.maxOutputTokens,
        promptBudgetLimits: {
          modelContextWindowTokens: route.context_window_tokens,
          modelMaxOutputTokens: route.max_output_tokens,
          toolDefinitionTokens: input.toolDefinitionTokens,
        },
      },
    );
    if (result.kind !== 'ready') return result;
    return {
      kind: 'ready',
      rebuiltContext: this.buildGraphContextOutput(request, result.processingResult),
      pendingSummaryEvent: result.pendingSummaryEvent,
      compressionRatio: result.compressionRatio,
      summaryTokenEstimate: result.summaryTokenEstimate,
    };
  }

  private buildGraphContextOutput(
    request: AgentInvokeRequest,
    processingResult: agentOrchestration.AgentProcessingResult,
  ): GraphExecutorContextBuildOutput {
    const formattedContext = formatMessagesWithCachePolicy(processingResult.messages);
    const llmMessages = formattedContext.messages;
    recordAfterContextManager({
      contextMessages: processingResult.messages,
      llmMessages,
      toolNames: Array.isArray(request.availableTools) ? request.availableTools : undefined,
    });
    return {
      llmMessages,
      ...(formattedContext.cachePolicy
        ? { cachePolicy: formattedContext.cachePolicy }
        : {}),
      promptBudget: processingResult.promptBudget,
      promptUsageMeasurementPolicy:
        processingResult.contextBuildResult.promptUsageMeasurementPolicy,
      outputProcessor: this.agentTaskResolver(request.promptKey),
      contextCompactionCandidate:
        processingResult.contextBuildResult.contextCompactionCandidate,
      contextCompactionPolicy:
        processingResult.contextBuildResult.contextCompactionPolicy,
      contextTrace: readContextTrace(processingResult.contextBuildResult),
      tokenEstimate: readTokenEstimate(processingResult.contextBuildResult),
      tokenComponents: readTokenComponents(processingResult.contextBuildResult),
      imageInputAdmissionEvidence: readImageInputAdmissionEvidence(
        processingResult.contextBuildResult,
      ),
    };
  }
}

function formatMessagesWithCachePolicy(
  messages: readonly AiMessage[],
): {
  messages: ReturnType<typeof formatAgentLlmMessages>;
  cachePolicy?: CanonicalInferenceCachePolicy;
} {
  const formattedMessages: ReturnType<typeof formatAgentLlmMessages> = [];
  let formattedIndex = -1;
  let systemPromptEndIndex: number | undefined;
  let historySummaryEndIndex: number | undefined;
  for (const message of messages) {
    const formatted = formatAgentLlmMessages([message], { fenceRegistry: linnyaFenceRegistry });
    if (formatted.length === 0) continue;
    formattedMessages.push(...formatted);
    formattedIndex += formatted.length;
    if (message.type === 'system_prompt') {
      systemPromptEndIndex = formattedIndex;
    }
    if (message.type === 'history_summary') {
      historySummaryEndIndex = formattedIndex;
    }
  }
  const breakpoints = [
    ...(systemPromptEndIndex !== undefined
      ? [{ anchor: 'end_of_system_prompt' as const, message_index: systemPromptEndIndex }]
      : []),
    ...(historySummaryEndIndex !== undefined
      ? [{ anchor: 'end_of_history_summary' as const, message_index: historySummaryEndIndex }]
      : []),
  ];
  return {
    messages: formattedMessages,
    ...(breakpoints.length > 0 ? { cachePolicy: { breakpoints } } : {}),
  };
}
