import type { AgentProfileRequest } from '../contracts';
import {
  AgentContextManager,
  type ContextBuildResult,
} from '../context';
import type { ContextManagerBaseOptions } from '../../../shared/context-manager-base';
import {
  AGENT_CONTEXT_BUILDER_CONFIG,
  type AgentContextBuilderConfig,
} from '../context/config';
import type { ContextProviderRegistry } from '../context/providers';
import {
  type PreprocessorPipeline,
  type PreprocessorPipelineResult,
  createDefaultAgentPreprocessorPipeline,
  type ToolReplayProtocolPolicy,
} from '../preprocessors';
import { ToolManager } from '../tools/ToolManager';
import type { AgentTaskResolver } from '../tasks/base';
import { convertEventsToAiMessages } from '../utils/eventConverter';
import { recordBeforeContextManager } from '../../../../shared/llmAuditRecorder';
import type {
  AgentSpecContextPolicy,
  AiMessage,
  ContextCompactionPlan,
  HistorySummaryEvent,
  RuntimeEvent,
  TokenRoute,
  TokenUsageCalibrationSample,
} from '../../../../contracts';
import {
  validateContextCompactionRebuild,
  type ContextCheckpointValidationFailure,
} from '../../../features/context-compaction';
import type {
  LlmImageInputEstimatorPort,
  TokenCounterPort,
  TokenizerPort,
} from '../../../../ports';
import type { FenceRegistry } from '../../../shared/fences';
import {
  contextPolicyToContextBuilderConfig,
  contextPolicyToPreprocessorOptions,
} from '../../../shared/agentSpecAdapter';
import { Logger } from '../../../../shared/logger';
import {
  resolveEffectivePromptBudget,
  type EffectivePromptBudget,
} from '../../../../shared/prompt-budget';

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function readOptionalStringProperty(value: unknown, key: string): string | undefined {
  if (!isRecord(value)) return undefined;
  const candidate = value[key];
  return typeof candidate === 'string' && candidate.trim().length > 0 ? candidate : undefined;
}

export interface AgentOrchestratorOptions {
  tokenBudget: {
    maxTokens: number;
    reservedForResponse: number;
  };
  processing: {
    debugMode?: boolean;
    preserveMetadata?: boolean;
  };
  model?: string;
  resolveToolReplayProtocolPolicy?: (params: {
    request: AgentProfileRequest;
    modelId: string;
  }) => ToolReplayProtocolPolicy | undefined;
  resolveContextPolicy?: (request: AgentProfileRequest) => AgentSpecContextPolicy | undefined;
  createProviderRegistry?: (params: {
    request: AgentProfileRequest;
    contextPolicy: AgentSpecContextPolicy | undefined;
    contextBuilderConfig: Partial<AgentContextBuilderConfig>;
  }) => ContextProviderRegistry;
  resolveTokenCalibration?: (params: {
    request: AgentProfileRequest;
    modelId: string;
    contextPolicy: AgentSpecContextPolicy | undefined;
  }) => {
    route?: TokenRoute;
    samples?: readonly TokenUsageCalibrationSample[];
  } | undefined;
  taskResolver: AgentTaskResolver;
  providerRegistry: ContextProviderRegistry;
  fenceRegistry?: FenceRegistry;
  tokenizer?: TokenizerPort;
  tokenCounter?: TokenCounterPort;
  imageInputEstimator?: LlmImageInputEstimatorPort;
  resolveTokenRoute?: (params: {
    request: AgentProfileRequest;
    modelId: string;
    contextPolicy: AgentSpecContextPolicy | undefined;
  }) => TokenRoute | undefined;
}

export interface AgentProcessingResult {
  messages: AiMessage[];
  contextBuildResult: ContextBuildResult;
  promptBudget: EffectivePromptBudget;
  metadata: {
    originalCount: number;
    processedCount: number;
    processingStats: ContextBuildResult['processingStats'];
    truncated: boolean;
    truncatedCount?: number;
  };
}

export type AgentContextCompactionApplyResult =
  | {
      readonly kind: 'ready';
      readonly processingResult: AgentProcessingResult;
      readonly pendingSummaryEvent: HistorySummaryEvent;
      readonly compressionRatio: number;
      readonly summaryTokenEstimate: number;
    }
  | {
      readonly kind: 'invalid';
      readonly reason:
        | ContextCheckpointValidationFailure
        | 'replacement_survived'
        | 'orphan_tool_output';
      readonly tokenEstimate?: number;
      readonly messageId?: string;
    }
  | {
      readonly kind: 'ineffective';
      readonly compressionRatio: number;
      readonly summaryTokenEstimate: number;
    };

