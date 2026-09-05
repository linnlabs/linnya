import { z } from 'zod';

/** 文档类型只向 Host 提供身份和时间，不暴露版本载荷。 */
export const DocumentVersionSummarySchema = z.object({
  versionId: z.string().min(1),
  order: z.number().int().positive(),
  createdAt: z.number().int().nonnegative(),
  isCurrent: z.boolean(),
}).strict();

export type DocumentVersionSummary = z.infer<typeof DocumentVersionSummarySchema>;

/** 同一次查询的快照，避免列表和 current 分两次读取产生竞争。 */
export const DocumentVersionListSchema = z.array(DocumentVersionSummarySchema).superRefine((rows, ctx) => {
  const ids = new Set<string>();
  let previousOrder = Infinity;
  for (const [index, row] of rows.entries()) {
    if (ids.has(row.versionId) || row.order >= previousOrder) {
      ctx.addIssue({ code: 'custom', path: [index], message: '版本身份必须唯一，order 必须严格降序。' });
    }
    ids.add(row.versionId);
    previousOrder = row.order;
  }
  if (rows.length > 0 && (!rows[0].isCurrent || rows.filter(row => row.isCurrent).length !== 1)) {
    ctx.addIssue({ code: 'custom', message: '非空历史必须且只能以当前版本开头。' });
  }
});

export const DocumentVersionRestoreRequestSchema = z.object({
  documentId: z.string().min(1),
  versionId: z.string().min(1),
  expectedCurrentVersionId: z.string().min(1),
}).strict();

export type DocumentVersionRestoreRequest = z.infer<typeof DocumentVersionRestoreRequestSchema>;

export const DocumentHistoryFailureCodeSchema = z.enum([
  'document_not_found',
  'history_unavailable',
  'version_not_found',
  'version_conflict',
  'version_corrupt',
  'preview_failed',
  'restore_failed',
]);

export type DocumentHistoryFailureCode = z.infer<typeof DocumentHistoryFailureCodeSchema>;

export const DocumentHistoryListRequestSchema = z.object({ documentId: z.string().min(1) }).strict();
const failure = z.object({ success: z.literal(false), code: DocumentHistoryFailureCodeSchema }).strict();
export const DocumentHistoryListResponseSchema = z.discriminatedUnion('success', [
  z.object({ success: z.literal(true), recent: z.array(DocumentVersionSummarySchema), earlier: z.array(DocumentVersionSummarySchema) }).strict(),
  failure,
]);
export const DocumentHistoryRestoreResponseSchema = z.discriminatedUnion('success', [
  z.object({ success: z.literal(true), current: DocumentVersionSummarySchema }).strict(),
  failure,
]);
export type DocumentHistoryListResponse = z.infer<typeof DocumentHistoryListResponseSchema>;
export type DocumentHistoryRestoreResponse = z.infer<typeof DocumentHistoryRestoreResponseSchema>;
