import { z } from 'zod';

// 版本只由索引 owner 更新；旧行没有覆盖记录，或版本不同，都不具备可复用资格。
export const SEARCH_INDEX_VERSION = 1;

export const SearchIndexFreshnessSchema = z.object({
  node_updated_at: z.number(),
  path: z.string(),
  index_version: z.number().int(),
  max_file_chars: z.number().int().positive(),
  truncated: z.union([z.literal(0), z.literal(1)]),
}).strict();
export type SearchIndexFreshnessRow = z.infer<typeof SearchIndexFreshnessSchema>;
