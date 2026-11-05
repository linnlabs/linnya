import { z } from 'zod';

// 版本只由索引 owner 更新；没有覆盖记录或版本不同的文件都不具备可复用资格。
// v2：FTS5 trigram 外部内容索引，替代自建 trigram 表（v1 的表由 Host v68→v69 迁移删除）。
export const SEARCH_INDEX_VERSION = 2;

export const SearchIndexFreshnessSchema = z.object({
  node_updated_at: z.number(),
  path: z.string(),
  index_version: z.number().int(),
  max_file_chars: z.number().int().positive(),
  truncated: z.union([z.literal(0), z.literal(1)]),
}).strict();
export type SearchIndexFreshnessRow = z.infer<typeof SearchIndexFreshnessSchema>;