interface RequestContextAssembly {
  contextBuilderConfig: Partial<AgentContextBuilderConfig>;
  contextManager: AgentContextManager;
}

type AgentContextManagerOptions = NonNullable<ConstructorParameters<typeof AgentContextManager>[0]>;
type AgentRemoteCountPolicy = ContextManagerBaseOptions<
  AgentContextBuilderConfig,
  ContextProviderRegistry
>['remoteCount'];
type AgentTokenCalibrationOptions = ContextManagerBaseOptions<
  AgentContextBuilderConfig,
  ContextProviderRegistry
>['tokenCalibration'];

export class AgentMessageOrchestrator {
  private baseAgentContextManager: AgentContextManager;
  private options: AgentOrchestratorOptions;
  private readonly taskResolver: AgentTaskResolver;
  private baseContextConfig: Partial<AgentContextBuilderConfig>;
  private readonly logger = new Logger('AgentMessageOrchestrator');

  constructor(options: AgentOrchestratorOptions) {
    this.options = options;
    this.taskResolver = options.taskResolver;
    this.baseContextConfig = {
      DEFAULT_MAX_TOKENS: options.tokenBudget.maxTokens,
      RESERVED_FOR_RESPONSE: options.tokenBudget.reservedForResponse,
      WORKING_MEMORY_BUDGET_PERCENTAGE: AGENT_CONTEXT_BUILDER_CONFIG.WORKING_MEMORY_BUDGET_PERCENTAGE,
    };
    this.baseAgentContextManager = this.createAgentContextManager({
      debugMode: options.processing.debugMode,
      customConfig: this.baseContextConfig,
      providerRegistry: options.providerRegistry,
      tokenizer: options.tokenizer,
      tokenizerModelId: options.model,
      tokenCounter: options.tokenCounter,
      imageInputEstimator: options.imageInputEstimator,
    });
  }

  private createAgentContextManager(options: {
    debugMode?: boolean;
    customConfig: Partial<AgentContextBuilderConfig>;
    providerRegistry: ContextProviderRegistry;
    tokenizer?: TokenizerPort;
    tokenizerModelId?: string;
    tokenCounter?: TokenCounterPort;
    tokenRoute?: TokenRoute;
    remoteCount?: AgentRemoteCountPolicy;
    tokenCalibration?: AgentTokenCalibrationOptions;
    imageInputEstimator?: LlmImageInputEstimatorPort;
  }): AgentContextManager {
    const managerOptions: AgentContextManagerOptions = options;
    return new AgentContextManager(managerOptions);
  }

  private buildPreprocessorPipelineForRequest(
    toolManager: ToolManager,
    request: AgentProfileRequest,
    contextPolicy: AgentSpecContextPolicy | undefined,
  ): PreprocessorPipeline {
    return createDefaultAgentPreprocessorPipeline({
      debugMode: this.options.processing.debugMode,
      model: this.resolvePreprocessorModel(request),
      toolSummaryProvider: toolManager.getSummaryProvider(),
    }, {
      fenceRegistry: this.options.fenceRegistry,
      ...contextPolicyToPreprocessorOptions(contextPolicy),
    });
  }

  private resolvePreprocessorModel(request: AgentProfileRequest): string {
    return readOptionalStringProperty(request, 'model_id')
      ?? readOptionalStringProperty(request, 'modelId')
      ?? this.options.model
      ?? 'default';
  }

  private resolveContextPolicy(request: AgentProfileRequest): AgentSpecContextPolicy | undefined {
    return this.options.resolveContextPolicy?.(request);
  }

  private assembleRequestContext(
    request: AgentProfileRequest,
    contextPolicy: AgentSpecContextPolicy | undefined,
  ): RequestContextAssembly {
    const contextBuilderConfig = {
      ...this.baseContextConfig,
      ...(contextPolicy ? contextPolicyToContextBuilderConfig(contextPolicy) : {}),
    };
    const providerRegistry = this.options.createProviderRegistry?.({
      request,
      contextPolicy,
      contextBuilderConfig,
    }) ?? this.options.providerRegistry;
    const modelId = this.resolvePreprocessorModel(request);
    const tokenCalibration = this.options.resolveTokenCalibration?.({
      request,
      modelId,
      contextPolicy,
    });
    const tokenRoute = this.options.resolveTokenRoute?.({
      request,
      modelId,
      contextPolicy,
    }) ?? tokenCalibration?.route;

    const contextManager = this.createAgentContextManager({
      debugMode: this.options.processing.debugMode,
      customConfig: contextBuilderConfig,
      providerRegistry,
      tokenizer: this.options.tokenizer,
      tokenizerModelId: modelId,
      tokenCounter: this.options.tokenCounter,
      tokenRoute,
      remoteCount: contextPolicy?.tokenEstimation?.remoteCount,
      tokenCalibration: {
        policy: contextPolicy?.tokenEstimation?.calibration,
        route: tokenCalibration?.route,
        samples: tokenCalibration?.samples,
      },
      imageInputEstimator: this.options.imageInputEstimator,
    });

    return {
      contextBuilderConfig,
      contextManager,
    };
  }

