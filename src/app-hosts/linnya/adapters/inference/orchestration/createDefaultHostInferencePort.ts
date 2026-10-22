import type { CanonicalInferencePort } from '@linnlabs/linnkit/ports';
import { modelCatalog } from 'src/domains/model-catalog';
import { providerConfigurationRegistry } from 'src/domains/provider-configuration';
import { version } from '../../../../../../package.json';
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
import { createLinnyaAiSdkInferenceCapability } from '../features/ai-sdk-language-composition/orchestration/createLinnyaAiSdkInferenceCapability';
import { createLinnyaAiSdkLanguageModelRegistry } from '../features/ai-sdk-language-composition/orchestration/createLinnyaAiSdkLanguageModelRegistry';
import { getCurrentInferenceSessionId } from '../features/request-session';
import { projectInferenceRequestIdentity } from '../functions/projectInferenceRequestIdentity';

export interface DefaultHostInferencePortDependencies {
  readonly model_catalog?: InferenceModelCatalog;
  readonly credential_resolver?: InferenceCredentialResolver;
  readonly language_models?: AiSdkLanguageModelRegistry;
  readonly outbound_diagnostics?: ProviderOutboundDiagnosticsPort;
  /** Worker 注入只读配置快照；App Server 使用唯一的运行中 Provider registry。 */
  readonly resolve_provider_connection_id?: (modelId: string) => string | undefined;
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
  const catalog = dependencies.model_catalog ?? defaultModelCatalog;
  const languageModels = dependencies.language_models ?? createLinnyaAiSdkLanguageModelRegistry();
  const diagnosticSink = createLinnyaAiSdkLanguageDiagnosticSink();
  const resolveProviderConnectionId = dependencies.resolve_provider_connection_id
    ?? (modelId => providerConfigurationRegistry.getByModelConfigId(modelId)
      ?.provider_connection_definition_id);
  const capabilityRegistry = createInferenceCapabilityRegistry([
    createMockInferenceCapability(),
    ...languageModels.entries.map(entry =>
      createLinnyaAiSdkInferenceCapability(entry.capability_id, entry.surface, {
        language_models: languageModels,
        diagnostic_sink: diagnosticSink,
      })
    ),
  ]);

  return createHostCanonicalInferencePort({
    model_catalog: catalog,
    capability_registry: capabilityRegistry,
    credential_resolver: dependencies.credential_resolver ?? defaultCredentialResolver,
    outbound_diagnostics: dependencies.outbound_diagnostics ?? defaultProviderOutboundDiagnostics,
    resolve_request_identity: (request, route) => projectInferenceRequestIdentity({
      request,
      route,
      client_version: version,
      conversation_session_id: getCurrentInferenceSessionId(),
      credential_reference: catalog.getModel(request.model_id)?.credential_reference,
      resolve_provider_connection_id: resolveProviderConnectionId,
    }),
  });
}
