import { describe, expect, it } from 'vitest';
import type { PresentationRenderModel } from '@plugin/slides/shared';
import { countSourceSpanUses } from './countSourceSpanUses';

describe('countSourceSpanUses', () => {
  it('在页选择前统计同一创建位置生成的全部节点', () => {
    const model: PresentationRenderModel = {
      presentationId: 'deck-shared-source',
      title: 'Shared source',
      version: 1,
      sourceKind: 'generated',
      slideSize: { width: 10, height: 5.625 },
      slides: [0, 1].map((index) => ({
        index,
        elements: [{
          id: `text-${index + 1}`,
          kind: 'text',
          box: { x: 1, y: 1, w: 2, h: 0.5 },
          zIndex: 0,
          paragraphs: [{ runs: [{ text: `page ${index + 1}` }] }],
          sourceSpan: { startLine: 40, endLine: 44 },
        }],
      })),
    };

    expect(countSourceSpanUses(model)).toEqual(new Map([['40:44', 2]]));
  });
});
