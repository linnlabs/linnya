import type {
  AiMessage,
  ContextCompactionCandidate,
  ContextBuildTokenEstimate,
  ContextTokenComponent,
  PromptUsageMeasurementPolicy,
  ResolvedContextCompactionPolicy,
  TokenCountConfidence,
  TokenCountSource,
} from '../../contracts';
import type { ContextTrace } from './context-trace';
import type { ImageInputAdmissionEvidence } from '../../ports';

export interface RecommendationStats {
  phaseTokenUsage: Record<PropertyKey, { used: number; percentage: number }>;
  documentTruncated: boolean;
  totalTime: number;
}

export interface BuildContextResultOptions<TBuildStats> {
  finalMessages: AiMessage[];
  finalTokens: number;
  totalBudget: number;
  originalCount: number;
  strategiesApplied: string[];
  buildStats: TBuildStats;
  enableBuildStats: boolean;
  estimateTokens: (message: AiMessage) => number;
  coreTypes: readonly string[];
  recommendations: string[];
  tokenUsageMeasurement: {
    source: TokenCountSource;
    confidence: TokenCountConfidence;
  };
  inputBudgetTokens?: number;
  toolDefinitionTokens?: number;
  promptUsageMeasurementPolicy: PromptUsageMeasurementPolicy;
  contextTrace?: ContextTrace;
  tokenEstimate?: ContextBuildTokenEstimate;
  tokenComponents?: ContextTokenComponent[];
  imageInputAdmissionEvidence?: ImageInputAdmissionEvidence;
  contextCompactionPolicy: ResolvedContextCompactionPolicy;
  contextCompactionCandidate?: ContextCompactionCandidate;
}

export function buildContextResult<TBuildStats>(
  options: BuildContextResultOptions<TBuildStats>,
) {
  const {
    finalMessages,
    finalTokens,
    totalBudget,
    originalCount,
    strategiesApplied,
    buildStats,
    enableBuildStats,
    estimateTokens,
    coreTypes,
    recommendations,
    tokenUsageMeasurement,
    inputBudgetTokens = totalBudget,
    toolDefinitionTokens = 0,
    promptUsageMeasurementPolicy,
    contextTrace,
    tokenEstimate,
    tokenComponents,
    imageInputAdmissionEvidence,
    contextCompactionPolicy,
    contextCompactionCandidate,
  } = options;

  const tokenDistribution = calculateTokenDistribution(
    finalMessages,
    estimateTokens,
    coreTypes,
  );

  const processingStats = {
    originalCount,
    keptCount: finalMessages.length,
    truncatedCount: originalCount - finalMessages.length,
    tokenDistribution,
    strategiesApplied,
    recommendations,
    buildStats: enableBuildStats ? buildStats : undefined,
  };

  return {
    messages: finalMessages,
    tokenUsage: {
      used: finalTokens,
      remaining: totalBudget - finalTokens,
      messageBudget: totalBudget,
      inputBudget: inputBudgetTokens,
      toolDefinitionTokens,
      source: tokenUsageMeasurement.source,
      confidence: tokenUsageMeasurement.confidence,
    },
    promptUsageMeasurementPolicy,
    processingStats,
    truncated: originalCount !== finalMessages.length,
    truncatedCount:
      originalCount > finalMessages.length
        ? originalCount - finalMessages.length
        : undefined,
    strategies: {
      applied: strategiesApplied,
      recommendations,
    },
    ...(contextTrace ? { contextTrace } : {}),
    ...(tokenEstimate ? { tokenEstimate } : {}),
    ...(tokenComponents ? { tokenComponents } : {}),
    ...(imageInputAdmissionEvidence ? { imageInputAdmissionEvidence } : {}),
    contextCompactionPolicy,
    ...(contextCompactionCandidate ? { contextCompactionCandidate } : {}),
  };
}

export function generateContextRecommendations(
  stats: RecommendationStats,
  options: {
    totalBudget: number;
    processingTimeoutMs: number;
  },
): string[] {
  const recommendations: string[] = [];
  const usagePercentage =
    Object.values(stats.phaseTokenUsage).reduce(
      (sum, phase) => sum + phase.used,
      0,
    ) / options.totalBudget;

  if (usagePercentage > 0.9) {
    recommendations.push('预算使用率较高，建议增加Token预算或减少输入长度');
  }

  if (stats.documentTruncated) {
    recommendations.push('文档片段被截断，建议分批处理或增加文档片段预算');
  }

  if (stats.totalTime > options.processingTimeoutMs) {
    recommendations.push('上下文构建耗时较长，建议优化消息预处理流程');
  }

  return recommendations;
}

function calculateTokenDistribution(
  finalMessages: AiMessage[],
  estimateTokens: (message: AiMessage) => number,
  coreTypes: readonly string[],
): Record<string, number> {
  const tokenDistribution: Record<string, number> = {
    core_context: 0,
    working_memory: 0,
    history_summary: 0,
  };
  const lastUserIndex = finalMessages
    .map(message => message.type)
    .lastIndexOf('user_input');

  finalMessages.forEach((message, index) => {
    const token = estimateTokens(message);
    if (message.metadata?.messageType === 'summary') {
      tokenDistribution.history_summary += token;
    } else if (
      coreTypes.includes(message.type) ||
      (message.type === 'user_input' && index === lastUserIndex)
    ) {
      tokenDistribution.core_context += token;
    } else {
      tokenDistribution.working_memory += token;
    }
  });

  return tokenDistribution;
}
