import { describe, expect, it } from 'vitest';
import { resolveVisibleCardTiles } from '../functions/resolveVisibleCardTiles';
import { resolveVisibleCardRegions } from '../functions/resolveVisibleCardRegions';

it('五万字长卡仅生成视口附近的有界纹理，不生成全文长图', () => {
  const tiles = resolveVisibleCardTiles({ cardY: 100, cardHeight: 50000, worldTop: 20100, worldBottom: 21000, scale: 2 });
  expect(tiles).toEqual([{ offsetY: 18432, height: 2048 }, { offsetY: 20480, height: 2048 }]);
  expect(tiles.every((tile) => tile.height * 2 <= 4096)).toBe(true);
});

describe('viewport clipping', () => {
  it('高 DPR 宽卡只分配可见横纵切片，并保持完整正文的排版宽度', () => {
    const regions = resolveVisibleCardRegions({ cardX: 100, cardY: 100, cardWidth: 4000, cardHeight: 50000,
      worldLeft: 2200, worldTop: 20100, worldRight: 2500, worldBottom: 20500, scale: 4 });
    expect(regions).toEqual([{ offsetX: 2048, offsetY: 19456, width: 1024, height: 1024 }]);
    expect(regions.every((region) => region.width * 4 <= 4096 && region.height * 4 <= 4096)).toBe(true);
  });
  it('尾块裁到卡片高度；离开视口不调度', () => {
    expect(resolveVisibleCardTiles({ cardY: 100, cardHeight: 5000, worldTop: 4900, worldBottom: 5300, scale: 2 }))
      .toEqual([{ offsetY: 4096, height: 904 }]);
    expect(resolveVisibleCardTiles({ cardY: 6000, cardHeight: 5000, worldTop: 0, worldBottom: 1000, scale: 2 })).toEqual([]);
  });
});
