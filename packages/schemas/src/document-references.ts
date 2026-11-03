import { z } from 'zod';

export const DocumentReferenceInputSchema = z.object({
  referenceId: z.string().min(1).max(256),
  targetDocumentId: z.string().min(1),
  kind: z.string().min(1).max(80),
}).strict();
export type DocumentReferenceInput = z.infer<typeof DocumentReferenceInputSchema>;
export const ReplaceDocumentReferencesInputSchema = z.object({
  sourceDocumentId: z.string().min(1),
  references: z.array(DocumentReferenceInputSchema),
}).strict();
export type ReplaceDocumentReferencesInput = z.infer<typeof ReplaceDocumentReferencesInputSchema>;
export const DocumentReferenceResolutionSchema = z.object({
  targetDocumentId: z.string(),
  status: z.enum(['available', 'deleted', 'outside_project']),
  title: z.string().nullable(),
  nodeType: z.string().nullable(),
}).strict();
export type DocumentReferenceResolution = z.infer<typeof DocumentReferenceResolutionSchema>;
export const DocumentBacklinkSchema = DocumentReferenceInputSchema.extend({
  sourceDocumentId: z.string(),
  sourceTitle: z.string(),
  sourceNodeType: z.string(),
});
export type DocumentBacklink = z.infer<typeof DocumentBacklinkSchema>;

export const InlineDocumentReferenceAttrsSchema = z.object({ documentId: z.string().min(1), referenceId: z.string().min(1) }).strict();
export const DocumentReferenceCandidateSchema = z.object({ documentId: z.string(), title: z.string(), nodeType: z.string(), path: z.string(), projectId: z.string() }).strict();
export const DocumentReferenceSearchRequestSchema = z.object({ projectId: z.string().min(1), keyword: z.string().max(256), limit: z.number().int().min(1).max(50).default(20) }).strict();
export const DocumentReferenceCandidatesSchema = z.array(DocumentReferenceCandidateSchema);
export const DocumentReferencePresentationRequestSchema = z.object({ projectId: z.string().min(1), documentId: z.string().min(1) }).strict();
export const DocumentReferencePresentationSchema = z.object({
  documentId: z.string(), status: z.enum(['available', 'deleted', 'outside_project', 'plugin_unavailable']), title: z.string().nullable(), nodeType: z.string().nullable(), path: z.string().nullable(),
}).strict();
export type DocumentReferenceCandidate = z.infer<typeof DocumentReferenceCandidateSchema>;
export type DocumentReferencePresentation = z.infer<typeof DocumentReferencePresentationSchema>;

/** 可信读取/准备生成，提交时再次核对命名空间；模型不能自行批准或提供身份 hash。 */
export const DocumentReferenceMarkdownBindingSchema = z.object({
  referenceId: z.string().min(1), targetDocumentId: z.string().min(1), path: z.string().startsWith('workspace:/'), label: z.string(),
}).strict();
export type DocumentReferenceMarkdownBinding = z.infer<typeof DocumentReferenceMarkdownBindingSchema>;

/** 只来自调用方正式历史/撤回记录的稳定出现位置身份，不是模型批准参数。 */
export const DocumentReferenceRetainedIdentitySchema = z.object({ referenceId: z.string().min(1).max(256), targetDocumentId: z.string().min(1) }).strict();
export type DocumentReferenceRetainedIdentity = z.infer<typeof DocumentReferenceRetainedIdentitySchema>;
