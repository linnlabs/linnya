import { describe, expect, it } from 'vitest';
import { searchToolClasses } from '.';

describe('Knowledge search live tool surface', () => {
  it('注册 canonical 搜索和内部浅搜索，不保留旧搜索工具 executable alias', () => {
    const names = searchToolClasses.map(ToolClass => new ToolClass().name);

    expect(names).toContain('knowledge_search');
    expect(names).toContain('search_in_knowledgebase');
    expect(names).not.toContain('search_knowledge_base');
  });
});
