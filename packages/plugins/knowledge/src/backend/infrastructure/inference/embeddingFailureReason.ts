import type { EmbeddingFailure } from '@plugin/backend/inferenceFailures';

/**
 * 嵌入模型调用失败的原因，决定告诉用户去哪里修：
 * - model-unavailable：模型目录里没有这个模型（已删除或未启用）、它不是嵌入模型，或服务商不认识它（HTTP 404）——去模型设置检查或换模型；
 * - credential：缺少 API Key，或服务商拒绝了密钥（HTTP 401/403）——去模型设置检查密钥；
 * - request-failed：其他失败（网络、服务端错误、限流、返回内容不合法等）——可能稍后重试就好，持续失败再检查服务。
 */
export type KnowledgeEmbeddingFailureReason = 'model-unavailable' | 'credential' | 'request-failed';

/**
 * 只按 Host 推理合同的结构化失败码分类（createEmbeddingPort 与 AI SDK 失败投影产出的 code），
 * 不读错误文字：文字是给诊断看的，会随 Host 措辞变化。新增 Host 失败码默认落到 request-failed。
 */
const MODEL_UNAVAILABLE_CODES: ReadonlySet<string> = new Set(['model_not_found', 'route_missing', 'provider_http_404']);
const CREDENTIAL_CODES: ReadonlySet<string> = new Set(['credential_missing', 'provider_http_401', 'provider_http_403']);

export function readKnowledgeEmbeddingFailureReason(failure: EmbeddingFailure): KnowledgeEmbeddingFailureReason {
  if (MODEL_UNAVAILABLE_CODES.has(failure.code)) return 'model-unavailable';
  if (CREDENTIAL_CODES.has(failure.code)) return 'credential';
  return 'request-failed';
}
