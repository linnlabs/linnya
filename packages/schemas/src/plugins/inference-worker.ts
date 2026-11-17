import { z } from 'zod';

const modelId = z.string().min(1);
const imageMediaType = z.enum(['image/jpeg', 'image/png', 'image/webp']);
const bytes = z.instanceof(Uint8Array);

/** 受管 Worker 到 Host 的实际推理请求；不接受 provider、endpoint 或凭据字段。 */
export const PluginWorkerEmbeddingInputSchema = z.object({
  modelId,
  values: z.array(z.string()),
  expectedSpaceId: z.string().min(1).optional(),
  maxParallelCalls: z.number().int().positive().optional(),
}).strict();

export const PluginWorkerTextInputSchema = z.object({
  modelId,
  messages: z.array(z.discriminatedUnion('role', [
    z.object({ role: z.literal('system'), content: z.string() }).strict(),
    z.object({ role: z.literal('user'), content: z.array(z.discriminatedUnion('type', [
      z.object({ type: z.literal('text'), text: z.string() }).strict(),
      z.object({ type: z.literal('image'), mediaType: imageMediaType, bytes }).strict(),
    ])) }).strict(),
  ])),
  temperature: z.number().optional(),
  topP: z.number().optional(),
  maxOutputTokens: z.number().int().positive().optional(),
  reasoningEffort: z.enum(['none', 'minimal', 'low', 'medium', 'high', 'xhigh']).optional(),
}).strict();

export const PluginWorkerOcrProfileInputSchema = z.object({ modelId }).strict();
export const PluginWorkerOcrInputSchema = z.object({
  modelId,
  input: z.discriminatedUnion('kind', [
    // Host 必须验证文件属于当前任务；wire 字符串本身不是读取授权。
    z.object({ kind: z.literal('pdf_path'), path: z.string().min(1) }).strict(),
    z.object({ kind: z.literal('image_base64'), base64: z.string(),
      mimeType: z.enum(['image/jpeg', 'image/png']), pageNumber: z.number().int().positive() }).strict(),
  ]),
  options: z.object({ optionalPayload: z.record(z.string(), z.unknown()).optional() }).strict().optional(),
}).strict();

export const PluginWorkerEmbeddingResultSchema = z.object({
  vectors: z.array(z.array(z.number())),
  spaceId: z.string().min(1),
  usage: z.object({ inputTokens: z.number().optional(), raw: z.array(z.unknown()) }).optional(),
});
export const PluginWorkerTextResultSchema = z.object({
  text: z.string(), reasoning: z.string(), finishReason: z.enum(['stop', 'length', 'content_filter']),
});
export const PluginWorkerOcrProfileSchema = z.object({
  modelId, displayName: z.string(), mode: z.enum(['document_upload', 'page_image']),
  supportsAbortSignal: z.boolean(), attemptTimeoutMs: z.number(), maxInputPages: z.number().optional(),
}).optional();
export const PluginWorkerOcrResultSchema = z.object({
  pages: z.array(z.object({ pageNumber: z.number(), markdown: z.string(),
    images: z.record(z.string(), z.string()).optional(), outputImages: z.record(z.string(), z.string()).optional() })),
  totalPages: z.number().optional(),
});
export const PluginWorkerOcrProgressSchema = z.object({
  state: z.enum(['submitted', 'pending', 'running', 'done']), totalPages: z.number().optional(),
  processedPages: z.number().optional(), message: z.string().optional(),
});
export const PluginWorkerInferenceFailureSchema = z.object({
  name: z.string(), message: z.string(),
  kind: z.enum(['aborted', 'transport', 'provider', 'protocol']).optional(),
  code: z.string().optional(), retryable: z.boolean().optional(), statusCode: z.number().optional(),
});
