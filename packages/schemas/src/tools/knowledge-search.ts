import { z } from 'zod';
import { CitationRefSchema } from '../citation';

const NonEmptyStringSchema = z
  .string()
  .refine(value => value.trim().length > 0, 'String must contain non-whitespace content');

export const KNOWLEDGE_SEARCH_DEFAULT_TOP_K = 5;
export const KNOWLEDGE_SEARCH_MAX_TOP_K = 50;

const KnowledgeSearchBaseArgsSchema = z
  .object({
    query: NonEmptyStringSchema,
    doc_id: NonEmptyStringSchema.optional(),
    top_k: z
      .number()
      .int()
      .positive()
      .max(KNOWLEDGE_SEARCH_MAX_TOP_K)
      .default(KNOWLEDGE_SEARCH_DEFAULT_TOP_K),
  })
  .strict();

export const KnowledgeSearchArgsSchema = KnowledgeSearchBaseArgsSchema.extend({
  deep_search: z.boolean().default(false),
}).strict();

export const KnowledgeShallowSearchArgsSchema = KnowledgeSearchBaseArgsSchema;

export const KnowledgeSearchCitationSchema = z
  .object({
    ref: CitationRefSchema,
    index: z.number().int().positive(),
    sourceType: z.literal('knowledge_base'),
    docId: NonEmptyStringSchema,
    blockId: NonEmptyStringSchema,
    docTitle: NonEmptyStringSchema,
    pageNumber: z.number().int().positive().optional(),
    snippet: z.string(),
    score: z.number().min(0).max(1).optional(),
    matchType: z
      .enum([
        'exact',
        'full_keyword',
        'partial_keyword',
        'strong_semantic',
        'hybrid',
        'keyword',
        'semantic',
      ])
      .optional(),
    isContext: z.boolean().optional(),
  })
  .strict();

export const KnowledgeSearchCitationMetadataSchema = z
  .object({
    query: NonEmptyStringSchema,
    searchMode: z.enum(['global', 'document']),
    citations: z.array(KnowledgeSearchCitationSchema),
    docName: NonEmptyStringSchema.optional(),
  })
  .strict()
  .superRefine((metadata, context) => {
    if (metadata.searchMode === 'document' && !metadata.docName) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['docName'],
        message: 'document search citations require docName',
      });
    }

    const refs = new Set<string>();
    const evidenceKeys = new Set<string>();
    metadata.citations.forEach((citation, index) => {
      if (refs.has(citation.ref)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['citations', index, 'ref'],
          message: 'knowledge citation refs must be unique',
        });
      }
      refs.add(citation.ref);

      const evidenceKey = `${citation.docId}\u0000${citation.blockId}`;
      if (evidenceKeys.has(evidenceKey)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['citations', index, 'blockId'],
          message: 'knowledge citation evidence identities must be unique',
        });
      }
      evidenceKeys.add(evidenceKey);

      const previous = metadata.citations[index - 1];
      if (previous && citation.index !== previous.index + 1) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['citations', index, 'index'],
          message: 'knowledge citation indexes must be contiguous',
        });
      }
    });
  });

const KnowledgeGraphDigestSchema = z
  .object({
    blocks: z.array(
      z
        .object({
          doc_id: NonEmptyStringSchema,
          block_id: NonEmptyStringSchema,
          graph_available: z.boolean(),
          entity_count: z.number().int().nonnegative(),
          edge_count: z.number().int().nonnegative(),
          top_entities: z.array(
            z
              .object({
                id: NonEmptyStringSchema,
                name: NonEmptyStringSchema,
                canonical_name: NonEmptyStringSchema.optional(),
                type: NonEmptyStringSchema.optional(),
              })
              .strict()
          ),
          top_edges: z.array(
            z
              .object({
                relation_type: NonEmptyStringSchema,
                source_entity_id: NonEmptyStringSchema,
                target_entity_id: NonEmptyStringSchema,
                statement: NonEmptyStringSchema.optional(),
                evidence_ref_type: z.enum(['in_rag', 'external']).optional(),
              })
              .strict()
          ),
        })
        .strict()
    ),
    totals: z
      .object({
        selected_blocks: z.number().int().nonnegative(),
        blocks_with_graph: z.number().int().nonnegative(),
        entities_sum: z.number().int().nonnegative(),
        edges_sum: z.number().int().nonnegative(),
        unique_entities: z.number().int().nonnegative(),
      })
      .strict(),
  })
  .strict();

