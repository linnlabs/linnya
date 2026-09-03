import { z } from 'zod';
import { ConversationFileLocatorSchema } from '../file-locator';

const NonEmptyStringSchema = z.string()
  .refine(value => value.trim().length > 0, 'String must contain non-whitespace content');

/** generate_image 跨执行层与 Renderer 共享的稳定业务错误码。 */
export const IMAGE_GENERATION_TOOL_ERROR_CODES = Object.freeze({
  modelNotConfigured: 'image_generation.model_not_configured',
});

export const ImageGenerationArgsSchema = z.object({
  prompt: NonEmptyStringSchema,
  /** `2K/4K` 与 `WxH` 都是正式 provider 尺寸；具体枚举由当前模型配置约束。 */
  size: z.string().trim().min(1).default('1024x1024'),
  n: z.number().int().min(1).max(4).default(1),
}).strict();

/** 流式工具名刚确定、完整参数尚未到达时的唯一合法占位参数。 */
export const ImageGenerationPlaceholderArgsSchema = z.object({}).strict();

export const ImageGenerationMediaSchema = z.object({
  path: NonEmptyStringSchema,
  media_type: z.enum(['image/jpeg', 'image/png', 'image/webp']).optional(),
  width: z.number().finite().positive(),
  height: z.number().finite().positive(),
}).strict();

const ImageGenerationModelInputSchema = z.object({
  attachments: z.array(z.object({
    id: NonEmptyStringSchema,
    uri: NonEmptyStringSchema,
  }).strict()).min(1),
}).strict();

function requireUniqueImageGenerationIdentities(result: {
  readonly data: string | readonly string[];
  readonly media?: readonly z.infer<typeof ImageGenerationMediaSchema>[];
}, context: z.RefinementCtx): void {
  const paths = typeof result.data === 'string' ? [result.data] : result.data;
  const pathSet = new Set<string>();
  for (const path of paths) {
    if (pathSet.has(path)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['data'],
        message: `Image generation result contains duplicate image identity: ${path}`,
      });
    }
    pathSet.add(path);
  }

  const mediaPaths = new Set<string>();
  for (const [index, media] of (result.media ?? []).entries()) {
    if (mediaPaths.has(media.path)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['media', index, 'path'],
        message: `Image generation result contains duplicate media identity: ${media.path}`,
      });
    }
    mediaPaths.add(media.path);
  }
}

export const ImageGenerationResultSchema = z.object({
  data: z.union([
    ConversationFileLocatorSchema,
    z.array(ConversationFileLocatorSchema).min(1),
  ]),
  media: z.array(ImageGenerationMediaSchema).optional(),
  modelInput: ImageGenerationModelInputSchema.optional(),
  observation: NonEmptyStringSchema,
}).strict().superRefine(requireUniqueImageGenerationIdentities);

/** locator 上线前的图片生成事件，仅供 Renderer 历史回放。 */
export const HistoricalImageGenerationResultSchema = z.object({
  data: z.union([
    NonEmptyStringSchema,
    z.array(NonEmptyStringSchema).min(1),
  ]),
  media: z.array(ImageGenerationMediaSchema).optional(),
  observation: NonEmptyStringSchema,
}).strict().superRefine(requireUniqueImageGenerationIdentities);

export type ImageGenerationArgs = z.infer<typeof ImageGenerationArgsSchema>;
export type ImageGenerationMedia = z.infer<typeof ImageGenerationMediaSchema>;
export type ImageGenerationResult = z.infer<typeof ImageGenerationResultSchema>;
