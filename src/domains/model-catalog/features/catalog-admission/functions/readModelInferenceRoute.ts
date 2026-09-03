import {
  ModelInferenceRouteSchema,
  type ModelInferenceRoute,
} from '@app/schemas/model-inference';

interface ModelInferenceRouteSource {
  readonly modelName: string;
  readonly hasChatCapability: boolean;
}

export function readModelInferenceRoute(
  value: unknown,
  source: ModelInferenceRouteSource
): ModelInferenceRoute | undefined {
  if (value === undefined || value === null) {
    if (source.hasChatCapability) {
      throw new Error('[ModelConfigProcessor] chat 模型必须声明 inference_route。');
    }
    return undefined;
  }

  const result = ModelInferenceRouteSchema.safeParse(value);
  if (!result.success) {
    const issue = result.error.issues[0];
    const field = issue?.path.length ? `inference_route.${issue.path.join('.')}` : 'inference_route';
    throw new Error(`[ModelConfigProcessor] ${field} 无效：${issue?.message ?? '未知错误'}。`);
  }
  const route = result.data;

  if (route.endpoint_model_id !== source.modelName) {
    throw new Error(
      `[ModelConfigProcessor] inference_route.endpoint_model_id 必须与 model_name 一致: ${route.endpoint_model_id} !== ${source.modelName}`
    );
  }
  return route;
}
