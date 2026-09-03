import { describe, expect, it } from 'vitest';
import { readerToolClasses } from '.';

describe('Knowledge reader live tool surface', () => {
  it('只注册 canonical knowledge_read，不保留旧阅读工具 executable alias', () => {
    const names = readerToolClasses.map(ToolClass => new ToolClass().name);

    expect(names).toContain('knowledge_read');
    expect(names).not.toContain('browse_document_by_chunk');
  });
});
