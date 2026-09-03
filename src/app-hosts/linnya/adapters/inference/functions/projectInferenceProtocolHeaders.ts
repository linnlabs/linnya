import { CHATGPT_CODEX_LANGUAGE_INFERENCE_ROUTE_PROFILE_ID } from '@app/schemas/model-inference';
import type { ResolvedInferenceAttemptRoute } from '../definitions/inferenceCapability';

/**
 * 请求 profile 拥有协议 Header；账号凭据只拥有账号身份 Header。
 * 这样同一份 ChatGPT OAuth 可安全复用于 Responses、模型发现和图片生成。
 */
export function projectInferenceProtocolHeaders(
  route: ResolvedInferenceAttemptRoute
): Readonly<Record<string, string>> | undefined {
  if (route.route_profile_id !== CHATGPT_CODEX_LANGUAGE_INFERENCE_ROUTE_PROFILE_ID) {
    return undefined;
  }
  return { 'OpenAI-Beta': 'responses=experimental' };
}
