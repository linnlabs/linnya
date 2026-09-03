import { ErrorClassifier } from '../../shared/errorClassifier';
import { Logger } from '../../shared/logger';
import type { LlmCallOptions } from './caller.types';
import type { RetryFallbackDeps } from './retry-fallback';
import {
  evaluateModelInputCompatibility,
  type ModelInputRequirement,
} from './input-capabilities';
import type { LlmFallbackObserver } from './definitions/llmFallbackObserver';
import type { FallbackPromptCapacityAdmission } from './functions/evaluateFallbackPromptCapacity';

const logger = new Logger('LlmCaller');

export function tryPolicyModelSwitch(
  deps: RetryFallbackDeps,
  activeModelId: string,
  excludedModelIds: Set<string>,
  requirement: ModelInputRequirement,
  fallbackObserver: LlmFallbackObserver | undefined,
  error: Error,
  evaluateFallbackPromptCapacity?: (candidateModelId: string) => FallbackPromptCapacityAdmission,
): string | null {
  const activeModelConfig = deps.modelCatalog.getModelById(activeModelId);
  const policyDecision = deps.policyEngine.decideOnError(error, {
    modelId: activeModelId,
  });
  if (policyDecision.action !== 'switch_model') {
    return null;
  }

  let fallbackModelId = deps.modelResolver.pickFallbackChatModel(excludedModelIds, requirement);
  while (fallbackModelId && evaluateFallbackPromptCapacity) {
    const admission = evaluateFallbackPromptCapacity(fallbackModelId);
    if (admission.admitted) break;
    fallbackObserver?.onModelFallbackRejected?.({
      fromModelId: activeModelId,
      candidateModelId: fallbackModelId,
      policy: 'policy-switch',
      reason: admission.reason,
      requiredPlacements: requirement.placements,
    });
    excludedModelIds.add(fallbackModelId);
    fallbackModelId = deps.modelResolver.pickFallbackChatModel(excludedModelIds, requirement);
  }
  if (!fallbackModelId) {
    fallbackObserver?.onModelFallbackRejected?.({
      fromModelId: activeModelId,
      policy: 'policy-switch',
      reason: 'no_eligible_fallback_candidate',
      requiredPlacements: requirement.placements,
    });
    logger.warn('Policy要求切换模型，但未找到可用备用模型（可能未配置 API Key）');
    return null;
  }

  logger.warn('Policy 切换模型继续', {
    reason: policyDecision.reason,
    activeModelId,
    fallbackModelId,
  });
  return fallbackModelId;
}

export function tryCloudQuotaFallback({
  deps,
  activeModelId,
  options,
  excludedModelIds,
  requirement,
  error,
  fallbackObserver,
  evaluateFallbackPromptCapacity,
}: {
  deps: RetryFallbackDeps;
  activeModelId: string;
  options: LlmCallOptions;
  excludedModelIds: Set<string>;
  requirement: ModelInputRequirement;
  error: Error;
  fallbackObserver?: LlmFallbackObserver;
  evaluateFallbackPromptCapacity?: (candidateModelId: string) => FallbackPromptCapacityAdmission;
}): string | null {
  const fallbackModelId = options.cloud_quota_fallback_model_id;
  if (
    !fallbackModelId ||
    !ErrorClassifier.isCloudQuotaError(error) ||
    excludedModelIds.has(fallbackModelId)
  ) {
    return null;
  }

  const fallbackConfig = deps.modelCatalog.getModelById(fallbackModelId);
  if (!fallbackConfig?.api_key) {
    fallbackObserver?.onModelFallbackRejected?.({
      fromModelId: activeModelId,
      candidateModelId: fallbackModelId,
      policy: 'cloud-quota',
      reason: 'fallback_model_unavailable',
      requiredPlacements: requirement.placements,
    });
    logger.warn('云端限额降级目标不可用（未注册或缺少 API Key）', { fallbackModelId });
    return null;
  }

  const compatibility = evaluateModelInputCompatibility(fallbackConfig, requirement);
  if (!compatibility.compatible) {
    fallbackObserver?.onModelFallbackRejected?.({
      fromModelId: activeModelId,
      candidateModelId: fallbackModelId,
      policy: 'cloud-quota',
      reason: compatibility.reason,
      requiredPlacements: requirement.placements,
    });
    logger.warn('云端限额降级目标不满足当前输入能力，保留原始错误', {
      fallbackModelId,
      requiredPlacements: requirement.placements,
      reason: compatibility.reason,
    });
    return null;
  }

  const capacityAdmission = evaluateFallbackPromptCapacity?.(fallbackModelId);
  if (capacityAdmission && !capacityAdmission.admitted) {
    fallbackObserver?.onModelFallbackRejected?.({
      fromModelId: activeModelId,
      candidateModelId: fallbackModelId,
      policy: 'cloud-quota',
      reason: capacityAdmission.reason,
      requiredPlacements: requirement.placements,
    });
    logger.warn('云端限额降级目标不满足当前 Prompt 容量要求，保留原始错误', {
      fallbackModelId,
      reason: capacityAdmission.reason,
    });
    return null;
  }

  logger.warn('云端限额降级（run 内续跑）', {
    activeModelId,
    fallbackModelId,
    reason: error.message,
  });
  fallbackObserver?.onCloudQuotaFallbackApplied?.(fallbackModelId);
  return fallbackModelId;
}
