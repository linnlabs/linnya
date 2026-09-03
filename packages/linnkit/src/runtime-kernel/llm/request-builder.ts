import type { CanonicalInferencePort, LlmInputMaterializerPort } from '../../ports';
import type { LlmRetryConfig } from './caller.types';
import type { LLMPolicyErrorDecision, LLMPolicyMatchContext } from './policies/types';
import type { ModelCatalogLike } from './modelCatalog';
import { ModelResolver, type ModelResolverLike } from './modelResolver';
import { defaultPolicyEngine } from './policies/defaultPolicyEngine';
import { resolveLlmMaxTotalAttempts } from './functions/retryAttemptBudget';

export interface LlmCallerOptions {
  maxRetries?: number;
  maxTotalAttempts?: number;
  enableEmptyResponseRetry?: boolean;
  retryDelayMs?: number;
  fallbackModelPreferredOrder?: readonly string[];
  modelResolver?: ModelResolverLike;
  modelCatalog: ModelCatalogLike;
  policyEngine?: {
    decideOnError(error: Error, ctx: LLMPolicyMatchContext): LLMPolicyErrorDecision;
  };
  inferencePort: CanonicalInferencePort;
  llmInputMaterializer?: LlmInputMaterializerPort;
}

export interface NormalizedLlmCallerDeps {
  retryConfig: LlmRetryConfig;
  modelResolver: ModelResolverLike;
  policyEngine: NonNullable<LlmCallerOptions['policyEngine']>;
  inferencePort: CanonicalInferencePort;
  llmInputMaterializer?: LlmInputMaterializerPort;
}

export function buildLlmCallerDeps(
  options: LlmCallerOptions,
): NormalizedLlmCallerDeps {
  const modelCatalog = options.modelCatalog;
  const maxRetries = options.maxRetries ?? 3;
  return {
    retryConfig: {
      maxRetries,
      maxTotalAttempts: resolveLlmMaxTotalAttempts({
        maxRetries,
        maxTotalAttempts: options.maxTotalAttempts,
      }),
      enableEmptyResponseRetry: options.enableEmptyResponseRetry ?? true,
      retryDelayMs: options.retryDelayMs ?? 1000,
    },
    modelResolver:
      options.modelResolver ??
      new ModelResolver({
        fallbackModelPreferredOrder: options.fallbackModelPreferredOrder,
        modelCatalog,
      }),
    policyEngine: options.policyEngine ?? defaultPolicyEngine,
    inferencePort: options.inferencePort,
    llmInputMaterializer: options.llmInputMaterializer,
  };
}
