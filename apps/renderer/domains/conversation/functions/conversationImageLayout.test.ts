import { describe, expect, it } from 'vitest';
import {
  calculateConversationImageBoxSize,
  calculateCompactConversationImageResultBoxSize,
  calculateConversationImageReservedBoxSize,
  calculateImageGenerationGridLayout,
  calculateImageGenerationResultHeight,
} from './conversationImageLayout';

describe('conversationImageLayout', () => {
  it('按 600x400 上限计算等比媒体盒，封顶高度时同步收窄宽度', () => {
    expect(calculateConversationImageBoxSize({ width: 1600, height: 900 }, 800)).toEqual({
      widthPx: 600,
      heightPx: 337.5,
    });
    expect(calculateConversationImageBoxSize({ width: 800, height: 1600 }, 800)).toEqual({
      widthPx: 200,
      heightPx: 400,
    });
    expect(calculateConversationImageBoxSize({ width: 400, height: 300 }, 300)).toEqual({
      widthPx: 300,
      heightPx: 225,
    });
  });

  it('无尺寸元数据时不伪造比例盒', () => {
    expect(calculateConversationImageBoxSize(null, 800)).toBeNull();
  });

  it('无尺寸元数据时返回 decode 前后不变的固定预留盒', () => {
    expect(calculateConversationImageReservedBoxSize(null, 800)).toEqual({
      widthPx: 600,
      heightPx: 400,
    });
    expect(calculateConversationImageReservedBoxSize(null, 320)).toEqual({
      widthPx: 320,
      heightPx: 400,
    });
  });

  it('查看图片沿用生成图片的媒体盒规则并等比缩小一半', () => {
    expect(
      calculateCompactConversationImageResultBoxSize({ width: 1600, height: 900 }, 600)
    ).toEqual({
      widthPx: 300,
      heightPx: 168.75,
    });
    expect(
      calculateCompactConversationImageResultBoxSize({ width: 800, height: 1600 }, 600)
    ).toEqual({
      widthPx: 100,
      heightPx: 200,
    });
    expect(calculateCompactConversationImageResultBoxSize(null, 600)).toEqual({
      widthPx: 300,
      heightPx: 200,
    });
  });

  it('按 ImageRenderer 多图 grid 的 CSS 几何计算列数与高度', () => {
    expect(calculateImageGenerationGridLayout(1, 800)).toMatchObject({
      columnCount: 1,
      rowCount: 1,
      itemSizePx: 800,
      totalHeightPx: 800,
    });

    expect(calculateImageGenerationGridLayout(4, 800)).toMatchObject({
      columnCount: 3,
      rowCount: 2,
      itemSizePx: 256,
      totalHeightPx: 528,
    });

    expect(calculateImageGenerationGridLayout(16, 800)).toMatchObject({
      columnCount: 3,
      rowCount: 6,
      itemSizePx: 256,
      totalHeightPx: 1616,
    });

    expect(calculateImageGenerationGridLayout(16, 1024)).toMatchObject({
      columnCount: 4,
      rowCount: 4,
      itemSizePx: 244,
      totalHeightPx: 1024,
    });
  });

  it('单图按有界媒体盒估高，缺失元数据时使用 400px 高度上限', () => {
    expect(calculateImageGenerationResultHeight(1, { width: 16, height: 9 }, 800)).toBe(337.5);
    expect(calculateImageGenerationResultHeight(1, null, 800)).toBe(400);
  });
});
