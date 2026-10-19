import { CHATGPT_CODEX_LANGUAGE_INFERENCE_ROUTE_PROFILE_ID } from '@app/schemas/model-inference';
import type {
  InferenceRequestIdentity,
  ResolvedInferenceAttemptRoute,
} from '../definitions/inferenceCapability';

/**
 * 协议 profile 与正式产品连接各自声明请求头；凭据只拥有账号身份头。
 * OpenCode Go 的会话亲和与 codec 无关，三种 wire surface 必须使用同一 Conversation 身份。
 */
export function projectInferenceProtocolHeaders(
  route: ResolvedInferenceAttemptRoute,
  identity?: InferenceRequestIdentity
): Readonly<Record<string, string>> | undefined {
  const headers = {
    ...(identity ? { 'User-Agent': identity.user_agent } : {}),
    ...(identity?.provider_connection_definition_id === 'opencode-go'
      ? { 'x-opencode-session': identity.session_id }
      : {}),
    ...(route.route_profile_id === CHATGPT_CODEX_LANGUAGE_INFERENCE_ROUTE_PROFILE_ID
      ? { 'OpenAI-Beta': 'responses=experimental' }
      : {}),
  };
  return Object.keys(headers).length > 0 ? headers : undefined;
}
