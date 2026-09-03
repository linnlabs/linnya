import * as contextManager from '../../context-manager';
import type { AiMessage } from '../../contracts';
import type { LlmRequestMessage, TokenizerPort } from '../../ports';

type ContextPipelineStats<TPhase extends PropertyKey> = contextManager.ContextPipelineStats<TPhase>;
type ContextTraceCollector = contextManager.ContextTraceCollector;
type IContextProvider<TConfig = unknown> = contextManager.SharedContextProvider<TConfig>;
type IPreprocessor = contextManager.agentPreprocessors.IPreprocessor;
type MessageProcessingState = contextManager.MessageProcessingState;
type PreprocessorContext = contextManager.agentPreprocessors.PreprocessorContext;
type PreprocessorResult = contextManager.agentPreprocessors.PreprocessorResult;
type ProviderContext<TConfig = unknown> = contextManager.SharedProviderContext<TConfig>;
type ProviderResult = contextManager.ProviderResult;
type RunContextPipelineResult = contextManager.RunContextPipelineResult;

export interface ContextPipelineHarnessOptions {
  messages: AiMessage[];
  totalBudget?: number;
  debugMode?: boolean;
  estimateTokens?: (message: AiMessage) => number;
  tokenizer?: TokenizerPort;
  tokenizerModelId?: string;
}

export interface ContextPipelineHarness {
  runPreprocessors(preprocessors: IPreprocessor[]): Promise<PreprocessorResult>;
  createStates(coreMessageIds?: string[], messages?: AiMessage[]): MessageProcessingState[];
  runProvider(
    provider: IContextProvider,
    options?: { coreMessageIds?: string[]; messages?: AiMessage[]; contextPatch?: Partial<ProviderContext> }
  ): Promise<ProviderResult>;
  runPipeline<TConfig, TPhase extends PropertyKey, TStats extends ContextPipelineStats<TPhase>>(
    providers: IContextProvider<TConfig>[],
    options: {
      buildStats: TStats;
      providerContext: ProviderContext<TConfig>;
      getPhaseByProviderName: (providerName: string) => TPhase | null;
      messages?: AiMessage[];
      contextTrace?: ContextTraceCollector;
    },
  ): Promise<RunContextPipelineResult>;
}

function createDefaultProviderContext(
  options: ContextPipelineHarnessOptions,
  contextPatch?: Partial<ProviderContext>
): ProviderContext {
  const estimateTokens =
    options.estimateTokens ??
    (options.tokenizer
      ? (message: AiMessage) => options.tokenizer!.estimateMessage(message as LlmRequestMessage, options.tokenizerModelId)
      : () => 1);

  return {
    totalBudget: options.totalBudget ?? 100_000,
    config: contextManager.agentContext.AGENT_CONTEXT_BUILDER_CONFIG,
    debugMode: options.debugMode ?? false,
    estimateTokens,
    ...(contextPatch ?? {}),
  };
}

/**
 * 中文备注：
 * - ContextPipelineHarness 用于稳定复用“预处理 -> 状态化 -> Provider”三段测试流程；
 * - 它不内置任何业务 Provider，避免 testkit 与具体 feature 反向耦合；
 * - 调用侧只需要声明核心消息与预算，即可测试上下文不变量。
 */
export function createContextPipelineHarness(
  options: ContextPipelineHarnessOptions
): ContextPipelineHarness {
  return {
    async runPreprocessors(preprocessors: IPreprocessor[]): Promise<PreprocessorResult> {
      const ordered = [...preprocessors].sort((left, right) => left.priority - right.priority);
      let currentMessages = [...options.messages];
      const appliedStrategies: string[] = [];
      const preprocessorContext: PreprocessorContext = {
        debugMode: options.debugMode ?? false,
      };

      for (const preprocessor of ordered) {
        if (preprocessor.shouldSkip?.(currentMessages, preprocessorContext)) {
          continue;
        }
        const result = await preprocessor.process(currentMessages, preprocessorContext);
        currentMessages = result.messages;
        appliedStrategies.push(...result.appliedStrategies);
      }

      return {
        messages: currentMessages,
        stats: {
          originalCount: options.messages.length,
          processedCount: currentMessages.length,
          removedCount: options.messages.length - currentMessages.length,
          modifiedCount: appliedStrategies.length,
        },
        appliedStrategies,
      };
    },

    createStates(coreMessageIds: string[] = [], messages?: AiMessage[]): MessageProcessingState[] {
      const sourceMessages = messages ?? options.messages;
      const estimateTokens =
        options.estimateTokens ??
        (options.tokenizer
          ? (message: AiMessage) => options.tokenizer!.estimateMessage(message as LlmRequestMessage, options.tokenizerModelId)
          : () => 1);
      const coreIds = new Set(coreMessageIds);
      return sourceMessages.map((message, index) => ({
        message,
        originalIndex: index,
        action: coreIds.has(message.id) ? 'keep_core' : 'skip',
        tokens: estimateTokens(message),
      }));
    },

    async runProvider(
      provider: IContextProvider,
      runOptions?: { coreMessageIds?: string[]; messages?: AiMessage[]; contextPatch?: Partial<ProviderContext> }
    ): Promise<ProviderResult> {
      const providerMessages = runOptions?.messages ?? options.messages;
      const context = createDefaultProviderContext(options, runOptions?.contextPatch);
      const states = this.createStates(runOptions?.coreMessageIds ?? [], providerMessages);
      return provider.provide(states, context.totalBudget, context);
    },

    async runPipeline<TConfig, TPhase extends PropertyKey, TStats extends ContextPipelineStats<TPhase>>(
      providers: IContextProvider<TConfig>[],
      runOptions: {
        buildStats: TStats;
        providerContext: ProviderContext<TConfig>;
        getPhaseByProviderName: (providerName: string) => TPhase | null;
        messages?: AiMessage[];
        contextTrace?: ContextTraceCollector;
      },
    ): Promise<RunContextPipelineResult> {
      const registry = new contextManager.ContextProviderRegistry<TConfig>();
      for (const provider of providers) {
        registry.register(provider);
      }
      const pipelineMessages = runOptions.messages ?? options.messages;
      return contextManager.runContextPipeline({
        messages: pipelineMessages,
        totalBudget: options.totalBudget ?? 100_000,
        buildStats: runOptions.buildStats,
        providerRegistry: registry,
        providerContext: runOptions.providerContext,
        estimateTokens: (message) => ({ tokens: runOptions.providerContext.estimateTokens(message) }),
        getPhaseByProviderName: runOptions.getPhaseByProviderName,
        contextTrace: runOptions.contextTrace,
      });
    },
  };
}
