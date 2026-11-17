import { z } from 'zod';

export const CUSTOM_CAPABILITY_API_FORMATS = [
  {
    id: 'openai_embeddings',
    routeProfileId: 'openai_compatible_embeddings',
    kind: 'embedding',
    label: 'OpenAI Embeddings',
    defaultBasePath: '/v1',
  },
  {
    id: 'cohere_rerank',
    routeProfileId: 'cohere_compatible_reranking',
    kind: 'rerank',
    label: 'Cohere Rerank',
    defaultBasePath: '/v2',
  },
  {
    id: 'paddle_layout_parsing',
    routeProfileId: 'paddle_layout_parsing',
    kind: 'document_ocr',
    label: 'Paddle Layout Parsing',
    defaultBasePath: '',
  },
  {
    id: 'paddle_ocr_jobs',
    routeProfileId: 'paddle_ocr_jobs',
    kind: 'document_ocr',
    label: 'Paddle OCR Jobs',
    defaultBasePath: '',
  },
  {
    id: 'openai_images_generations',
    routeProfileId: 'openai_compatible_image_generation',
    kind: 'image_generation',
    label: 'OpenAI Images',
    defaultBasePath: '/v1',
  },
] as const;

export const CustomCapabilityApiFormatSchema = z.enum([
  'openai_embeddings',
  'cohere_rerank',
  'paddle_layout_parsing',
  'paddle_ocr_jobs',
  'openai_images_generations',
]);
export type CustomCapabilityApiFormat = z.infer<typeof CustomCapabilityApiFormatSchema>;
export type CustomCapabilityModelKind = (typeof CUSTOM_CAPABILITY_API_FORMATS)[number]['kind'];

const NonEmptyStringSchema = z.string().trim().min(1);

/** 类型由显式协议决定；不从模型名、URL 或发现列表推测能力。 */
export const CustomCapabilityModelCommandSchema = z
  .object({
    api_format: CustomCapabilityApiFormatSchema,
    provider_name: NonEmptyStringSchema,
    base_url: NonEmptyStringSchema,
    api_key: NonEmptyStringSchema.optional(),
    endpoint_model_id: NonEmptyStringSchema,
    display_name: NonEmptyStringSchema.optional(),
    ocr_mode: z.enum(['document_upload', 'page_image']).optional(),
    image_sizes: z.array(NonEmptyStringSchema).min(1).optional(),
  })
  .strict()
  .transform((command, context) => {
    const baseUrl = normalizeCustomCapabilityBaseUrl(command.api_format, command.base_url);
    if (!baseUrl) {
      context.addIssue({
        code: 'custom',
        path: ['base_url'],
        message: '请填写不带凭据或查询参数的 HTTP / HTTPS API 地址',
      });
      return z.NEVER;
    }
    const format = CUSTOM_CAPABILITY_API_FORMATS.find(item => item.id === command.api_format);
    if (!format) return z.NEVER;
    if (format.kind !== 'document_ocr' && command.ocr_mode !== undefined) {
      context.addIssue({
        code: 'custom',
        path: ['ocr_mode'],
        message: '只有 OCR 模型可以设置输入方式',
      });
    }
    if (format.kind === 'document_ocr' && command.ocr_mode === undefined) {
      context.addIssue({ code: 'custom', path: ['ocr_mode'], message: '请选择 OCR 输入方式' });
    }
    if (format.kind !== 'image_generation' && command.image_sizes !== undefined) {
      context.addIssue({
        code: 'custom',
        path: ['image_sizes'],
        message: '只有图片生成模型可以设置尺寸',
      });
    }
    if ((format.kind === 'rerank' || format.kind === 'document_ocr') && !command.api_key) {
      context.addIssue({ code: 'custom', path: ['api_key'], message: '此接口需要 API Key' });
    }
    return { ...command, base_url: baseUrl };
  });

export type CustomCapabilityModelRequest = z.input<typeof CustomCapabilityModelCommandSchema>;
export type CustomCapabilityModelCommand = z.output<typeof CustomCapabilityModelCommandSchema>;

export const CustomCapabilityTestResultSchema = z
  .object({
    message: NonEmptyStringSchema,
  })
  .strict();
export type CustomCapabilityTestResult = z.infer<typeof CustomCapabilityTestResultSchema>;

export function readCustomCapabilityFormatForProfile(
  profileId: string
): CustomCapabilityApiFormat | undefined {
  return CUSTOM_CAPABILITY_API_FORMATS.find(format => format.routeProfileId === profileId)?.id;
}

export const CustomCapabilityProviderUpdateCommandSchema = z
  .object({
    current_provider_name: NonEmptyStringSchema,
    provider_name: NonEmptyStringSchema,
    base_url: NonEmptyStringSchema.url(),
    api_key: NonEmptyStringSchema.optional(),
  })
  .strict();
export type CustomCapabilityProviderUpdateCommand = z.infer<
  typeof CustomCapabilityProviderUpdateCommandSchema
>;

/** 纯域名按明确协议补基础路径；已填写的路径不猜测、不追加第二遍。 */
export function normalizeCustomCapabilityBaseUrl(
  formatId: CustomCapabilityApiFormat,
  value: string
): string | undefined {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return undefined;
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    return undefined;
  const format = CUSTOM_CAPABILITY_API_FORMATS.find(item => item.id === formatId);
  if (!format) return undefined;
  if (url.pathname === '/') url.pathname = format.defaultBasePath;
  return url.toString().replace(/\/+$/, '');
}
