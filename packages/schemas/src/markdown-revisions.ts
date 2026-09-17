import { z } from 'zod';

/** Pending ID 表达一次未决修改；revision 表达这次修改的内容版本。 */
export const MarkdownPendingRevisionSchema = z.object({
  id: z.string().min(1),
  revision: z.number().int().positive(),
  blockId: z.string().min(1),
  newMarkdown: z.string(),
  source: z.enum(['ai', 'user', 'tool']),
  operation: z.enum(['insert', 'update', 'delete']).nullable(),
  metaJson: z.string().nullable(),
  createdAt: z.number(),
  updatedAt: z.number().nullable(),
}).strict();
export type MarkdownPendingRevisionDTO = z.infer<typeof MarkdownPendingRevisionSchema>;

export const MarkdownRevisionSnapshotSchema = z.object({
  content: z.unknown(),
  pendingRevisions: z.array(MarkdownPendingRevisionSchema),
  versionNumber: z.number().int().positive(),
}).strict();
export type MarkdownRevisionSnapshot = z.infer<typeof MarkdownRevisionSnapshotSchema>;

export const MarkdownRevisionCommitSchema = z.object({
  documentId: z.string().min(1),
  expectedVersionNumber: z.number().int().positive(),
  expectedPending: z.array(z.object({ id: z.string().min(1), revision: z.number().int().positive() }).strict()),
  // 本地基线和修订决策同事务提交，不能先清 Pending 再等待自动保存。
  baseline: z.unknown(),
  decision: z.union([
    z.object({ mode: z.enum(['accept', 'reject']), blockId: z.string().min(1).optional() }).strict(),
    // 行内部分接受/拒绝后，基线和剩余提议都必须落库；null 表示该块已完全处理。
    z.object({ mode: z.literal('resolve'), blockId: z.string().min(1), remainingMarkdown: z.string().nullable() }).strict(),
  ]).optional(),
}).strict();
export type MarkdownRevisionCommit = z.infer<typeof MarkdownRevisionCommitSchema>;
