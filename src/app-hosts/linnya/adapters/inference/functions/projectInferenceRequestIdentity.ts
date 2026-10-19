import type { CanonicalInferenceRequest } from '@linnlabs/linnkit/ports';
import type {
  InferenceRequestIdentity,
  ResolvedInferenceAttemptRoute,
} from '../definitions/inferenceCapability';

interface InferenceRequestIdentityInput {
  readonly request: CanonicalInferenceRequest;
  readonly route: ResolvedInferenceAttemptRoute;
  readonly client_version: string;
  readonly conversation_session_id?: string;
  readonly resolve_provider_connection_id: (modelId: string) => string | undefined;
}

/**
 * Agent 使用 Host 注入的 Conversation 身份，跨轮次、重试和子运行保持稳定。
 * 无 Conversation 的独立文本生成只有一次调用范围，使用其 trace，不能拿每个 attempt 伪造会话。
 * 正式产品身份只读配置归属；Custom API 不按 URL、endpoint 前缀或模型名冒充正式 Provider。
 */
export function projectInferenceRequestIdentity(
  input: InferenceRequestIdentityInput
): InferenceRequestIdentity | undefined {
  if (input.route.api_surface === 'mock') return undefined;
  return {
    provider_connection_definition_id: input.resolve_provider_connection_id(input.request.model_id),
    session_id: input.conversation_session_id ?? input.request.invocation.trace_id,
    user_agent: `linnya/${input.client_version}`,
  };
}
