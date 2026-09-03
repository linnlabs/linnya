import { z } from 'zod';

export const IMAGE_GENERATION_CAPABILITY_IDS = {
  OPENAI_COMPATIBLE: 'ai-sdk:openai-compatible-image-generation',
} as const;

export const IMAGE_GENERATION_ROUTE_PROFILES = [{
  id: 'openai_compatible_image_generation',
  api_surface: 'openai_images_generations',
  capability_id: IMAGE_GENERATION_CAPABILITY_IDS.OPENAI_COMPATIBLE,
  auth_profiles: ['none', 'bearer'],
}] as const;

const NonEmptyStringSchema = z.string().trim().min(1);

/**
 * 图片 route 只描述 Provider 协议事实；尺寸列表和像素上下限属于模型产品约束。
 * `b64_json` 让生成结果以字节进入 Assets 发布门禁，禁止依赖临时上游 URL。
 */
export const ModelImageGenerationRouteSchema = z.object({
  api_surface: z.literal('openai_images_generations'),
  capability_id: z.literal(IMAGE_GENERATION_CAPABILITY_IDS.OPENAI_COMPATIBLE),
  endpoint_id: NonEmptyStringSchema,
  endpoint_model_id: NonEmptyStringSchema,
  base_url: NonEmptyStringSchema.transform(value => value.replace(/\/+$/, '')),
  auth_profile: z.enum(['none', 'bearer']),
  response_format: z.literal('b64_json'),
  max_images_per_call: z.number().int().min(1).max(10),
}).strict();

export type ModelImageGenerationRoute = z.infer<typeof ModelImageGenerationRouteSchema>;

export function parseModelImageGenerationRoute(value: unknown): ModelImageGenerationRoute {
  return ModelImageGenerationRouteSchema.parse(value);
}
