import type {
  AnyAgentEvent,
  ErrorEvent as AgentErrorEvent,
  StreamResetEvent,
} from '../events/agentEvents';
import { generateRuntimeEventId, generateTraceId } from '../../contracts';
import {
  ErrorClassifier,
  ErrorCategory,
  type ErrorClassification,
} from '../../shared/errorClassifier';
import type { CanonicalInferencePort, LlmInputMaterializerPort } from '../../ports';
import type { LlmCallOptions, LlmRequestMessage, LlmRetryConfig } from './caller.types';
import type { LLMPolicyErrorDecision, LLMPolicyMatchContext } from './policies/types';
import type { ModelCatalogLike } from './modelCatalog';
import type { ModelResolverLike } from './modelResolver';
import { tryCloudQuotaFallback, tryPolicyModelSwitch } from './retry-fallback-routing';
import { callLlmStream } from './streaming-adapter';
import { Logger } from '../../shared/logger';
import {
  callPlainCompletion,
  getLlmResultContent,
  getLlmResultToolCalls,
  type LlmCallResult,
} from './usage-telemetry';
import {
  hasLlmAttemptBudgetRemaining,
  resolveLlmMaxTotalAttempts,
} from './functions/retryAttemptBudget';
import type { ModelInputRequirement } from './input-capabilities';
import type { LlmFallbackObserver } from './definitions/llmFallbackObserver';
import { createLlmAgentErrorEvent } from './functions/createLlmAgentErrorEvent';
import type { LlmCallInvocationContext } from './definitions/llmCallInvocationContext';
import { runLlmInputPreflight } from './input-materialization';

const logger = new Logger('LlmCaller');

export interface RetryFallbackDeps {
  retryConfig: LlmRetryConfig;
  modelResolver: ModelResolverLike;
  modelCatalog: ModelCatalogLike;
  policyEngine: {
    decideOnError(error: Error, ctx: LLMPolicyMatchContext): LLMPolicyErrorDecision;
  };
  inferencePort: CanonicalInferencePort;
  llmInputMaterializer?: LlmInputMaterializerPort;
}

export interface CallWithRetriesParams {
  deps: RetryFallbackDeps;
  modelId: string;
  messages: LlmRequestMessage[];
  requirement: ModelInputRequirement;
  options?: LlmCallOptions;
  eventHandler?: (event: AnyAgentEvent) => void;
  signal?: AbortSignal;
  fallbackObserver?: LlmFallbackObserver;
  invocationContext?: LlmCallInvocationContext;
}