  async processAgentConversation(
    request: AgentProfileRequest,
    history: RuntimeEvent[],
    toolManager: ToolManager,
    extraOptions?: {
      promptBudgetLimits: {
        modelContextWindowTokens: number;
        modelMaxOutputTokens: number;
        toolDefinitionTokens: number;
      };
    }
  ): Promise<AgentProcessingResult> {
    const historyCount = history.length;

    this.debug('Starting agent conversation processing', {
      requestQuery: request.query.substring(0, 50),
      historyEventCount: historyCount,
      availableTools: request.availableTools || 'all_tools',
    });

    const startTime = performance.now();

    try {
      const historyMessages = convertEventsToAiMessages(history);
      this.debug('Converted history events to messages', {
        eventCount: history.length,
        messageCount: historyMessages.length,
      });

      const allMessages = this.buildCompleteMessageList(request, historyMessages);
      this.debug('Built complete message list', { totalCount: allMessages.length });

      const contextPolicy = this.resolveContextPolicy(request);
      const { contextBuilderConfig, contextManager } = this.assembleRequestContext(request, contextPolicy);
      const promptBudget = resolveEffectivePromptBudget({
        // 容量 policy 必须直接读取 sparse 声明，不能从已叠加 framework fallback 的
        // Context Builder config 反推，否则“未声明”会再次变成隐藏 cap。
        policyMaxTokens: contextPolicy?.budget?.maxTokens,
        policyReservedForResponse: contextPolicy?.budget?.reservedForResponse,
        modelContextWindowTokens: extraOptions?.promptBudgetLimits.modelContextWindowTokens,
        modelMaxOutputTokens: extraOptions?.promptBudgetLimits.modelMaxOutputTokens,
        fallbackContextWindowTokens: this.options.tokenBudget.maxTokens,
        fallbackMaxOutputTokens: this.options.tokenBudget.reservedForResponse,
        toolDefinitionTokens: extraOptions?.promptBudgetLimits.toolDefinitionTokens ?? 0,
      });

      const preprocessorPipeline = this.buildPreprocessorPipelineForRequest(toolManager, request, contextPolicy);
      const modelId = this.resolvePreprocessorModel(request);
      preprocessorPipeline.updateContext({
        model: modelId,
        toolReplayProtocolPolicy: this.options.resolveToolReplayProtocolPolicy?.({
          request,
          modelId,
        }),
      });

      const preprocessResult = await this.runPreprocessorPipeline(preprocessorPipeline, allMessages);
      this.debug('Preprocessor pipeline completed', {
        originalCount: allMessages.length,
        processedCount: preprocessResult.messages.length,
        appliedStrategies: preprocessResult.pipelineStats.appliedStrategies,
      });
      recordBeforeContextManager({
        payload: {
          request,
          history,
          preprocessedMessages: preprocessResult.messages,
          preprocessorStrategies: preprocessResult.pipelineStats.appliedStrategies,
        },
      });

      const contextResult = await this.buildContextFromPreprocessedMessages(
        contextManager,
        request,
        preprocessResult.messages,
        contextPolicy,
        promptBudget,
      );
      this.debug('Context built', { afterContextCount: contextResult.messages.length });

      this.debug('Messages after context build', {
        messages: contextResult.messages.map((m) => ({
          id: m.id,
          ts: m.timestamp,
          role: m.role,
          type: m.type,
          content: m.content.substring(0, 50),
        })),
      });

      const endTime = performance.now();
      const processingTime = endTime - startTime;

      this.debug('Processing completed', {
        processingTime: `${processingTime.toFixed(2)}ms`,
        finalMessageCount: contextResult.messages.length,
      });

      return {
        messages: contextResult.messages,
        contextBuildResult: contextResult,
        promptBudget,
        metadata: {
          originalCount: allMessages.length,
          processedCount: contextResult.messages.length,
          processingStats: contextResult.processingStats,
          truncated: contextResult.truncated,
          truncatedCount: contextResult.truncatedCount,
        },
      };
    } catch (error) {
      this.debug('Processing failed', { error });
      throw new Error(`Agent message processing failed: ${error}`);
    }
  }

