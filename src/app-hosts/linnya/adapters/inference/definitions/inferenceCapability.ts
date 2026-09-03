import type { CanonicalInferenceEvent, CanonicalInferenceRequest } from 'linnkit/ports';
import type { LanguageInferenceRouteProfileId } from '@app/schemas/model-inference';
import type {
  InferenceApiSurface,
  ModelConfig,
  ModelInferenceRoute,
} from 'src/domains/model-catalog';
import type {
  ModelRequestCredential,
  ModelRequestCredentialRequest,
  ModelRequestCredentialResolver,
} from '../../model-request-auth';

export interface ResolvedInferenceAttemptRoute extends ModelInferenceRoute {
  readonly model_id: string;
  readonly route_profile_id: LanguageInferenceRouteProfileId;
  /** 已由 Host auth boundary 解析的 attempt headers；不得包含 Authorization/API key。 */
  readonly headers?: Readonly<Record<string, string>>;
}

export type InferenceCredential = ModelRequestCredential;
export type InferenceCredentialRequest = ModelRequestCredentialRequest;
export type InferenceCredentialResolver = ModelRequestCredentialResolver;

export interface InferenceCapabilityInvocation {
  readonly request: CanonicalInferenceRequest;
  readonly route: ResolvedInferenceAttemptRoute;
  readonly credential?: InferenceCredential;
}

export interface InferenceCapability {
  readonly id: string;
  readonly api_surface: InferenceApiSurface;
  stream(invocation: InferenceCapabilityInvocation): AsyncIterable<CanonicalInferenceEvent>;
}

export interface InferenceCapabilityRegistry {
  get(capabilityId: string): InferenceCapability | undefined;
}

export interface InferenceModelCatalog {
  getModel(modelId: string): ModelConfig | undefined;
  getInferenceRouteProfileId(modelId: string): LanguageInferenceRouteProfileId | undefined;
}