export async function callWithRetryFallback(params: CallWithRetriesParams): Promise<LlmCallResult> {
  const {
    deps,
    modelId,
    messages,
    requirement,
    options = {},
    eventHandler,
    signal,
    fallbackObserver,
    invocationContext,
  } = params;

  let lastError: Error | null = null;
  let actualAttempts = 0;
  let activeModelId = modelId;
  const excludedModelIds = new Set<string>([modelId]);
  const clientRetryEnabled = isClientRetryEnabledForModel(deps.modelCatalog, modelId, options);
  const configuredMaxRetries = deps.retryConfig.maxRetries;
  const maxTotalAttempts = resolveLlmMaxTotalAttempts({
    maxRetries: configuredMaxRetries,
    maxTotalAttempts: deps.retryConfig.maxTotalAttempts,
  });
  const traceId = generateTraceId();

  let previousAttemptTracker: LiveAttemptStreamTracker | undefined;

  if (!clientRetryEnabled) {
    const activeCfg = deps.modelCatalog.getModelById(modelId);
    logger.debug('客户端重试已禁用', {
      modelId,
      billing_mode: activeCfg?.billing_mode,
      reason:
        options.retry_policy === 'none'
          ? 'options.retry_policy=none'
          : 'model config (cloud billing or enable_client_retry=false)',
    });
  }

  for (let attempt = 0; attempt <= configuredMaxRetries; attempt++) {
    throwIfAborted(signal, '检测到取消信号，停止AI活动');

    if (previousAttemptTracker?.hasEmitted() && eventHandler) {
      eventHandler(previousAttemptTracker.buildResetEvent());
    }
    previousAttemptTracker = undefined;

    // 每次真实 attempt 都重新校验 active model 并重新物化；本地拒绝不计入 attempt。
    const resolvedMessages = await runLlmInputPreflight({
      activeModelId,
      messages,
      modelCatalog: deps.modelCatalog,
      materializer: deps.llmInputMaterializer,
      invocationContext,
      eventHandler,
      requirement,
    });
    const attemptContextUsage = invocationContext?.measurePromptUsage
      ? await invocationContext.measurePromptUsage(activeModelId, messages)
      : undefined;

    const isRetry = attempt > 0;
    let pendingErrorEvent: AgentErrorEvent | null = null;
    let streamedErrorClassification: ErrorClassification | undefined;
    const attemptTracker = eventHandler
      ? createLiveAttemptStreamTracker(eventHandler, evt => {
          pendingErrorEvent = evt;
        })
      : undefined;

    try {
      if (isRetry) {
        logger.info('LLM 调用重试', { attempt, configuredMaxRetries });
      }

      actualAttempts++;
      const llmResponse = attemptTracker
        ? await callLlmStream({
            inferencePort: deps.inferencePort,
            modelId: activeModelId,
            messages: resolvedMessages,
            options,
            eventHandler: attemptTracker.handle,
            onErrorClassification(classification) {
              streamedErrorClassification = classification;
            },
            signal,
            toolCallStreamingPolicies: invocationContext?.toolCallStreamingPolicies,
            traceId,
          })
        : await callPlainCompletion(
            deps.inferencePort,
            activeModelId,
            resolvedMessages,
            options,
            signal,
            traceId
          );

      const responseContent = getLlmResultContent(llmResponse);
      const toolCallsFromLLM = getLlmResultToolCalls(llmResponse);
      if (
        deps.retryConfig.enableEmptyResponseRetry &&
        !responseContent?.trim() &&
        !toolCallsFromLLM?.length
      ) {
        throw new Error('LLM返回了空响应');
      }

      logger.debug('LLM 调用成功', { attempts: actualAttempts, maxTotalAttempts });
      if (attemptContextUsage) {
        fallbackObserver?.onLlmAttemptSucceeded?.(activeModelId, attemptContextUsage);
      } else {
        fallbackObserver?.onLlmAttemptSucceeded?.(activeModelId);
      }
      return llmResponse;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (lastError.name === 'AbortError') {
        logger.info('LLM 调用已取消，不进入 provider failure 分类与重试流程', {
          attempt: attempt + 1,
          actualAttempts,
          maxTotalAttempts,
          reason: lastError.message,
        });
        throw lastError;
      }

      // 流式 onError 已完成分类；这里复用同一结果，避免重试判断与最终事件漂移。
      const classification =
        streamedErrorClassification ??
        ErrorClassifier.classify(lastError, { logPrefix: '[LlmCaller]' });
      const currentMaxRetries = clientRetryEnabled ? configuredMaxRetries : 0;

      logger.error('LLM 调用失败', {
        attempt: attempt + 1,
        maxAttempts: currentMaxRetries + 1,
        actualAttempts,
        maxTotalAttempts,
        error: lastError.message,
      });

      previousAttemptTracker = attemptTracker;

      if (!hasLlmAttemptBudgetRemaining({ actualAttempts, maxTotalAttempts })) {
        logger.error('已达到 LLM 总调用次数上限，停止重试/切模型', {
          actualAttempts,
          maxTotalAttempts,
        });
        emitFinalError(eventHandler, pendingErrorEvent, lastError, classification);
        throw lastError;
      }

      if (options.allow_model_fallback !== false) {
        const policySwitchModelId = tryPolicyModelSwitch(
          deps,
          activeModelId,
          excludedModelIds,
          requirement,
          fallbackObserver,
          lastError,
          invocationContext?.evaluateFallbackPromptCapacity,
        );
        if (policySwitchModelId) {
          fallbackObserver?.onModelFallbackApplied?.({
            fromModelId: activeModelId,
            toModelId: policySwitchModelId,
            reason: lastError.message,
            policy: 'policy-switch',
          });
          activeModelId = policySwitchModelId;
          excludedModelIds.add(policySwitchModelId);
          attempt -= 1;
          continue;
        }

        const quotaFallbackModelId = tryCloudQuotaFallback({
          deps,
          activeModelId,
          options,
          excludedModelIds,
          requirement,
          error: lastError,
          fallbackObserver,
          evaluateFallbackPromptCapacity: invocationContext?.evaluateFallbackPromptCapacity,
        });
        if (quotaFallbackModelId) {
          fallbackObserver?.onModelFallbackApplied?.({
            fromModelId: activeModelId,
            toModelId: quotaFallbackModelId,
            reason: lastError.message,
            policy: 'cloud-quota',
          });
          activeModelId = quotaFallbackModelId;
          excludedModelIds.add(quotaFallbackModelId);
          attempt -= 1;
          continue;
        }
      }

      if (classification.category === ErrorCategory.NON_RETRYABLE) {
        logger.error('错误不可重试，直接失败', { reason: classification.reason });
        emitFinalError(eventHandler, pendingErrorEvent, lastError, classification);
        throw lastError;
      }

      if (attempt >= currentMaxRetries) {
        logger.error('已达到最大重试次数，放弃重试', { maxRetries: currentMaxRetries });
        emitFinalError(eventHandler, pendingErrorEvent, lastError, classification);
        throw lastError;
      }

      const retryDelay = ErrorClassifier.calculateRetryDelay(
        classification,
        attempt,
        deps.retryConfig.retryDelayMs,
        60000
      );
      if (classification.category === ErrorCategory.RATE_LIMIT) {
        logger.warn('速率限制错误，延迟后重试', { retryDelay, reason: classification.reason });
      } else if (classification.category === ErrorCategory.RETRYABLE) {
        logger.warn('可重试错误，延迟后重试', { retryDelay, reason: classification.reason });
      }

      throwIfAborted(signal, '延迟等待前检测到取消信号，停止重试');
      if (retryDelay > 0) {
        await new Promise(resolve => setTimeout(resolve, retryDelay));
      }
    }
  }

  throw lastError || new Error('LLM调用在所有重试后都失败了');
}

