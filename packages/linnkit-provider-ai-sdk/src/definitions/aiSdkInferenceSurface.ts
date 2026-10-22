import type { LanguageModelV4 } from '@ai-sdk/provider';
import type { ModelReasoningConfig } from '@linnlabs/linnkit/contracts';
import type { CanonicalInferenceEvent, CanonicalInferenceRequest } from '@linnlabs/linnkit/ports';
import type { AiSdkInferenceCapabilityId } from './aiSdkCapabilityIds';
import type { AiSdkProviderFailureClassifier } from '../features/failure-projection';

/** 当前唯一会改变 adapter 请求投影的 Host profile。 */
export const CHATGPT_CODEX_REQUEST_PROFILE_ID = 'chatgpt_codex_responses';

export type AiSdkInferenceSurface =
  | 'openai_chat_completions'
  | 'openai_responses'
  | 'anthropic_messages'
  | 'google_generative_ai'
  | 'cohere_chat'
  | 'ollama_chat';

export type AiSdkInferenceAuthProfile = 'none' | 'bearer' | 'api_key';
export type AiSdkCredentialProfile = Exclude<AiSdkInferenceAuthProfile, 'none'>;

/** Host 在完成产品路由和凭据解析后投影到 adapter 的最小 attempt route。 */
export interface AiSdkInferenceRoute {
  readonly model_id: string;
  readonly request_profile: string;
  readonly capability_id: AiSdkInferenceCapabilityId;
  readonly surface: AiSdkInferenceSurface;
  readonly endpoint_id: string;
  readonly endpoint_model_id: string;
  readonly base_url: string;
  /** Host 已完成模型与图片角色准入；省略时维持上游 codec 默认关闭。 */
  readonly tool_result_image?: true;
  readonly headers?: Readonly<Record<string, string>>;
}

export interface AiSdkInferenceCredential {
  readonly profile: AiSdkCredentialProfile;
  readonly secret: string;
}

export interface AiSdkInferenceCapabilityInvocation {
  readonly request: CanonicalInferenceRequest;
  readonly route: AiSdkInferenceRoute;
  readonly credential?: AiSdkInferenceCredential;
  /** Host 按当前 attempt 绑定的产品规则；共享 codec 不保存产品连接身份。 */
  readonly provider_failure_classifier?: AiSdkProviderFailureClassifier;
}

export interface AiSdkInferenceCapability {
  readonly id: AiSdkInferenceCapabilityId;
  readonly api_surface: AiSdkInferenceSurface;
  stream(
    invocation: AiSdkInferenceCapabilityInvocation
  ): AsyncIterable<CanonicalInferenceEvent>;
}

export interface AiSdkLanguageModelFactoryInput {
  readonly capability_id: AiSdkInferenceCapabilityId;
  readonly surface: AiSdkInferenceSurface;
  readonly endpoint_id: string;
  readonly endpoint_model_id: string;
  readonly base_url: string;
  readonly tool_result_image?: true;
  readonly headers?: Readonly<Record<string, string>>;
  readonly credential?: {
    readonly profile: AiSdkCredentialProfile;
    readonly secret: string;
  };
  readonly fetch?: typeof globalThis.fetch;
}

/**
 * 构建期固定的 Provider package 工厂声明。
 *
 * entry 只能把 attempt-scoped route/credential 交给第三方 package；不得包含模型名启发式、
 * request body 变换、SSE 解析或失败后的 codec fallback。
 */
export interface AiSdkLanguageModelFactoryEntry {
  readonly capability_id: AiSdkInferenceCapabilityId;
  readonly surface: AiSdkInferenceSurface;
  readonly auth_profiles: readonly AiSdkInferenceAuthProfile[];
  readonly package_name:
    | `@ai-sdk/${string}`
    | '@openrouter/ai-sdk-provider'
    | 'ai-sdk-ollama';
  readonly package_version: string;
  /** 只投影上游 SDK 已明确识别的能力；未知模型不产生产品能力声明。 */
  resolveModelReasoning?(endpointModelId: string): ModelReasoningConfig | undefined;
  createLanguageModel(input: AiSdkLanguageModelFactoryInput): LanguageModelV4;
}

export interface AiSdkLanguageModelRegistry {
  readonly entries: readonly AiSdkLanguageModelFactoryEntry[];
  resolveModelReasoning(
    input: Pick<AiSdkLanguageModelFactoryInput, 'capability_id' | 'endpoint_model_id'>
  ): ModelReasoningConfig | undefined;
  languageModel(input: AiSdkLanguageModelFactoryInput): LanguageModelV4;
}
