import type { PluginInferencePort } from '@plugin/backend/inferenceRuntime';

/** Backend 内执行的检索/重建/续页也归 activation，不能只取消 Worker 中的模型请求。 */
export function scopeKnowledgeInference(
  port: PluginInferencePort,
  signal: AbortSignal
): PluginInferencePort {
  const combine = (requestSignal?: AbortSignal) =>
    requestSignal ? AbortSignal.any([signal, requestSignal]) : signal;
  return {
    embedding: {
      embed: request => port.embedding.embed({ ...request, signal: combine(request.signal) }),
    },
    reranking: {
      rerank: request => port.reranking.rerank({ ...request, signal: combine(request.signal) }),
    },
    textGeneration: {
      generate: request =>
        port.textGeneration.generate({ ...request, signal: combine(request.signal) }),
    },
    documentOcr: {
      resolveModelProfile: modelId => port.documentOcr.resolveModelProfile(modelId),
      recognizeDocument: request =>
        port.documentOcr.recognizeDocument({
          ...request,
          options: { ...request.options, signal: combine(request.options?.signal) },
        }),
    },
  };
}
