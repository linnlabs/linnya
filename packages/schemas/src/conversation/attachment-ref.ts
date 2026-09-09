import { z } from 'zod';

export const CONVERSATION_IMAGE_MAX_ATTACHMENTS = 100;
export const CONVERSATION_IMAGE_MAX_BYTES = 10 * 1024 * 1024;
/** 当前产品单条消息的图片聚合上限；具体 provider profile 可以进一步收窄。 */
export const CONVERSATION_IMAGE_MAX_TOTAL_BYTES = 100 * 1024 * 1024;

const NonBlankIdentitySchema = z.string().max(200).refine(
  value => value.trim().length > 0 && value === value.trim(),
  { message: '附件身份不能为空或包含首尾空白' },
);

const FileNameSchema = z.string().max(255).refine(
  value => value.trim().length > 0
    && value === value.trim()
    && !value.includes('/')
    && !value.includes('\\'),
  { message: '附件文件名必须是非空 basename，不能包含路径' },
);

const LabelSchema = z.string().max(200).refine(
  value => value.trim().length > 0 && value === value.trim(),
  { message: '附件标签不能为空或包含首尾空白' },
);

export const ConversationImageMediaTypeSchema = z.enum([
  'image/jpeg',
  'image/png',
  'image/webp',
]);

/** Renderer 上行只持有 host 签发的草稿身份；该引用绝不能进入持久化消息。 */
export const ConversationDraftAttachmentRefSchema = z.object({
  draftId: NonBlankIdentitySchema,
  kind: z.literal('image'),
  fileName: FileNameSchema.optional(),
  label: LabelSchema.optional(),
}).strict();

/** host commit 后生成的 durable 引用；下行 projection/history 只使用该合同。 */
export const ConversationAttachmentRefSchema = z.object({
  id: NonBlankIdentitySchema,
  kind: z.literal('image'),
  assetId: NonBlankIdentitySchema,
  mediaType: ConversationImageMediaTypeSchema,
  byteLength: z.number().int().positive().max(CONVERSATION_IMAGE_MAX_BYTES),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/, 'sha256 必须是 64 位小写十六进制'),
  fileName: FileNameSchema.optional(),
  label: LabelSchema.optional(),
}).strict();

export type ConversationImageMediaType = z.infer<typeof ConversationImageMediaTypeSchema>;
export type ConversationDraftAttachmentRef = z.infer<typeof ConversationDraftAttachmentRefSchema>;
export type ConversationAttachmentRef = z.infer<typeof ConversationAttachmentRefSchema>;
