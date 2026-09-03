import { describe, expect, it } from 'vitest';
import { parseAssembleToolOutputToDocuments } from './parseAssembleToolOutput';

describe('parseAssembleToolOutputToDocuments', () => {
  it('解析 assemble 工具已经 admission 的业务证据', () => {
    const output = JSON.stringify({
      data: {
        query: 'revenue',
        kept: [
          {
            doc_id: 'doc-1',
            block_id: 'block-1',
            snippet: 'Revenue increased.',
            doc_name: 'Report',
          },
        ],
        dropped: [],
        stats: { total_input: 1, kept_count: 1, dropped_count: 0 },
      },
      observation: 'Assembled.',
      control: { terminateRun: true, reason: 'completed' },
    });

    expect(parseAssembleToolOutputToDocuments(output)).toEqual([
      {
        doc_id: 'doc-1',
        block_id: 'block-1',
        doc_name: 'Report',
        snippet: 'Revenue increased.',
      },
    ]);
  });

  it('缺少文档名时失败，不得在 deep 链路内猜标题', () => {
    const output = JSON.stringify({
      data: {
        query: 'revenue',
        kept: [
          {
            doc_id: 'doc-1',
            block_id: 'block-1',
            snippet: 'Revenue increased.',
          },
        ],
        dropped: [],
        stats: { total_input: 1, kept_count: 1, dropped_count: 0 },
      },
      observation: 'Assembled.',
      control: { terminateRun: true, reason: 'completed' },
    });

    expect(() => parseAssembleToolOutputToDocuments(output)).toThrow(/doc_name/);
  });
});
