/**
 * @file packages/schemas/src/citation.ts
 * @description 引用（RAG Citation）类型定义
 *
 * 本文件定义了搜索结果在 AI 回答中被引用时所需的结构化数据类型。
 * 支持多种来源类型（知识库、Web 等），通过 sourceType 显式区分。
 *
 * 这些类型用于：
 * 1. 后端搜索工具返回结构化引用元数据（KB / Web）
 * 2. 前端解析 AI 生成的 `[@XXXXXX]` 引用标记
 * 3. 前端展示引用卡片（弹窗预览）
 */

import { z } from 'zod';

/**
 * Citation 在协议层使用的 canonical ref。
 *
 * 这里只定义持久化与传输格式；Markdown token 解析、宽松入参归一化和展示格式
 * 属于 Citation domain，不应由各工具 schema 或 Evidence 重复实现。
 */
export const CitationRefSchema = z
  .string()
  .regex(/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]{6}$/);
export type CitationRef = z.infer<typeof CitationRefSchema>;

/** Web citation 只接纳可由 Conversation 安全交给外部浏览器的 HTTP(S) 来源。 */
export const HttpCitationUrlSchema = z
  .string()
  .trim()
  .url()
  .refine(value => {
    const protocol = new URL(value).protocol;
    return protocol === 'http:' || protocol === 'https:';
  }, 'citation URL must use HTTP(S)');

// ============ 来源类型 ============

/**
 * 引用来源类型
 * - knowledge_base: 来自知识库的引用（KB SoT：docId + blockId）
 * - web: 来自联网搜索的引用（锚点：canonical URL）
 * - manual: 手动录入来源（platform 或插件文档）
 * - conversation_turn: 指向某轮对话内容
 */
export const CitationSourceTypeValues = [
  'knowledge_base',
  'web',
  'manual',
  'conversation_turn',
] as const;
export const CitationSourceTypeSchema = z.enum(CitationSourceTypeValues);
export type CitationSourceType = z.infer<typeof CitationSourceTypeSchema>;

/**
 * 搜索结果引用来源类型（工具输出协议子集）
 *
 * 中文说明：
 * - 搜索工具当前只会产出 knowledge_base / web；
 * - manual / conversation_turn 属于文档引用域，不应出现在搜索结果 citation 元数据里。
 */
export const SearchCitationSourceTypeValues = ['knowledge_base', 'web'] as const;
export const SearchCitationSourceTypeSchema = z.enum(SearchCitationSourceTypeValues);
export type SearchCitationSourceType = z.infer<typeof SearchCitationSourceTypeSchema>;

export function isCitationSourceType(value: unknown): value is CitationSourceType {
  if (typeof value !== 'string') return false;
  return (CitationSourceTypeValues as readonly string[]).includes(value);
}

// ============ 搜索结果引用元数据 ============

const CitationMatchTypeSchema = z.enum([
  'exact',
  'full_keyword',
  'partial_keyword',
  'strong_semantic',
  'hybrid',
  'keyword',
  'semantic',
]);

/**
 * Conversation 展示层允许消费的严格引用事实。
 *
 * `ref` 只是短句柄，稳定来源锚点才是事实身份：知识库必须同时携带 docId/blockId，
 * Web 必须携带 URL。这里使用判别联合，禁止通过可选字段猜来源，也不接纳缺 ref 的旧形状。
 */
export const SearchResultCitationSchema = z.discriminatedUnion('sourceType', [
  z
    .object({
      ref: CitationRefSchema,
      index: z.number().int().positive(),
      sourceType: z.literal('knowledge_base'),
      docId: z.string().trim().min(1),
      blockId: z.string().trim().min(1),
      docTitle: z.string(),
      pageNumber: z.number().int().positive().optional(),
      snippet: z.string(),
      score: z.number().min(0).max(1).optional(),
      matchType: CitationMatchTypeSchema.optional(),
      isContext: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      ref: CitationRefSchema,
      index: z.number().int().positive(),
      sourceType: z.literal('web'),
      url: HttpCitationUrlSchema,
      docTitle: z.string(),
      snippet: z.string(),
      siteName: z.string().trim().min(1).optional(),
      publishedAt: z.string().trim().min(1).optional(),
      author: z.string().trim().min(1).optional(),
    })
    .strict(),
]);

export type SearchResultCitation = z.infer<typeof SearchResultCitationSchema>;

/**
 * 一条可见消息的引用依赖闭包。
 *
 * citations 按正文中首次出现顺序排列；无法解析的合法 ref 必须显式进入 unresolved_refs，
 * 不能靠 UI 跨消息、跨会话扫描全局状态来猜来源。
 */
export const ConversationCitationDependencySnapshotSchema = z
  .object({
    citations: z.array(SearchResultCitationSchema),
    unresolved_refs: z.array(CitationRefSchema),
  })
  .strict()
  .superRefine((snapshot, context) => {
    const refs = new Set<string>();
    snapshot.citations.forEach((citation, index) => {
      if (refs.has(citation.ref)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['citations', index, 'ref'],
          message: 'message citation dependencies must have unique refs',
        });
      }
      refs.add(citation.ref);
    });
    snapshot.unresolved_refs.forEach((ref, index) => {
      if (refs.has(ref)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['unresolved_refs', index],
          message: 'unresolved citation refs must be unique and not overlap resolved refs',
        });
      }
      refs.add(ref);
    });
  });
export type ConversationCitationDependencySnapshot = z.infer<
  typeof ConversationCitationDependencySnapshotSchema
>;