  /**
   * 把通过校验的 checkpoint 作为 pending history fact 注入，并重跑正常上下文链路。
   *
   * 中文备注：这里不发布摘要。Graph 必须先对 rebuilt Prompt 重新计量并通过 admission，
   * 才能提交 pendingSummaryEvent。
   */
  async applyContextCompaction(
    request: AgentProfileRequest,
    history: RuntimeEvent[],
    toolManager: ToolManager,
    input: {
      id: string;
      conversationId: string;
      turnId: string;
      timestamp: number;
      checkpointContent: string;
      plan: ContextCompactionPlan;
      maxOutputTokens: number;
      promptBudgetLimits: {
        modelContextWindowTokens: number;
        modelMaxOutputTokens: number;
        toolDefinitionTokens: number;
      };
    },
  ): Promise<AgentContextCompactionApplyResult> {
    const contextPolicy = this.resolveContextPolicy(request);
    const { contextManager } = this.assembleRequestContext(request, contextPolicy);
    const draft = contextManager.prepareContextCompactionDraft(input);
    if (draft.kind !== 'ready') return draft;

    const processingResult = await this.processAgentConversation(
      request,
      [...history, draft.event],
      toolManager,
      { promptBudgetLimits: input.promptBudgetLimits },
    );
    const rebuildValidation = validateContextCompactionRebuild({
      messages: processingResult.messages,
      pendingSummaryId: draft.message.id,
      plan: input.plan,
    });
    if (!rebuildValidation.valid) {
      return {
        kind: 'invalid',
        reason: rebuildValidation.reason,
        messageId: rebuildValidation.messageId,
      };
    }

    return {
      kind: 'ready',
      processingResult,
      pendingSummaryEvent: draft.event,
      compressionRatio: draft.compressionRatio,
      summaryTokenEstimate: draft.summaryTokenEstimate,
    };
  }

  private buildCompleteMessageList(request: AgentProfileRequest, historyMessages: AiMessage[]): AiMessage[] {
    const task = this.taskResolver(request.promptKey);
    return task.buildMessages(request, historyMessages);
  }

  private async runPreprocessorPipeline(
    preprocessorPipeline: PreprocessorPipeline,
    messages: AiMessage[],
  ): Promise<PreprocessorPipelineResult> {
    return preprocessorPipeline.process(messages);
  }

  private async buildContextFromPreprocessedMessages(
    contextManager: AgentContextManager,
    request: AgentProfileRequest,
    messages: AiMessage[],
    contextPolicy?: AgentSpecContextPolicy,
    promptBudget?: EffectivePromptBudget,
  ): Promise<ContextBuildResult> {
    const resolvedTotalBudget =
      promptBudget?.messageBudgetTokens
      ?? this.options.tokenBudget.maxTokens - this.options.tokenBudget.reservedForResponse;

    const contextResult = await contextManager.buildContextFromPreprocessedMessages(
      request,
      messages,
      resolvedTotalBudget,
      {
        policy: contextPolicy?.contextTrace,
        effectiveContextPolicy: contextPolicy,
        ...(promptBudget
          ? {
              budgetDetails: {
                inputBudgetTokens: promptBudget.inputBudgetTokens,
                toolDefinitionTokens: promptBudget.toolDefinitionTokens,
              },
            }
          : {}),
      },
    );

    if (this.options.processing.debugMode) {
      this.debug('Context build result', {
        original: contextResult.processingStats.originalCount,
        kept: contextResult.processingStats.keptCount,
        truncated: contextResult.processingStats.truncatedCount,
        strategies: contextResult.strategies.applied,
        tokenUsage: contextResult.tokenUsage,
        recommendations: contextResult.strategies.recommendations,
        buildStats: contextResult.processingStats.buildStats,
      });
    }

    return contextResult;
  }

  private debug(message: string, data?: Record<string, unknown>): void {
    if (this.options.processing.debugMode) {
      this.logger.debug(message, data);
    }
  }

  updateOptions(newOptions: Partial<AgentOrchestratorOptions>): void {
    this.options = {
      ...this.options,
      ...newOptions,
      tokenBudget: { ...this.options.tokenBudget, ...newOptions.tokenBudget },
      processing: { ...this.options.processing, ...newOptions.processing },
    };
    this.baseContextConfig = {
      ...this.baseContextConfig,
      DEFAULT_MAX_TOKENS: this.options.tokenBudget.maxTokens,
      RESERVED_FOR_RESPONSE: this.options.tokenBudget.reservedForResponse,
    };
    this.baseAgentContextManager.updateConfig(this.baseContextConfig);
    this.baseAgentContextManager.updateTokenizerModelId(this.options.model);
  }

  getContextManager(): AgentContextManager {
    return this.baseAgentContextManager;
  }

  getContextInfo(): { config: AgentContextBuilderConfig } {
    return {
      config: this.baseAgentContextManager.getConfig(),
    };
  }
}
