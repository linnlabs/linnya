/**
 * @file src/features/knowledge-base/graph/__tests__/extractableBlocks.test.ts
 *
 * @description
 * 验证图谱抽取可处理块的过滤规则：
 * - 跳过 image block
 * - 跳过空文本
 */

import { describe, it, expect } from 'vitest';
import { collectExtractableTextBlocks } from '../application/extractableBlocks';
import { BlockType, type DocumentSoT } from '../../domain/block';

describe('collectExtractableTextBlocks', () => {
  it('应跳过 image 与空文本块，只保留可抽取的文本块', () => {
    const sot: DocumentSoT = {
      doc_id: 'doc1',
      doc_title: 'Doc 1',
      metadata: {},
      content_blocks: {
        b1: { block_type: BlockType.PARAGRAPH, text: ' Hello ' },
        b2: { block_type: BlockType.IMAGE, text: 'alt text (ignored)' },
        b3: { block_type: BlockType.PARAGRAPH, text: '   ' },
      },
      structure: { root: ['b1', 'b2', 'b3'] },
    };

    const blocks = collectExtractableTextBlocks(sot);
    expect(blocks).toEqual([{ blockId: 'b1', text: 'Hello' }]);
  });
});


