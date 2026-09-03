import { z } from 'zod';
import {
  ConversationIdSchema,
  ToolCallIdSchema,
  TurnIdSchema,
} from 'linnkit/contracts';
import type { ObservationPreviewMeta } from 'linnkit/runtime-kernel';

export const TOOL_OUTPUT_BLOB_FORMAT_VERSION = 2 as const;
export const TOOL_OUTPUT_BODY_FILE_NAME = 'body.utf16le' as const;
export const TOOL_OUTPUT_INDEX_FILE_NAME = 'body.index' as const;
export const TOOL_OUTPUT_MANIFEST_FILE_NAME = 'manifest.json' as const;
export const TOOL_OUTPUT_BODY_ENCODING = 'utf16le' as const;
export const TOOL_OUTPUT_BLOCK_CHAR_CAPACITY = 65_536;
export const TOOL_OUTPUT_INDEX_RECORD_BYTES = 64;
export const TOOL_OUTPUT_MANIFEST_MAX_BYTES = 64 * 1024;

const SafeCountSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);

export const ToolOutputBlobSourceNameSchema = z.string()
  .min(1)
  .refine((value) => value === value.trim(), 'tool name must not contain leading or trailing whitespace');

export const ToolOutputBlobInstanceIdSchema = z.string()
  .min(1)
  .refine(
    (value) => value === value.trim(),
    'instance identity must not contain leading or trailing whitespace',
  );

export const ToolOutputBlobUiMetaSchema = z.object({
  filename: z.string().min(1).optional(),
  doc_name: z.string().min(1).optional(),
  document_name: z.string().min(1).optional(),
  doc_type: z.string().min(1).optional(),
}).strict() satisfies z.ZodType<ObservationPreviewMeta>;

/**
 * 来源身份与正文分开冻结。blob ID 同时覆盖来源与正文摘要，因此相同文本不能跨对话复用归属。
 */
export const ToolOutputBlobSourceSchema = z.object({
  kind: z.literal('tool_output_text'),
  conversation_id: ConversationIdSchema,
  instance_id: ToolOutputBlobInstanceIdSchema,
  tool_name: ToolOutputBlobSourceNameSchema,
  turn_id: TurnIdSchema.optional(),
  tool_call_id: ToolCallIdSchema.optional(),
  meta: ToolOutputBlobUiMetaSchema.optional(),
}).strict();

export const ToolOutputBlobManifestSchema = ToolOutputBlobSourceSchema.extend({
  format_version: z.literal(TOOL_OUTPUT_BLOB_FORMAT_VERSION),
  body: z.object({
    file_name: z.literal(TOOL_OUTPUT_BODY_FILE_NAME),
    encoding: z.literal(TOOL_OUTPUT_BODY_ENCODING),
    char_count: SafeCountSchema.positive(),
    byte_count: SafeCountSchema.positive(),
    newline_count: SafeCountSchema,
    line_count: SafeCountSchema.positive(),
    sha256: Sha256Schema,
    block_char_capacity: z.literal(TOOL_OUTPUT_BLOCK_CHAR_CAPACITY),
    block_count: SafeCountSchema.positive(),
  }).strict(),
  index: z.object({
    file_name: z.literal(TOOL_OUTPUT_INDEX_FILE_NAME),
    record_bytes: z.literal(TOOL_OUTPUT_INDEX_RECORD_BYTES),
    byte_count: SafeCountSchema.positive(),
    sha256: Sha256Schema,
  }).strict(),
}).strict();

export type ToolOutputBlobSource = z.infer<typeof ToolOutputBlobSourceSchema>;
export type ToolOutputBlobManifest = z.infer<typeof ToolOutputBlobManifestSchema>;

export interface ToolOutputTextBlobSaveResult {
  readonly blobId: string;
  /** 已发布 manifest 的绝对路径；保留旧 save API 的 filePath 返回语义。 */
  readonly filePath: string;
  /** manifest 已经可读时，staging 清理失败只留给下次启动回收，不能把有效 blob 改写成保存失败。 */
  readonly stagingCleanup: 'complete' | 'pending';
}

export type ToolOutputTextBlobCommittedPrefixResult =
  | {
      readonly status: 'published';
      readonly blob: ToolOutputTextBlobSaveResult;
      /** 只统计 body/index 都已完整提交的 UTF-16 单位，不包含失败 block 的半成品。 */
      readonly persistedCharacters: number;
      readonly persistedLines: number;
    }
  | {
      readonly status: 'not_created';
      readonly reason: 'no_committed_block';
    };

export interface ToolOutputTextBlobWriter {
  /** 调用方必须串行 await；该背压只属于 store，不允许直接堵塞系统 pipe。 */
  append(text: string): Promise<void>;
  /** 幂等封存；manifest 发布成功后 blob 才对 reader 可见。 */
  finalize(): Promise<ToolOutputTextBlobSaveResult>;
  /**
   * append 中途失败后，只发布最后一个 body/index 共同提交的完整 block 前缀。
   * 没有完整 block 时返回明确的 not_created；调用方随后仍须 abort 清理 staging。
   */
  finalizeCommittedPrefix(): Promise<ToolOutputTextBlobCommittedPrefixResult>;
  /** 只清理本 writer 的 staging，不触碰已经发布的内容地址。 */
  abort(): Promise<void>;
}

export class ToolOutputStoreCleanupError extends Error {
  readonly operationError: unknown;
  readonly cleanupError: unknown;

  constructor(message: string, operationError: unknown, cleanupError: unknown) {
    super(message);
    this.name = 'ToolOutputStoreCleanupError';
    this.operationError = operationError;
    this.cleanupError = cleanupError;
  }
}