export const KnowledgeSearchResultSchema = z
  .object({
    data: z
      .object({
        query: NonEmptyStringSchema,
        search_strategy: z.enum(['shallow', 'deep']),
        subrun_id: NonEmptyStringSchema.optional(),
        search_mode: z.enum(['global', 'document']),
        doc_name: NonEmptyStringSchema.nullable(),
        citations: KnowledgeSearchCitationMetadataSchema,
        summary: NonEmptyStringSchema.optional(),
        graph_digest: KnowledgeGraphDigestSchema.optional(),
      })
      .strict()
      .superRefine((data, context) => {
        const expectedDocName = data.search_mode === 'document';
        if (expectedDocName !== (data.doc_name !== null)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['doc_name'],
            message: 'doc_name must be present exactly for document search mode',
          });
        }
        if (data.query !== data.citations.query) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['citations', 'query'],
            message: 'citation query must match search query',
          });
        }
        if (data.search_mode !== data.citations.searchMode) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['citations', 'searchMode'],
            message: 'citation searchMode must match search_mode',
          });
        }
        if ((data.doc_name ?? undefined) !== data.citations.docName) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['citations', 'docName'],
            message: 'citation docName must match doc_name',
          });
        }
        if (data.search_strategy === 'deep' && data.subrun_id === undefined) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['subrun_id'],
            message: 'deep search result requires subrun_id for trace history identity',
          });
        }
        if (data.search_strategy === 'shallow' && data.subrun_id !== undefined) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['subrun_id'],
            message: 'shallow search result must not declare subrun_id',
          });
        }
      }),
    observation: NonEmptyStringSchema,
  })
  .strict();

const HistoricalKnowledgeSearchDocumentSchema = z
  .object({
    id: NonEmptyStringSchema,
    title: NonEmptyStringSchema,
    snippet: z.string(),
    doc_id: NonEmptyStringSchema,
    doc_name: NonEmptyStringSchema,
    page: z.number().int().positive().optional(),
    block_id: NonEmptyStringSchema,
  })
  .strict();

const HistoricalKnowledgeSearchCitationSchema = KnowledgeSearchCitationSchema.omit({
  sourceType: true,
})
  .extend({
    sourceType: z.literal('knowledge_base').optional(),
  })
  .strict();

const HistoricalKnowledgeSearchCitationMetadataSchema = z
  .object({
    query: NonEmptyStringSchema,
    searchMode: z.enum(['global', 'document']),
    citations: z.array(HistoricalKnowledgeSearchCitationSchema),
    docName: NonEmptyStringSchema.optional(),
  })
  .strict();

/** 旧版 Knowledge Search 内联结果，只允许历史 reload 与 Citation Snapshot 回放。 */
export const HistoricalKnowledgeSearchResultSchema = z
  .object({
    data: z
      .object({
        documents: z.array(HistoricalKnowledgeSearchDocumentSchema),
        search_mode: z.enum(['global', 'document']),
        doc_name: NonEmptyStringSchema.nullable(),
        query: NonEmptyStringSchema,
        display_title: NonEmptyStringSchema,
        summary: NonEmptyStringSchema.optional(),
        citations: HistoricalKnowledgeSearchCitationMetadataSchema,
      })
      .strict(),
    observation: NonEmptyStringSchema,
  })
  .strict();

/** 2026-01 至 2026-07 期间落盘的大搜索结果指针，只允许 reload 展示。 */
export const HistoricalKnowledgeSearchPointerResultSchema = z
  .object({
    data: z
      .object({
        count: z.number().int().nonnegative(),
        citation_snapshot_bundle_id: z.string().regex(/^[a-f0-9]{16}$/i),
        ref_ids: z.array(z.string()),
      })
      .strict(),
    observation: NonEmptyStringSchema,
  })
  .strict();

/**
 * Renderer 历史回放允许接纳的 Knowledge Search 结果。
 *
 * 新运行只能产生 KnowledgeSearchResultSchema；这里的两个 historical variant 只服务已落盘消息。
 */
export const KnowledgeSearchReplayResultSchema = z.union([
  KnowledgeSearchResultSchema,
  HistoricalKnowledgeSearchResultSchema,
  HistoricalKnowledgeSearchPointerResultSchema,
]);

export type KnowledgeSearchArgs = z.infer<typeof KnowledgeSearchArgsSchema>;
export type KnowledgeShallowSearchArgs = z.infer<typeof KnowledgeShallowSearchArgsSchema>;
export type KnowledgeSearchCitation = z.infer<typeof KnowledgeSearchCitationSchema>;
export type KnowledgeSearchCitationMetadata = z.infer<typeof KnowledgeSearchCitationMetadataSchema>;
export type KnowledgeSearchResult = z.infer<typeof KnowledgeSearchResultSchema>;
export type KnowledgeGraphDigest = z.infer<typeof KnowledgeGraphDigestSchema>;
export type HistoricalKnowledgeSearchResult = z.infer<typeof HistoricalKnowledgeSearchResultSchema>;
export type HistoricalKnowledgeSearchPointerResult = z.infer<typeof HistoricalKnowledgeSearchPointerResultSchema>;
export type KnowledgeSearchReplayResult = z.infer<typeof KnowledgeSearchReplayResultSchema>;
