import { z } from 'zod';
import { CitationRefSchema, HttpCitationUrlSchema } from '../citation';
import { WebCacheStatusSchema } from './web-common';

const NonEmptyStringSchema = z
  .string()
  .refine(value => value.trim().length > 0, 'String must contain non-whitespace content');
const boundedNonEmptyString = (max: number) =>
  z
    .string()
    .max(max)
    .refine(value => value.trim().length > 0, 'String must contain non-whitespace content');

export const WEB_SEARCH_DEFAULT_TOP_K = 10;
export const WEB_SEARCH_MIN_TOP_K = 6;
export const WEB_SEARCH_MAX_TOP_K = 50;

export const ShallowWebSearchArgsSchema = z
  .object({
    query: NonEmptyStringSchema,
    top_k: z
      .number()
      .int()
      .min(WEB_SEARCH_MIN_TOP_K)
      .max(WEB_SEARCH_MAX_TOP_K)
      .default(WEB_SEARCH_DEFAULT_TOP_K),
    recency_days: z.number().int().positive().optional(),
  })
  .strict();

export const WebSearchArgsSchema = ShallowWebSearchArgsSchema.extend({
  deep_search: z.boolean().default(false),
}).strict();

export const WebSearchCitationSchema = z
  .object({
    sourceType: z.literal('web'),
    ref: CitationRefSchema,
    index: z.number().int().positive(),
    url: HttpCitationUrlSchema,
    docTitle: z.string(),
    snippet: z.string(),
    siteName: NonEmptyStringSchema.optional(),
    publishedAt: NonEmptyStringSchema.optional(),
  })
  .strict();

/** 附加说明不复制网页列表；用途、总结、冲突和缺口均为模型判断。 */
export const DeepWebSourceNoteSchema = z
  .object({
    ref: CitationRefSchema,
    source_call_id: NonEmptyStringSchema,
    bundle_id: NonEmptyStringSchema,
    capture_kind: z.enum(['search_snippet', 'page_content', 'metadata_only', 'file_download']),
    truncated: z.boolean(),
    warnings: z.array(z.string()).max(8),
    purpose: boundedNonEmptyString(300),
  })
  .strict();
export const DeepWebResearchNotesSchema = z
  .object({
    summary: z.string().max(1200),
    notes_truncated: z.boolean().optional(),
    source_notes: z.array(DeepWebSourceNoteSchema).max(WEB_SEARCH_MAX_TOP_K),
    gaps: z.array(boundedNonEmptyString(500)).max(8),
    conflicts: z.array(boundedNonEmptyString(500)).max(8),
    failures: z.array(
      z
        .object({
          tool: NonEmptyStringSchema,
          call_id: NonEmptyStringSchema,
          error: boundedNonEmptyString(1000),
        })
        .strict()
    ),
    search_count: z.number().int().nonnegative(),
    read_attempt_count: z.number().int().nonnegative(),
  })
  .strict();

