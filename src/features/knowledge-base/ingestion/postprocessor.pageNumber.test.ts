import { describe, expect, it } from 'vitest';

import { postProcessBlocks } from './postprocessor';

describe('postProcessBlocks page number normalization', () => {
  it('normalizes parser source_info.page_number to storage source_info.page_num', async () => {
    const result = await postProcessBlocks({
      docId: 'doc-page-normalization',
      originalFilename: 'paper.pdf',
      sourceFilePath: '/tmp/paper.pdf',
      rawBlocks: [
        {
          id: 'not-a-qdrant-id',
          text: '第一页正文',
          type: 'paragraph',
          source_info: {
            page_number: 3,
          },
          metadata: {},
        },
      ],
    });

    expect(result.processedBlocks).toHaveLength(1);
    const firstBlock = result.processedBlocks[0];
    if (!firstBlock) {
      throw new Error('expected one processed block');
    }
    expect(firstBlock.source_info.page_num).toBe(3);
    expect(result.sourceDoc.content_blocks[firstBlock.id]?.source_info?.page_num).toBe(3);
  });
});
