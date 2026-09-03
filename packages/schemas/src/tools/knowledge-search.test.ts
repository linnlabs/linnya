import { describe, expect, it } from 'vitest';
import {
  KnowledgeSearchArgsSchema,
  KnowledgeSearchResultSchema,
} from './knowledge-search';

describe('knowledge search contract', () => {
  it('只接受工具真实支持的参数', () => {
    expect(() => KnowledgeSearchArgsSchema.parse({
      query: 'revenue',
      filter: { page_range: { min: 1, max: 2 } },
    })).toThrow();
  });

  it('拒绝 scope 不一致和后端 UI 字段', () => {
    expect(() => KnowledgeSearchResultSchema.parse({
      data: {
        query: 'revenue',
        search_strategy: 'shallow',
        search_mode: 'global',
        doc_name: 'report.pdf',
        display_title: 'Search results',
        citations: {
          query: 'revenue',
          searchMode: 'global',
          citations: [],
          docName: 'report.pdf',
        },
      },
      observation: 'No matching evidence.',
    })).toThrow();
  });
});
