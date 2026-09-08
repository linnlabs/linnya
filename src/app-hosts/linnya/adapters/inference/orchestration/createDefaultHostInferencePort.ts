import type { CanonicalInferencePort } from '@linnlabs/linnkit/ports';
import { modelCatalog } from 'src/domains/model-catalog';
import {
  defaultProviderOutboundDiagnostics,
  type ProviderOutboundDiagnosticsPort,
} from 'src/domains/provider-diagnostics/features/provider-outbound';
import {
  type AiSdkLanguageModelRegistry,
} from '@linnlabs/linnkit-provider-ai-sdk';
import { createHostCanonicalInferencePort } from './createHostCanonicalInferencePort';
import { createInferenceCapabilityRegistry } from '../registry/createInferenceCapabilityRegistry';
import { createMockInferenceCapability } from '../capabilities/mock';
import type {
  InferenceCredentialResolver,
  InferenceModelCatalog,
} from '../definitions/inferenceCapability';
import { createDefaultInferenceCredentialResolver } from './createDefaultInferenceCredentialResolver';
import { createLinnyaAiSdkLanguageDiagnosticSink } from '../features/ai-sdk-diagnostic-logging/orchestration/createLinnyaAiSdkLanguageDiagnosticSink';
import { linnyaProviderFailureClassifier } from '../features/provider-failure-policy/functions/classifyLinnyaProviderFailure';
import { createLinnyaAiSdkInferenceCapability } from '../features/ai-sdk-language-composition/orchestration/createLinnyaAiSdkInferenceCapability';
import { createLinnyaAiSdkLanguageModelRegistry } from '../features/ai-sdk-language-composition/orchestration/createLinnyaAiSdkLanguageModelRegistry';

export interface DefaultHostInferencePortDependencies {
  readonly model_catalog?: InferenceModelCatalog;
  readonly credential_resolver?: InferenceCredentialResolver;
  readonly language_models?: AiSdkLanguageModelRegistry;
  readonly outbound_diagnostics?: ProviderOutboundDiagnosticsPort;
}

const defaultModelCatalog: InferenceModelCatalog = {
  getModel: modelId => modelCatalog.getModel(modelId),
  getInferenceRouteProfileId: modelId => modelCatalog.getInferenceRouteProfileId(modelId),
};

const defaultCredentialResolver = createDefaultInferenceCredentialResolver();

/**
 * 生产 Host 的 inference composition root。
 * Model Catalog 继续拥有 route/credential reference，Host auth boundary 解析动态认证头，
 * AI SDK 只拥有 Provider codec。
 */
export function createDefaultHostInferencePort(
  dependencies: DefaultHostInferencePortDependencies = {}
): CanonicalInferencePort {
  const languageModels = dependencies.language_models ?? createLinnyaAiSdkLanguageModelRegistry();
  const diagnosticSink = createLinnyaAiSdkLanguageDiagnosticSink();
  const capabilityRegistry = createInferenceCapabilityRegistry([
    createMockInferenceCapability(),
    ...languageModels.entries.map(entry =>
      createLinnyaAiSdkInferenceCapability(entry.capability_id, entry.surface, {
        language_models: languageModels,
        provider_failure_classifier: linnyaProviderFailureClassifier,
        diagnostic_sink: diagnosticSink,
      })
    ),
  ]);

  return createHostCanonicalInferencePort({
    model_catalog: dependencies.model_catalog ?? defaultModelCatalog,
    capability_registry: capabilityRegistry,
    credential_resolver: dependencies.credential_resolver ?? defaultCredentialResolver,
    outbound_diagnostics: dependencies.outbound_diagnostics ?? defaultProviderOutboundDiagnostics,
  });
}