export const WebSearchResultSchema = z
  .object({
    data: z
      .object({
        query: NonEmptyStringSchema,
        resultCount: z.number().int().nonnegative(),
        citations: z
          .object({
            query: NonEmptyStringSchema,
            searchMode: z.literal('web'),
            citations: z.array(WebSearchCitationSchema),
          })
          .strict(),
        evidence_store: z
          .object({
            bundle_id: NonEmptyStringSchema,
          })
          .strict(),
        cacheStatus: WebCacheStatusSchema.optional(),
        search_strategy: z.enum(['shallow', 'deep']).optional(),
        subrun_ids: z.array(NonEmptyStringSchema).length(1).optional(),
        research: DeepWebResearchNotesSchema.optional(),
        downgrade_reason: z.literal('deep_search_limit').optional(),
      })
      .strict()
      .superRefine((data, context) => {
        if (data.search_strategy === 'deep' && (!data.research || !data.subrun_ids)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'Deep search requires source notes and child identity',
          });
        }
        if (
          data.research &&
          (data.research.source_notes.length !== data.resultCount ||
            data.research.source_notes.some(
              (note, i) => note.ref !== data.citations.citations[i]?.ref
            ))
        ) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'Source notes must match the canonical web list',
          });
        }
        if (data.query !== data.citations.query) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['citations', 'query'],
            message: 'citation query must match the web search query',
          });
        }
        if (data.resultCount !== data.citations.citations.length) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['resultCount'],
            message: 'resultCount must match the citation count',
          });
        }

        const refs = new Set<string>();
        const urls = new Set<string>();
        data.citations.citations.forEach((citation, index) => {
          if (refs.has(citation.ref)) {
            context.addIssue({
              code: z.ZodIssueCode.custom,
              path: ['citations', 'citations', index, 'ref'],
              message: 'web citation refs must be unique',
            });
          }
          refs.add(citation.ref);

          if (urls.has(citation.url)) {
            context.addIssue({
              code: z.ZodIssueCode.custom,
              path: ['citations', 'citations', index, 'url'],
              message: 'web citation URLs must be unique',
            });
          }
          urls.add(citation.url);

          const previous = data.citations.citations[index - 1];
          if (previous && citation.index !== previous.index + 1) {
            context.addIssue({
              code: z.ZodIssueCode.custom,
              path: ['citations', 'citations', index, 'index'],
              message: 'web citation indexes must be contiguous',
            });
          }
        });
      }),
    observation: NonEmptyStringSchema,
  })
  .strict();

// 内部组装产物只由工具回填网页字段，模型不重抄原文或生成 URL。
export const DeepWebSourceSchema = DeepWebSourceNoteSchema.omit({ ref: true })
  .extend({ citation: WebSearchCitationSchema })
  .strict();
export const AssembleWebSourcesArgsSchema = z
  .object({
    selected: z
      .array(
        z
          .object({
            ref: CitationRefSchema,
            // 允许一次提交较长说明，再由领域规则裁剪并标记，避免已取得来源因说明过长整包失败。
            purpose: boundedNonEmptyString(10000),
          })
          .strict()
      )
      .max(WEB_SEARCH_MAX_TOP_K),
    // 无候选时允许空总结；此时 gaps 必须说明原因。
    summary: z.string().max(10000),
    gaps: z.array(boundedNonEmptyString(10000)).max(8),
    conflicts: z.array(boundedNonEmptyString(10000)).max(8),
  })
  .strict();
export const DeepWebMaterialsSchema = DeepWebResearchNotesSchema.omit({ source_notes: true })
  .extend({
    sources: z.array(DeepWebSourceSchema).max(WEB_SEARCH_MAX_TOP_K),
    evidence_store: z.object({ bundle_id: NonEmptyStringSchema }).strict(),
  })
  .strict();
export const AssembleWebSourcesResultSchema = z
  .object({ data: DeepWebMaterialsSchema, observation: NonEmptyStringSchema })
  .strict();
/** control 只在工具执行边界消费，持久 tool_output 仅保存 data / observation。 */
export const AssembleWebSourcesToolOutputSchema = AssembleWebSourcesResultSchema.extend({
  control: z
    .object({ terminateRun: z.literal(true), reason: z.literal('assemble_web_sources: completed') })
    .strict(),
}).strict();
// 普通搜索解析保留严格浅搜限定；父工具两种模式共用 WebSearchResultSchema。
export const ShallowWebSearchResultSchema = WebSearchResultSchema.refine(
  result =>
    result.data.search_strategy !== 'deep' && !result.data.research && !result.data.subrun_ids,
  'Expected ordinary web search'
);
export const DeepWebSearchResultSchema = WebSearchResultSchema.refine(
  result => result.data.search_strategy === 'deep',
  'Expected deep web search'
);
export type DeepWebMaterials = z.infer<typeof DeepWebMaterialsSchema>;
export type DeepWebResearchNotes = z.infer<typeof DeepWebResearchNotesSchema>;
export type AssembleWebSourcesArgs = z.infer<typeof AssembleWebSourcesArgsSchema>;
export type DeepWebSearchResult = z.infer<typeof DeepWebSearchResultSchema>;
export type WebSearchArgs = z.infer<typeof WebSearchArgsSchema>;
export type WebSearchCitation = z.infer<typeof WebSearchCitationSchema>;
export type WebSearchResult = z.infer<typeof WebSearchResultSchema>;
