import type { AgentProfileRequest } from '../contracts';
import { 
  AGENT_CONTEXT_BUILDER_CONFIG,
  AgentBuildPhase,
  AgentContextBuildStats,
  validateAgentConfig,
  AgentContextBuilderConfig
} from './config';
import { 
  ProviderContext,
  ContextProviderRegistry
} from './providers';
import {
  ContextManagerBase,
  type ContextManagerBaseOptions,
} from '../../../shared/context-manager-base';
import {
  buildContextResult,
  generateContextRecommendations,
} from '../../../shared/context-result';
import { getAgentBuildPhaseByProviderName } from './functions/providerPhase';
import { ContextTraceCollector, type ContextTrace } from '../../../shared/context-trace';
import { buildContextTokenComponents } from '../../../shared/context-token-components';
import type {
  AgentSpecContextPolicy,
  AgentSpecContextTracePolicy,
  AiMessage,
  ContextCompactionCandidate,
  ContextCompactionPlan,
  ContextBuildTokenEstimate,
  ContextTokenComponent,
  PromptUsageMeasurementPolicy,
  ResolvedContextCompactionPolicy,
  TokenCountConfidence,
  TokenCountSource,
  TokenRoute,
} from '../../../../contracts';
import {
  createHistorySummaryDraft,
  resolveContextCompactionPolicy,
  selectContextCompactionCandidate,
  validateContextCheckpoint,
  type ContextCompactionDraftPreparationResult,
} from '../../../features/context-compaction';
import { contextPolicyToMustKeepPolicy } from '../../../shared/agentSpecAdapter';
import { DEFAULT_MUST_KEEP_POLICY } from '../../../shared/policies';
import type {
  ImageInputAdmissionEvidence,
  LlmImageInputEstimatorPort,
  TokenCounterPort,
  TokenizerPort,
} from '../../../../ports';
import type { RemoteTokenCountTrace } from '../../../shared/providers/base';

interface ContextBuildTokenUsageMeasurement {
  source: TokenCountSource;
  confidence: TokenCountConfidence;
}

/**
 * Agent 专用的 Provider 上下文
 * 继承自基础 ProviderContext，并添加 Agent 特有的信息
 */
export interface AgentProviderContext extends ProviderContext {
  agentRequest: AgentProfileRequest;
}

/**
 * 上下文构建结果接口
 */
export interface ContextBuildResult {
  /** 构建后的消息列表 */
  messages: AiMessage[];
  
  /** Token使用情况 */
  tokenUsage: {
    used: number;
    remaining: number;
    messageBudget: number;
    inputBudget: number;
    toolDefinitionTokens: number;
    source: TokenCountSource;
    confidence: TokenCountConfidence;
  };

  /** Graph 对 reminder 后最终 Prompt 计数时复用的已解析策略。 */
  promptUsageMeasurementPolicy: PromptUsageMeasurementPolicy;
  
  /** 处理统计信息 */
  processingStats: {
    originalCount: number;
    keptCount: number;
    truncatedCount: number;
    tokenDistribution: Record<string, number>;
    strategiesApplied: string[];
    recommendations: string[];
    buildStats?: AgentContextBuildStats;
  };
  
  /** 是否进行了截断 */
  truncated: boolean;
  
  /** 截断的消息数量 */
  truncatedCount?: number;
  
  /** 应用的策略列表 */
  strategies: {
    applied: string[];
    recommendations: string[];
  };
  
  /** ContextTrace：解释本次上下文构建如何保留/裁剪消息。 */
  contextTrace?: ContextTrace;

  /** 构建期 token 估算快照，用于 host 把本地估算与响应后 actual usage 配对。 */
  tokenEstimate?: ContextBuildTokenEstimate;

  /** 构建期上下文分项 token 估算，用于 trace、账本与 host 面板后端。 */
  tokenComponents?: ContextTokenComponent[];

  /** provider attempt 用来按 active profile 复核 final context 的短生命周期预算证据。 */
  imageInputAdmissionEvidence?: ImageInputAdmissionEvidence;

  /** Graph 在最终 Prompt 计量后可执行的纯压缩候选。 */
  contextCompactionCandidate?: ContextCompactionCandidate;

  /** 本次 build 已解析的压缩策略；无候选时 Graph 仍需它判定终态。 */
  contextCompactionPolicy: ResolvedContextCompactionPolicy;
}

