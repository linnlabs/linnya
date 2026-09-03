import { z } from 'zod';
import { CitationRefSchema, HttpCitationUrlSchema } from '../citation';
import { WebCacheStatusSchema } from './web-common';

const NonEmptyStringSchema = z.string()
  .refine(value => value.trim().length > 0, 'String must contain non-whitespace content');

export const WEB_SEARCH_DEFAULT_TOP_K = 10;
export const WEB_SEARCH_MIN_TOP_K = 6;
export const WEB_SEARCH_MAX_TOP_K = 50;

export const WebSearchArgsSchema = z.object({
  query: NonEmptyStringSchema,
  top_k: z.number()
    .int()
    .min(WEB_SEARCH_MIN_TOP_K)
    .max(WEB_SEARCH_MAX_TOP_K)
    .default(WEB_SEARCH_DEFAULT_TOP_K),
  recency_days: z.number().int().positive().optional(),
}).strict();

export const WebSearchCitationSchema = z.object({
  sourceType: z.literal('web'),
  ref: CitationRefSchema,
  index: z.number().int().positive(),
  url: HttpCitationUrlSchema,
  docTitle: z.string(),
  snippet: z.string(),
  siteName: NonEmptyStringSchema.optional(),
  publishedAt: NonEmptyStringSchema.optional(),
}).strict();

export const WebSearchResultSchema = z.object({
  data: z.object({
    query: NonEmptyStringSchema,
    resultCount: z.number().int().nonnegative(),
    citations: z.object({
      query: NonEmptyStringSchema,
      searchMode: z.literal('web'),
      citations: z.array(WebSearchCitationSchema),
    }).strict(),
    evidence_store: z.object({
      bundle_id: NonEmptyStringSchema,
    }).strict(),
    cacheStatus: WebCacheStatusSchema,
  }).strict().superRefine((data, context) => {
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
}).strict();

export type WebSearchArgs = z.infer<typeof WebSearchArgsSchema>;
export type WebSearchCitation = z.infer<typeof WebSearchCitationSchema>;
export type WebSearchResult = z.infer<typeof WebSearchResultSchema>;
