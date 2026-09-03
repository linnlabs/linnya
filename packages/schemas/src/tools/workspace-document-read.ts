import { z } from 'zod';
import { CitationRefSchema, HttpCitationUrlSchema } from '../citation';
import { DocumentBlockIdSchema } from '../document-view';

const NonEmptyStringSchema = z.string().trim().min(1);
function requireUniqueIds(
  items: readonly { readonly id: string }[],
  context: z.RefinementCtx,
): void {
  const seen = new Set<string>();
  items.forEach((item, index) => {
    if (seen.has(item.id)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: [index, 'id'],
        message: 'presentation item ids must be unique',
      });
      return;
    }
    seen.add(item.id);
  });
}

export const WorkspaceDocumentReadBlockSchema = z.object({
  id: DocumentBlockIdSchema,
  ordinal: z.number().int().positive(),
  text: z.string(),
}).strict();

export const WorkspaceDocumentReadOutlineItemSchema = z.object({
  id: NonEmptyStringSchema,
  depth: z.number().int().nonnegative(),
  text: NonEmptyStringSchema,
  hasChildren: z.boolean(),
}).strict();

export const WorkspaceDocumentReadPresentationSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('blocks'),
    viewMode: z.enum(['preview', 'base']),
    viewLabel: NonEmptyStringSchema,
    items: z.array(WorkspaceDocumentReadBlockSchema).superRefine(requireUniqueIds),
  }).strict(),
  z.object({
    kind: z.literal('outline'),
    items: z.array(WorkspaceDocumentReadOutlineItemSchema).superRefine(requireUniqueIds),
  }).strict(),
  z.object({
    kind: z.literal('text'),
    text: z.string(),
  }).strict(),
]);

export const WorkspaceDocumentReadImageSchema = z.object({
  blockId: DocumentBlockIdSchema,
  locator: NonEmptyStringSchema,
  alt: z.string().optional(),
  width: z.number().positive().optional(),
  height: z.number().positive().optional(),
}).strict().superRefine((image, context) => {
  if ((image.width === undefined) !== (image.height === undefined)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'image width and height must appear together',
    });
  }
});

export const WorkspaceDocumentKnowledgeCitationSourceSchema = z.object({
  sourceType: z.literal('knowledge_base'),
  ref: CitationRefSchema,
  docId: NonEmptyStringSchema,
  blockId: NonEmptyStringSchema,
  kbId: NonEmptyStringSchema.optional(),
  docTitle: NonEmptyStringSchema,
  snippet: z.string(),
}).strict();

export const WorkspaceDocumentWebCitationSourceSchema = z.object({
  sourceType: z.literal('web'),
  ref: CitationRefSchema,
  url: HttpCitationUrlSchema,
  docTitle: NonEmptyStringSchema,
  snippet: z.string(),
  authors: z.array(NonEmptyStringSchema),
  publishedAt: NonEmptyStringSchema.optional(),
  containerTitle: NonEmptyStringSchema.optional(),
}).strict();

export const WorkspaceDocumentCitationSourceSchema = z.discriminatedUnion('sourceType', [
  WorkspaceDocumentKnowledgeCitationSourceSchema,
  WorkspaceDocumentWebCitationSourceSchema,
]);

export const WorkspaceDocumentCitationDiagnosticSchema = z.object({
  code: z.enum([
    'invalid_citation',
    'manual_source',
    'excerpt_unavailable',
    'excerpt_truncated',
    'excerpt_omitted',
  ]),
  message: NonEmptyStringSchema,
  marker: NonEmptyStringSchema,
  ref: CitationRefSchema.optional(),
}).strict();

const WorkspaceDocumentReadCommonDataSchema = z.object({
  documentId: NonEmptyStringSchema,
  docType: NonEmptyStringSchema,
  documentName: NonEmptyStringSchema,
  truncatedByChars: z.boolean(),
  totalTextLength: z.number().int().nonnegative(),
  presentation: WorkspaceDocumentReadPresentationSchema,
  images: z.array(WorkspaceDocumentReadImageSchema).optional(),
  details: z.record(z.unknown()).optional(),
});

function requireMatchingTruncationCursor(
  truncatedByChars: boolean,
  nextOffset: number | null,
  cursorPath: string,
  context: z.RefinementCtx,
): void {
  if (truncatedByChars === (nextOffset !== null)) return;
  context.addIssue({
    code: z.ZodIssueCode.custom,
    path: [cursorPath],
    message: `${cursorPath} must be present exactly when the document is truncated`,
  });
}

export const WorkspaceDocumentReadDataSchema = WorkspaceDocumentReadCommonDataSchema.extend({
  nextOffset: z.number().int().nonnegative().nullable(),
}).strict().superRefine((data, context) => {
  requireMatchingTruncationCursor(data.truncatedByChars, data.nextOffset, 'nextOffset', context);
});

const WorkspaceDocumentReadObservationPreviewMetaSchema = z.object({
  document_name: NonEmptyStringSchema,
  doc_type: NonEmptyStringSchema,
}).strict();

export const WorkspaceDocumentReadResultSchema = z.object({
  data: WorkspaceDocumentReadDataSchema,
  observation: NonEmptyStringSchema,
  observationPreviewMeta: WorkspaceDocumentReadObservationPreviewMetaSchema,
  citationSources: z.array(WorkspaceDocumentCitationSourceSchema).optional(),
  citationDiagnostics: z.array(WorkspaceDocumentCitationDiagnosticSchema).optional(),
}).strict().superRefine((result, context) => {
  if ((result.citationSources === undefined) !== (result.citationDiagnostics === undefined)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['citationSources'],
      message: 'citationSources and citationDiagnostics must appear together',
    });
  }

  const refs = new Set<string>();
  result.citationSources?.forEach((source, index) => {
    if (refs.has(source.ref)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['citationSources', index, 'ref'],
        message: 'document citation refs must be unique',
      });
    }
    refs.add(source.ref);
  });
});

export type WorkspaceDocumentReadBlock = z.infer<typeof WorkspaceDocumentReadBlockSchema>;
export type WorkspaceDocumentReadOutlineItem = z.infer<typeof WorkspaceDocumentReadOutlineItemSchema>;
export type WorkspaceDocumentReadPresentation = z.infer<typeof WorkspaceDocumentReadPresentationSchema>;
export type WorkspaceDocumentReadImage = z.infer<typeof WorkspaceDocumentReadImageSchema>;
export type WorkspaceDocumentCitationSource = z.infer<typeof WorkspaceDocumentCitationSourceSchema>;
export type WorkspaceDocumentCitationDiagnostic = z.infer<typeof WorkspaceDocumentCitationDiagnosticSchema>;
export type WorkspaceDocumentReadData = z.infer<typeof WorkspaceDocumentReadDataSchema>;
export type WorkspaceDocumentReadResult = z.infer<typeof WorkspaceDocumentReadResultSchema>;

export function parseWorkspaceDocumentReadResult(value: unknown): WorkspaceDocumentReadResult {
  return WorkspaceDocumentReadResultSchema.parse(value);
}
