import {
  ModelImageGenerationRouteSchema,
  type ModelImageGenerationRoute,
} from '@app/schemas/model-inference';

export function readModelImageGenerationRoute(
  value: unknown,
  source: { modelName: string; hasImageGenerationCapability: boolean },
): ModelImageGenerationRoute | undefined {
  if (value === undefined || value === null) {
    if (source.hasImageGenerationCapability) {
      throw new Error('[ModelConfigProcessor] image_generation 模型必须声明 image_generation_route。');
    }
    return undefined;
  }

  const result = ModelImageGenerationRouteSchema.safeParse(value);
  if (!result.success) {
    const issue = result.error.issues[0];
    const field = issue?.path.length
      ? `image_generation_route.${issue.path.join('.')}`
      : 'image_generation_route';
    throw new Error(`[ModelConfigProcessor] ${field} 无效：${issue?.message ?? '未知错误'}。`);
  }
  if (!source.hasImageGenerationCapability) {
    throw new Error('[ModelConfigProcessor] 非 image_generation 模型不能声明 image_generation_route。');
  }
  if (result.data.endpoint_model_id !== source.modelName) {
    throw new Error(
      '[ModelConfigProcessor] image_generation_route.endpoint_model_id 必须与 model_name 一致。',
    );
  }
  return result.data;
}