/**
 * Agent专用智能上下文管理器
 * 
 * 🎯 核心职责: 
 * 1. 编排Provider执行，构建优化的上下文
 * 2. 保证工具调用的完整性和配对保留
 * 3. 使用统一配置，不感知对话阶段
 * 
 * 🏗️ 架构特性:
 * - Provider策略模式: 实现高内聚、低耦合
 * - 责任链模式: 按优先级编排Provider
 * - 专注于Provider编排，不负责消息构建
 */
export class AgentContextManager extends ContextManagerBase<
  AgentContextBuilderConfig,
  ContextProviderRegistry
> {

  constructor(options: {
    debugMode?: boolean;
    customConfig?: Partial<AgentContextBuilderConfig>;
    providerRegistry?: ContextProviderRegistry;
    tokenizer?: TokenizerPort;
    tokenizerModelId?: string;
    tokenCounter?: TokenCounterPort;
    tokenRoute?: TokenRoute;
    remoteCount?: ContextManagerBaseOptions<
      AgentContextBuilderConfig,
      ContextProviderRegistry
    >['remoteCount'];
    tokenCalibration?: ContextManagerBaseOptions<
      AgentContextBuilderConfig,
      ContextProviderRegistry
    >['tokenCalibration'];
    imageInputEstimator?: LlmImageInputEstimatorPort;
  } = {}) {
    super(options as ContextManagerBaseOptions<
      AgentContextBuilderConfig,
      ContextProviderRegistry
    >, {
      defaultConfig: AGENT_CONTEXT_BUILDER_CONFIG,
      validateConfig: validateAgentConfig,
      createRegistry: () => new ContextProviderRegistry(),
      loggerName: 'AgentContextManager',
      invalidConfigMessage: 'Invalid AgentContextManager configuration',
    });

    this.debug('🏗️ [Agent上下文管理器] 初始化完成', {
      providersCount: this.providerRegistry.getAllProviders().length
    });
  }

  /**
   * 主入口：为Agent构建智能上下文
   * 专门处理预处理过的消息，专注于上下文优化
   */
  async buildContextFromPreprocessedMessages(
    request: AgentProfileRequest,
    preprocessedMessages: AiMessage[],
    totalBudget: number,
    traceOptions?: {
      policy?: AgentSpecContextTracePolicy;
      effectiveContextPolicy?: AgentSpecContextPolicy;
      budgetDetails?: {
        inputBudgetTokens: number;
        toolDefinitionTokens: number;
      };
    },
  ): Promise<ContextBuildResult> {
    this.debug('🎯 [Agent上下文管理器] 开始上下文构建', { 
      requestQuery: request.query.substring(0, 50),
      preprocessedMessageCount: preprocessedMessages.length,
      totalBudget,
    });

    const startTime = performance.now();
    const buildStats: AgentContextBuildStats = this.initializeBuildStats(startTime, preprocessedMessages.length);

    try {
      // 创建 ProviderContext
      const enhancedContext: AgentProviderContext = {
        totalBudget,
        config: this.config,
        debugMode: this.debugMode,
        estimateTokens: (msg: AiMessage) => this.estimateTokens(msg),
        estimateTokensWithTrace: (msg: AiMessage) => {
          const estimate = this.estimateTokensWithCalibrationTrace(msg);
          return {
            tokens: estimate.tokens,
            tokenCalibration: estimate.calibrationTrace,
          };
        },
        agentRequest: request,
      };
      const contextTrace = ContextTraceCollector.create({
        policy: traceOptions?.policy,
        effectivePolicy: traceOptions?.effectiveContextPolicy,
        totalBudget,
        originalCount: preprocessedMessages.length,
        tokenCalibration: this.getTokenCalibrationTrace(),
      });

      // 核心流程：编排各个Provider按优先级处理预处理过的消息
      const { finalMessages, finalTokens, strategiesApplied, states } =
        await this.runPipeline({
          messages: preprocessedMessages,
          totalBudget,
          buildStats,
          providerContext: enhancedContext,
          getPhaseByProviderName: getAgentBuildPhaseByProviderName,
          contextTrace,
        });
      const remoteCount = await this.countMessagesWithRemoteCounter({
        messages: finalMessages,
        localEstimateTokens: finalTokens,
      });
      contextTrace?.recordRemoteTokenCount(remoteCount.trace);
      const tokenComponents = buildContextTokenComponents(
        states,
        message => this.estimateImageInputs(message),
      );
      contextTrace?.recordTokenComponents(tokenComponents);
      const tokenEstimate = this.buildContextTokenEstimate(finalMessages, finalTokens);
      const imageInputAdmissionEvidence = this.buildImageInputAdmissionEvidence(
        finalMessages,
        totalBudget,
      );
      const contextCompactionPolicy = resolveContextCompactionPolicy(
        traceOptions?.effectiveContextPolicy?.compaction,
      );
      const contextCompactionCandidate = selectContextCompactionCandidate({
        messages: finalMessages,
        replacementSourceMessages: preprocessedMessages,
        totalBudget,
        inputBudgetTokens: traceOptions?.budgetDetails?.inputBudgetTokens ?? totalBudget,
        policy: contextCompactionPolicy,
        mustKeepPolicy:
          contextPolicyToMustKeepPolicy(traceOptions?.effectiveContextPolicy)
          ?? DEFAULT_MUST_KEEP_POLICY,
        estimateTokens: message => this.estimateTokens(message),
      });
      
      const endTime = performance.now();
      buildStats.totalTime = endTime - startTime;
      
      this.debug('✅ [Agent上下文管理器] 上下文构建完成', {
        预处理消息: preprocessedMessages.length,
        最终消息: finalMessages.length,
        Token使用: remoteCount.tokens,
        总预算: totalBudget,
        使用率: `${((remoteCount.tokens / totalBudget) * 100).toFixed(1)}%`,
        总耗时: `${buildStats.totalTime.toFixed(2)}ms`
      });

      return this.buildFinalResult(
        finalMessages,
        remoteCount.tokens,
        totalBudget,
        preprocessedMessages.length,
        strategiesApplied,
        buildStats,
        this.buildTokenUsageMeasurement(remoteCount.trace),
        contextCompactionPolicy,
        contextTrace?.build(finalMessages, finalTokens),
        tokenEstimate,
        tokenComponents,
        imageInputAdmissionEvidence,
        traceOptions?.budgetDetails,
        contextCompactionCandidate,
      );

    } catch (error) {
      this.debug('❌ [Agent上下文管理器] 上下文构建失败', { error });
      throw error instanceof Error
        ? error
        : new Error(`Agent context building failed: ${String(error)}`);
    }
  }

  /**
   * 校验模型生成的 checkpoint，并创建尚未发布的 summary draft。
   *
   * 中文备注：该方法只做确定性规则，不调用模型、不发布事件。Graph 只有在重建后的
   * Prompt 通过容量校验后，才允许把这里返回的事实提交到 EventStore。
   */
  prepareContextCompactionDraft(input: {
    id: string;
    conversationId: string;
    turnId: string;
    timestamp: number;
    checkpointContent: string;
    plan: ContextCompactionPlan;
    maxOutputTokens: number;
  }): ContextCompactionDraftPreparationResult {
    const validation = validateContextCheckpoint({
      content: input.checkpointContent,
      maxOutputTokens: input.maxOutputTokens,
      estimateTextTokens: text => this.estimateTextTokens(text),
    });
    if (!validation.valid) {
      return {
        kind: 'invalid',
        reason: validation.reason,
        tokenEstimate: validation.tokenEstimate,
      };
    }
    return createHistorySummaryDraft({
      id: input.id,
      conversationId: input.conversationId,
      turnId: input.turnId,
      timestamp: input.timestamp,
      checkpointContent: validation.content,
      plan: input.plan,
      estimateTokens: message => this.estimateTokens(message),
    });
  }

  // ------------------- 核心Provider编排方法 -------------------

  // ------------------- 辅助方法 -------------------

  private initializeBuildStats(startTime: number, originalMessageCount: number): AgentContextBuildStats {
    return {
      startTime,
      phaseTiming: {} as Record<AgentBuildPhase, number>,
      phaseTokenUsage: {} as Record<AgentBuildPhase, { used: number; percentage: number }>,
      messageStats: {
        original: originalMessageCount,
        afterCoreContext: 0,
        afterWorkingMemory: 0
      },
      priorityStats: {
        p1ToolInteractions: 0,
        p2TextConversations: 0,
        p3HistoricalTools: 0,
        p4CircularFill: 0
      },
      toolStats: {
        totalToolCalls: 0,
        pairedToolCalls: 0,
        unpairedToolCalls: 0,
        toolPairingSuccessRate: 0
      },
      documentTruncated: false,
      totalTime: 0
    };
  }

  private buildFinalResult(
    finalMessages: AiMessage[],
    finalTokens: number,
    totalBudget: number,
    originalCount: number,
    strategiesApplied: string[],
    buildStats: AgentContextBuildStats,
    tokenUsageMeasurement: ContextBuildTokenUsageMeasurement,
    contextCompactionPolicy: ResolvedContextCompactionPolicy,
    contextTrace?: ContextTrace,
    tokenEstimate?: ContextBuildTokenEstimate,
    tokenComponents?: ContextTokenComponent[],
    imageInputAdmissionEvidence?: ImageInputAdmissionEvidence,
    budgetDetails?: {
      inputBudgetTokens: number;
      toolDefinitionTokens: number;
    },
    contextCompactionCandidate?: ContextCompactionCandidate,
  ): ContextBuildResult {
    const recommendations = this.generateRecommendations(buildStats, totalBudget);
    return buildContextResult({
      finalMessages,
      finalTokens,
      totalBudget,
      originalCount,
      strategiesApplied,
      buildStats,
      enableBuildStats: this.config.ENABLE_BUILD_STATS,
      estimateTokens: message => this.estimateTokens(message),
      coreTypes: this.config.CORE_MESSAGE_TYPES,
      recommendations,
      tokenUsageMeasurement,
      inputBudgetTokens: budgetDetails?.inputBudgetTokens,
      toolDefinitionTokens: budgetDetails?.toolDefinitionTokens,
      promptUsageMeasurementPolicy: this.getPromptUsageMeasurementPolicy(),
      contextTrace,
      tokenEstimate,
      tokenComponents,
      imageInputAdmissionEvidence,
      contextCompactionPolicy,
      contextCompactionCandidate,
    });
  }

  private buildImageInputAdmissionEvidence(
    finalMessages: readonly AiMessage[],
    inputBudget: number,
  ): ImageInputAdmissionEvidence | undefined {
    let nonImageEstimatedTokens = 0;
    let initialProfileId: string | undefined;
    const attachments: ImageInputAdmissionEvidence['attachments'][number][] = [];

    finalMessages.forEach((message, messageIndex) => {
      const imageInputs = this.estimateImageInputs(message);
      const imageTokens = imageInputs.reduce(
        (total, attachment) => total + attachment.estimatedTokens,
        0,
      );
      nonImageEstimatedTokens += Math.max(0, this.estimateTokens(message) - imageTokens);
      for (const imageInput of imageInputs) {
        if (initialProfileId && initialProfileId !== imageInput.profileId) {
          throw new Error('Image input estimator returned multiple profiles for one active model.');
        }
        initialProfileId = imageInput.profileId;
        attachments.push({
          messageIndex,
          attachmentIndex: imageInput.attachmentIndex,
          id: imageInput.attachmentId,
          resourceId: imageInput.resourceId,
          placement: imageInput.placement,
          estimatedTokens: imageInput.estimatedTokens,
        });
      }
    });

    if (!initialProfileId || attachments.length === 0) return undefined;
    return {
      inputBudget,
      nonImageEstimatedTokens,
      initialProfileId,
      attachments,
    };
  }

  private buildContextTokenEstimate(
    finalMessages: readonly AiMessage[],
    calibratedEstimateTokens: number,
  ): ContextBuildTokenEstimate {
    return {
      ...(this.getTokenRoute() ? { route: this.getTokenRoute() } : {}),
      localEstimateTokens: this.estimateLocalTokens(finalMessages),
      calibratedEstimateTokens,
      finalTokens: calibratedEstimateTokens,
      source: 'local-estimate',
      confidence: 'estimate',
    };
  }

  private buildTokenUsageMeasurement(trace: RemoteTokenCountTrace): ContextBuildTokenUsageMeasurement {
    if (trace.applied && trace.source && trace.confidence) {
      return {
        source: trace.source,
        confidence: trace.confidence,
      };
    }

    return {
      source: 'local-estimate',
      confidence: 'estimate',
    };
  }

  /**
   * 生成优化建议
   */
  private generateRecommendations(stats: AgentContextBuildStats, totalBudget: number): string[] {
    return generateContextRecommendations(stats, {
      totalBudget,
      processingTimeoutMs: this.config.PROCESSING_TIMEOUT_MS,
    });
  }
}