function isClientRetryEnabledForModel(
  modelCatalog: ModelCatalogLike,
  modelId: string,
  options: LlmCallOptions
): boolean {
  if (options.retry_policy === 'none') return false;

  const cfg = modelCatalog.getModelById(modelId);
  // Cloud 每个 attempt 都可能已计费，因此不允许调用参数或模型配置破坏单次调用合同。
  if (cfg?.billing_mode === 'cloud') return false;
  if (options.retry_policy === 'client') return true;
  if (!cfg) return true;
  if (cfg.enable_client_retry === false) return false;
  return true;
}

function throwIfAborted(signal: AbortSignal | undefined, message: string): void {
  if (!signal?.aborted) return;
  logger.info(message);
  const reason = signal.reason;
  if (reason instanceof Error && reason.name === 'AbortError') throw reason;
  const reasonText =
    typeof reason === 'string' && reason.trim().length > 0 ? reason : 'stream_interrupted';
  const abortError = new Error(`Request interrupted: ${reasonText}`);
  abortError.name = 'AbortError';
  throw abortError;
}

interface LiveAttemptStreamTracker {
  handle(event: AnyAgentEvent): void;
  hasEmitted(): boolean;
  buildResetEvent(): StreamResetEvent;
}

function createLiveAttemptStreamTracker(
  eventHandler: (event: AnyAgentEvent) => void,
  setPendingErrorEvent: (event: AgentErrorEvent) => void
): LiveAttemptStreamTracker {
  let answerId: string | undefined;
  const thoughtMessageIds = new Set<string>();

  return {
    handle(evt: AnyAgentEvent): void {
      if (evt.type === 'error') {
        setPendingErrorEvent(evt);
        return;
      }

      if (evt.type === 'stream_chunk') {
        answerId = evt.answer_id;
        eventHandler(evt);
        return;
      }

      if (evt.type === 'thought') {
        const thoughtMessageId = evt.thought_message_id;
        if (typeof thoughtMessageId === 'string' && thoughtMessageId.length > 0) {
          thoughtMessageIds.add(thoughtMessageId);
        }
        eventHandler(evt);
        return;
      }

      eventHandler(evt);
    },
    hasEmitted(): boolean {
      return answerId !== undefined || thoughtMessageIds.size > 0;
    },
    buildResetEvent(): StreamResetEvent {
      return {
        type: 'stream_reset',
        id: generateRuntimeEventId(),
        timestamp: Date.now(),
        ...(answerId !== undefined ? { answer_id: answerId } : {}),
        ...(thoughtMessageIds.size > 0 ? { thought_message_ids: [...thoughtMessageIds] } : {}),
      };
    },
  };
}

function emitFinalError(
  eventHandler: ((event: AnyAgentEvent) => void) | undefined,
  pendingErrorEvent: AgentErrorEvent | null,
  error: Error,
  classification: ErrorClassification
): void {
  if (!eventHandler) return;
  eventHandler(pendingErrorEvent ?? createLlmAgentErrorEvent(error, classification));
}
