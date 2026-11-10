import { z } from 'zod';

/** 对话一轮回复结束后，列出这些根运行（含子运行）改过的文档。 */
export const CONVERSATION_RUN_DOCUMENT_CHANGES_CHANNEL = 'conversation-run-document-changes:list' as const;

/** 一轮回复通常只有一个根运行；继续、恢复等少数情况下同一轮可能有多个。 */
export const CONVERSATION_RUN_DOCUMENT_CHANGES_MAX_RUNS = 20;

export const ConversationRunDocumentChangesRequestSchema = z.object({
  conversation_id: z.string().trim().min(1),
  root_run_ids: z.array(z.string().trim().min(1)).min(1).max(CONVERSATION_RUN_DOCUMENT_CHANGES_MAX_RUNS),
}).strict();

export const ConversationRunDocumentChangeSchema = z.object({
  document_id: z.string().min(1),
  project_id: z.string().min(1),
  node_type: z.string().min(1),
  title: z.string().min(1),
  parent_id: z.string().min(1).nullable(),
  /** `deleted` 是已删除但账本仍保留的文档，不能打开。 */
  presence: z.enum(['present', 'deleted']),
  /** 这些运行里新建了它；否则只修改了已有文档。 */
  created: z.boolean(),
  /** 只有主运行、只有子运行，或两者都改过。 */
  actor: z.enum(['run', 'subrun', 'mixed']),
  last_recorded_at: z.number().int().nonnegative(),
  /** 只对有待审阅修订的文档类型（内建 Markdown）给出；其他类型为 null。 */
  pending_revision_count: z.number().int().nonnegative().nullable(),
}).strict();

export const ConversationRunDocumentChangesSchema = z.object({
  /** 按最近改动倒序。 */
  documents: z.array(ConversationRunDocumentChangeSchema),
  /** 账本结果超出上限，列表不完整。 */
  truncated: z.boolean(),
}).strict();

export type ConversationRunDocumentChangesRequest = z.infer<typeof ConversationRunDocumentChangesRequestSchema>;
export type ConversationRunDocumentChange = z.infer<typeof ConversationRunDocumentChangeSchema>;
export type ConversationRunDocumentChanges = z.infer<typeof ConversationRunDocumentChangesSchema>;
