import { ModelRerankingRouteSchema, type ModelRerankingRoute } from '@app/schemas/model-inference';

export function readModelRerankingRoute(
  value: unknown,
  source: { modelName: string; hasRerankCapability: boolean },
): ModelRerankingRoute | undefined {
  if (value === undefined || value === null) {
    if (source.hasRerankCapability) {
      throw new Error('[ModelConfigProcessor] rerank 模型必须声明 reranking_route。');
    }
    return undefined;
  }
  const result = ModelRerankingRouteSchema.safeParse(value);
  if (!result.success) {
    const issue = result.error.issues[0];
    const field = issue?.path.length ? `reranking_route.${issue.path.join('.')}` : 'reranking_route';
    throw new Error(`[ModelConfigProcessor] ${field} 无效：${issue?.message ?? '未知错误'}。`);
  }
  if (result.data.endpoint_model_id !== source.modelName) {
    throw new Error('[ModelConfigProcessor] reranking_route.endpoint_model_id 必须与 model_name 一致。');
  }
  return result.data;
}
