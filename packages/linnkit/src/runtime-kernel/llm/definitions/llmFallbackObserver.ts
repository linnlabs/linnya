import type { ModelInputPlacement } from '../input-capabilities';
import type { ContextUsageSnapshot } from '../../../contracts';

export type ModelFallbackPolicy = 'policy-switch' | 'cloud-quota';

export interface ModelFallbackAppliedInfo {
  readonly fromModelId: string;
  readonly toModelId: string;
  readonly reason: string;
  readonly policy: ModelFallbackPolicy;
}

export interface ModelFallbackRejectedInfo {
  readonly fromModelId: string;
  readonly candidateModelId?: string;
  readonly reason: string;
  readonly policy: ModelFallbackPolicy;
  readonly requiredPlacements: readonly ModelInputPlacement[];
}

export interface LlmFallbackObserver {
  /** 每次调用只在最终真实 provider attempt 成功后触发一次。 */
  readonly onLlmAttemptSucceeded?: (
    activeModelId: string,
    contextUsage?: ContextUsageSnapshot,
  ) => void;
  readonly onCloudQuotaFallbackApplied?: (fallbackModelId: string) => void;
  readonly onModelFallbackApplied?: (info: ModelFallbackAppliedInfo) => void;
  readonly onModelFallbackRejected?: (info: ModelFallbackRejectedInfo) => void;
}
