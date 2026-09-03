import { z } from 'zod';
import { CitationRefSchema, HttpCitationUrlSchema } from '../citation';

const NonEmptyStringSchema = z.string()
  .refine(value => value.trim().length > 0, 'String must contain non-whitespace content');
const NonNegativeIntegerSchema = z.number().int().nonnegative();
const PositiveIntegerSchema = z.number().int().positive();
const EvidenceBundleIdSchema = z.string().regex(/^[a-f0-9]{16}$/i);

const EvidenceResolveWireArgsSchema = z.object({
  mode: z.enum(['resolve_refs', 'list_refs']).default('resolve_refs'),
  refs: z.array(NonEmptyStringSchema).optional(),
  offset: NonNegativeIntegerSchema.default(0),
  limit: PositiveIntegerSchema.default(50),
  max_units: PositiveIntegerSchema.default(200),
  max_chars: PositiveIntegerSchema.default(2000),
}).strict().superRefine((args, context) => {
  if (args.mode === 'resolve_refs' && (!args.refs || args.refs.length === 0)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['refs'],
      message: 'resolve_refs mode requires at least one ref',
    });
  }
});

/**
 * 模型可见 JSON schema 是平铺对象，无法按 mode 隐藏另一分支字段。
 * admission 明确接纳该 wire 后只向业务逻辑暴露当前 mode 的字段，避免工具内部继续 shape probing。
 */
export const EvidenceResolveArgsSchema = EvidenceResolveWireArgsSchema.transform(args => (
  args.mode === 'list_refs'
    ? {
        mode: args.mode,
        offset: args.offset,
        limit: args.limit,
      } as const
    : {
        mode: args.mode,
        refs: args.refs ?? [],
        max_units: args.max_units,
        max_chars: args.max_chars,
      } as const
));

const KnowledgeEvidenceListItemSchema = z.object({
  ref_id: CitationRefSchema,
  source_type: z.literal('knowledge_base'),
  title: NonEmptyStringSchema,
  doc_id: NonEmptyStringSchema,
  block_id: NonEmptyStringSchema,
  occurrences: PositiveIntegerSchema,
}).strict();

const WebEvidenceListItemSchema = z.object({
  ref_id: CitationRefSchema,
  source_type: z.literal('web'),
  title: NonEmptyStringSchema,
  url: HttpCitationUrlSchema,
  occurrences: PositiveIntegerSchema,
}).strict();

export const EvidenceListRefsToolOutputSchema = z.object({
  data: z.object({
    conversation_id: NonEmptyStringSchema,
    instance_id: NonEmptyStringSchema,
    mode: z.literal('list_refs'),
    total_refs: NonNegativeIntegerSchema,
    offset: NonNegativeIntegerSchema,
    limit: PositiveIntegerSchema,
    refs: z.array(z.discriminatedUnion('source_type', [
      KnowledgeEvidenceListItemSchema,
      WebEvidenceListItemSchema,
    ])),
  }).strict().superRefine((data, context) => {
    if (data.offset + data.refs.length > data.total_refs) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['refs'],
        message: 'refs page cannot exceed total_refs',
      });
    }
  }),
  observation: NonEmptyStringSchema,
}).strict();

const EvidenceResolveCitationSchema = z.discriminatedUnion('sourceType', [
  z.object({
    ref: CitationRefSchema,
    index: PositiveIntegerSchema,
    sourceType: z.literal('knowledge_base'),
    docId: NonEmptyStringSchema,
    blockId: NonEmptyStringSchema,
    docTitle: NonEmptyStringSchema,
    snippet: z.string(),
  }).strict(),
  z.object({
    ref: CitationRefSchema,
    index: PositiveIntegerSchema,
    sourceType: z.literal('web'),
    docTitle: NonEmptyStringSchema,
    snippet: z.string(),
    url: HttpCitationUrlSchema,
    siteName: NonEmptyStringSchema.optional(),
    publishedAt: NonEmptyStringSchema.optional(),
  }).strict(),
]);

const ResolvedKnowledgeEvidenceSchema = z.object({
  ref: CitationRefSchema,
  source_type: z.literal('knowledge_base'),
  title: NonEmptyStringSchema,
  snippet: z.string(),
  doc_id: NonEmptyStringSchema,
  block_id: NonEmptyStringSchema,
  doc_name: NonEmptyStringSchema.optional(),
  text: z.string(),
  text_truncated: z.boolean(),
}).strict();

const ResolvedWebEvidenceSchema = z.object({
  ref: CitationRefSchema,
  source_type: z.literal('web'),
  title: NonEmptyStringSchema,
  snippet: z.string(),
  url: HttpCitationUrlSchema,
  site_name: NonEmptyStringSchema.optional(),
  published_at: NonEmptyStringSchema.optional(),
  text: z.string(),
  text_truncated: z.boolean(),
}).strict();

const IncompleteEvidenceRefSchema = z.object({
  ref: CitationRefSchema,
  bundle_id: EvidenceBundleIdSchema,
  instance_id: NonEmptyStringSchema,
  reason: z.enum(['missing_doc_id', 'missing_block_id', 'missing_url', 'missing_content_text']),
}).strict();

const EvidenceRefConflictSchema = z.object({
  ref: CitationRefSchema,
  kept_bundle_id: EvidenceBundleIdSchema,
  kept_instance_id: NonEmptyStringSchema,
  ignored_bundle_ids: z.array(EvidenceBundleIdSchema),
  ignored_instance_ids: z.array(NonEmptyStringSchema),
}).strict();

export const EvidenceResolveRefsToolOutputSchema = z.object({
  data: z.object({
    conversation_id: NonEmptyStringSchema,
    instance_id: NonEmptyStringSchema,
    mode: z.literal('resolve_refs'),
    resolved_count: NonNegativeIntegerSchema,
    missing_count: NonNegativeIntegerSchema,
    incomplete_count: NonNegativeIntegerSchema,
    conflict_count: NonNegativeIntegerSchema,
    scanned_bundle_count: NonNegativeIntegerSchema,
    citations: z.object({
      citations: z.array(EvidenceResolveCitationSchema),
    }).strict().optional(),
    resolved: z.array(z.discriminatedUnion('source_type', [
      ResolvedKnowledgeEvidenceSchema,
      ResolvedWebEvidenceSchema,
    ])),
    missing_refs: z.array(CitationRefSchema),
    incomplete_refs: z.array(IncompleteEvidenceRefSchema),
    conflicts: z.array(EvidenceRefConflictSchema),
  }).strict().superRefine((data, context) => {
    const counts: ReadonlyArray<readonly [string, number, number]> = [
      ['resolved_count', data.resolved_count, data.resolved.length],
      ['missing_count', data.missing_count, data.missing_refs.length],
      ['incomplete_count', data.incomplete_count, data.incomplete_refs.length],
      ['conflict_count', data.conflict_count, data.conflicts.length],
    ];
    for (const [field, actual, expected] of counts) {
      if (actual !== expected) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [field],
          message: `${field} must match its collection length`,
        });
      }
    }
    if ((data.citations?.citations.length ?? 0) !== data.resolved.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['citations'],
        message: 'citations must describe every resolved evidence item',
      });
    }
  }),
  observation: NonEmptyStringSchema,
}).strict();

export const EvidenceResolveToolOutputSchema = z.union([
  EvidenceListRefsToolOutputSchema,
  EvidenceResolveRefsToolOutputSchema,
]);

export type EvidenceResolveArgs = z.infer<typeof EvidenceResolveArgsSchema>;
export type EvidenceResolveToolOutput = z.infer<typeof EvidenceResolveToolOutputSchema>;
