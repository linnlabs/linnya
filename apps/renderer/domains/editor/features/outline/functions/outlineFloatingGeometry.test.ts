import { describe, expect, it } from 'vitest';

import {
  calculateOutlinePanelTop,
  calculateOutlineTriggerTop,
  estimateOutlinePanelHeight,
} from './outlineFloatingGeometry';

const baseBounds = {
  hostTop: 80,
  hostHeight: 720,
  viewportHeight: 900,
  edgeGap: 16,
};

describe('outlineFloatingGeometry', () => {
  it('将触发条放在当前文件窗口的中线偏上位置', () => {
    expect(
      calculateOutlineTriggerTop({
        ...baseBounds,
        triggerHeight: 104,
      })
    ).toBe(244);
  });

  it('短目录围绕触发条居中展开，而不是固定从顶部出现', () => {
    const triggerTop = calculateOutlineTriggerTop({
      ...baseBounds,
      triggerHeight: 104,
    });

    expect(
      calculateOutlinePanelTop({
        ...baseBounds,
        anchorTop: triggerTop,
        anchorHeight: 104,
        itemCount: 2,
        itemHeight: 28,
        listVerticalPadding: 28,
        minPanelHeight: 100,
        maxPanelHeight: 560,
      })
    ).toBe(246);
  });

  it('长目录使用更高面板，因此 top 会向上移动', () => {
    const triggerTop = calculateOutlineTriggerTop({
      ...baseBounds,
      triggerHeight: 104,
    });

    const shortTop = calculateOutlinePanelTop({
      ...baseBounds,
      anchorTop: triggerTop,
      anchorHeight: 104,
      itemCount: 2,
      itemHeight: 28,
      listVerticalPadding: 28,
      minPanelHeight: 100,
      maxPanelHeight: 560,
    });
    const longTop = calculateOutlinePanelTop({
      ...baseBounds,
      anchorTop: triggerTop,
      anchorHeight: 104,
      itemCount: 80,
      itemHeight: 28,
      listVerticalPadding: 28,
      minPanelHeight: 100,
      maxPanelHeight: 560,
    });

    expect(longTop).toBeLessThan(shortTop);
    expect(longTop).toBe(96);
  });

  it('超长目录不会越过当前文件窗口顶部安全边界', () => {
    expect(
      calculateOutlinePanelTop({
        hostTop: 80,
        hostHeight: 420,
        viewportHeight: 900,
        edgeGap: 16,
        anchorTop: 120,
        anchorHeight: 104,
        itemCount: 1000,
        itemHeight: 28,
        listVerticalPadding: 28,
        minPanelHeight: 100,
        maxPanelHeight: 560,
      })
    ).toBe(96);
  });

  it('面板高度不会超过当前文件窗口可用高度', () => {
    expect(
      estimateOutlinePanelHeight({
        hostTop: 100,
        hostHeight: 260,
        viewportHeight: 900,
        edgeGap: 16,
        anchorTop: 178,
        anchorHeight: 104,
        itemCount: 80,
        itemHeight: 28,
        listVerticalPadding: 28,
        minPanelHeight: 100,
        maxPanelHeight: 560,
      })
    ).toBe(228);
  });
});
