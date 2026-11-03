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
