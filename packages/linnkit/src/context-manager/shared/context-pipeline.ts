import type {
  MessageProcessingState,
  ProviderContext,
} from './providers/base';
import { isContextProviderError } from './providers/base';
import type { ContextProviderRegistry } from './providers/registry';
import type { AiMessage } from '../../contracts';
import type { TokenUsageCalibrationTrace } from '../../contracts';
import type { ContextTraceCollector } from './context-trace';

export interface ContextPipelineStats<TPhase extends PropertyKey> {
  phaseTiming: Record<TPhase, number>;
  phaseTokenUsage: Record<TPhase, { used: number; percentage: number }>;
  messageStats: {
    original: number;
    afterCoreContext: number;
    afterWorkingMemory: number;
  };
}

export interface RunContextPipelineOptions<
  TConfig,
  TContext extends ProviderContext<TConfig>,
  TPhase extends PropertyKey,
  TStats extends ContextPipelineStats<TPhase>,
> {
  messages: AiMessage[];
  totalBudget: number;
  buildStats: TStats;
  providerRegistry: ContextProviderRegistry<TConfig>;
  providerContext: TContext;
  estimateTokens: (message: AiMessage) => {
    tokens: number;
    tokenCalibration?: TokenUsageCalibrationTrace;
  };
  getPhaseByProviderName: (providerName: string) => TPhase | null;
  debug?: (message: string, data?: Record<string, unknown>) => void;
  contextTrace?: ContextTraceCollector;
}

export interface RunContextPipelineResult {
  finalMessages: AiMessage[];
  finalTokens: number;
  strategiesApplied: string[];
  states: MessageProcessingState[];
}

export async function runContextPipeline<
  TConfig,
  TContext extends ProviderContext<TConfig>,
  TPhase extends PropertyKey,
  TStats extends ContextPipelineStats<TPhase>,
>(options: RunContextPipelineOptions<TConfig, TContext, TPhase, TStats>): Promise<RunContextPipelineResult> {
  const {
    messages,
    totalBudget,
    buildStats,
    providerRegistry,
    providerContext,
    estimateTokens,
    getPhaseByProviderName,
    debug,
    contextTrace,
  } = options;

  let states: MessageProcessingState[] = messages.map((message, index) => ({
    message,
    originalIndex: index,
    action: 'skip',
    ...estimateTokens(message),
  }));

  const providers = providerRegistry.getAllProviders();
  let availableBudget = totalBudget;
  const allStrategiesApplied: string[] = [];

  debug?.('🎯 [ContextPipeline] 开始 Provider 链式处理', {
    totalProviders: providers.length,
    providerOrder: providers.map(provider => `${provider.name}(优先级:${provider.priority})`),
  });

  for (const provider of providers) {
    const phaseStartTime = performance.now();

    if (provider.shouldSkip?.(states, availableBudget, providerContext)) {
      debug?.(`⏭️ 跳过Provider: ${provider.name}`, { availableBudget });
      contextTrace?.recordProvider({
        providerName: provider.name,
        skipped: true,
        durationMs: performance.now() - phaseStartTime,
        beforeStates: states,
        afterStates: states,
        tokensUsed: 0,
        strategiesApplied: [],
        remainingBudget: availableBudget,
      });
      continue;
    }

    debug?.(`🔄 执行Provider: ${provider.name}`, { availableBudget });

    try {
      const beforeStates = cloneStatesForTrace(states);
      const result = await provider.provide(states, availableBudget, providerContext);

      states = result.states;

      availableBudget -= result.tokensUsed;
      allStrategiesApplied.push(...result.strategiesApplied);
      contextTrace?.recordProvider({
        providerName: provider.name,
        skipped: false,
        durationMs: performance.now() - phaseStartTime,
        beforeStates,
        afterStates: states,
        tokensUsed: result.tokensUsed,
        strategiesApplied: result.strategiesApplied,
        remainingBudget: availableBudget,
      });

      const phaseName = getPhaseByProviderName(provider.name);
      if (phaseName !== null) {
        buildStats.phaseTiming[phaseName] = performance.now() - phaseStartTime;
        buildStats.phaseTokenUsage[phaseName] = {
          used: result.tokensUsed,
          percentage: (result.tokensUsed / totalBudget) * 100,
        };
      }

      debug?.(`✅ Provider完成: ${provider.name}`, {
        tokensUsed: result.tokensUsed,
        remainingBudget: availableBudget,
        processedCount: result.stats.processedCount,
        strategiesApplied: result.strategiesApplied,
      });
    } catch (error) {
      debug?.(`❌ Provider失败: ${provider.name}`, { error });

      if (!shouldContinueAfterProviderError(error)) {
        throw error;
      }
    }
  }

  buildStats.messageStats.afterCoreContext = states.filter(state => state.action === 'keep_core').length;
  buildStats.messageStats.afterWorkingMemory = states.filter(state => state.action.startsWith('keep_')).length;

  const finalMessages = generateFinalMessages(states);
  const finalTokens = finalMessages.reduce((total, message) => total + estimateTokens(message).tokens, 0);
  contextTrace?.recordMessageDecisions(states);

  return {
    finalMessages,
    finalTokens,
    strategiesApplied: [...new Set(allStrategiesApplied)],
    states,
  };
}

function cloneStatesForTrace(states: ReadonlyArray<MessageProcessingState>): MessageProcessingState[] {
  return states.map(state => ({ ...state }));
}

export function generateFinalMessages(states: MessageProcessingState[]): AiMessage[] {
  const sysPromptMessages: MessageProcessingState[] = [];
  const summaryMessages: MessageProcessingState[] = [];
  const otherMessages: MessageProcessingState[] = [];

  for (const state of states) {
    if (!state.action.startsWith('keep_')) {
      continue;
    }

    if (state.message.type === 'system_prompt') {
      sysPromptMessages.push(state);
    } else if (state.message.type === 'history_summary') {
      summaryMessages.push(state);
    } else {
      otherMessages.push(state);
    }
  }

  sysPromptMessages.sort((a, b) => a.originalIndex - b.originalIndex);
  summaryMessages.sort((a, b) => a.originalIndex - b.originalIndex);
  otherMessages.sort((a, b) => a.originalIndex - b.originalIndex);

  const finalStates: MessageProcessingState[] = [
    ...sysPromptMessages,
    ...summaryMessages,
    ...otherMessages,
  ];

  return finalStates.map(state => {
    return {
      ...state.message,
      content: state.overrideContent ?? state.message.content,
      ...(state.overrideMetadata ? { metadata: state.overrideMetadata } : {}),
    };
  });
}

export function shouldContinueAfterProviderError(error: unknown): boolean {
  return isContextProviderError(error) && error.fatal === false;
}
