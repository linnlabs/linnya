import { ModelEmbeddingRouteSchema, type ModelEmbeddingRoute } from '@app/schemas/model-inference';
import { ModelAdmissionError } from '../../../definitions/modelAdmissionError';

export function readModelEmbeddingRoute(
  value: unknown,
  source: { modelName: string; hasEmbeddingCapability: boolean }
): ModelEmbeddingRoute | undefined {
  if (value === undefined || value === null) {
    if (source.hasEmbeddingCapability) {
      throw new ModelAdmissionError(
        'invalid_route',
        '[ModelConfigProcessor] embedding 模型必须声明 embedding_route。'
      );
    }
    return undefined;
  }

  const result = ModelEmbeddingRouteSchema.safeParse(value);
  if (!result.success) {
    const issue = result.error.issues[0];
    const field = issue?.path.length
      ? `embedding_route.${issue.path.join('.')}`
      : 'embedding_route';
    throw new ModelAdmissionError(
      'invalid_route',
      `[ModelConfigProcessor] ${field} 无效：${issue?.message ?? '未知错误'}。`
    );
  }
  if (result.data.endpoint_model_id !== source.modelName) {
    throw new ModelAdmissionError(
      'invalid_route',
      '[ModelConfigProcessor] embedding_route.endpoint_model_id 必须与 model_name 一致。'
    );
  }
  return result.data;
}
