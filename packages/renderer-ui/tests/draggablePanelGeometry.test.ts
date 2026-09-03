import { describe, expect, it } from 'vitest';
import {
  constrainDraggablePanelGeometry,
  normalizeDraggablePanelPositionOffset,
  parseDraggablePanelSize,
  resizeDraggablePanelGeometry,
  resolveDraggablePanelPosition,
  type DraggablePanelBounds,
} from '@linnya/renderer-ui';

const BOUNDS: DraggablePanelBounds = {
  left: 100,
  top: 50,
  width: 800,
  height: 600,
};

describe('draggable panel geometry', () => {
  it('把数字和局部边距统一成四边偏移', () => {
    expect(normalizeDraggablePanelPositionOffset(12)).toEqual({
      top: 12,
      right: 12,
      bottom: 12,
      left: 12,
    });
    expect(normalizeDraggablePanelPositionOffset({ top: 20, right: 24 })).toEqual({
      top: 20,
      right: 24,
      bottom: 16,
      left: 16,
    });
  });

  it('保持五种初始位置相对于真实容器边界的语义', () => {
    const size = { width: 200, height: 100 };
    const offset = { top: 10, right: 20, bottom: 30, left: 40 };

    expect(resolveDraggablePanelPosition(BOUNDS, size, 'center', offset)).toEqual({ x: 400, y: 300 });
    expect(resolveDraggablePanelPosition(BOUNDS, size, 'top-right', offset)).toEqual({ x: 680, y: 60 });
    expect(resolveDraggablePanelPosition(BOUNDS, size, 'top-left', offset)).toEqual({ x: 140, y: 60 });
    expect(resolveDraggablePanelPosition(BOUNDS, size, 'bottom-right', offset)).toEqual({ x: 680, y: 520 });
    expect(resolveDraggablePanelPosition(BOUNDS, size, 'bottom-left', offset)).toEqual({ x: 140, y: 520 });
  });

  it('将拖拽位置和固定尺寸约束在容器内', () => {
    expect(constrainDraggablePanelGeometry(
      { x: -100, y: 900, width: 1_000, height: 100 },
      BOUNDS,
      { width: 240, height: 180 },
    )).toEqual({
      x: 100,
      y: 470,
      width: 800,
      height: 180,
    });
  });

  it('从西北方向 resize 时同时更新尺寸、位置并执行最小尺寸约束', () => {
    expect(resizeDraggablePanelGeometry(
      {
        direction: 'nw',
        startX: 300,
        startY: 200,
        startWidth: 400,
        startHeight: 300,
        startPositionX: 200,
        startPositionY: 150,
      },
      { x: 600, y: 500 },
      BOUNDS,
      { width: 240, height: 180 },
    )).toEqual({
      x: 500,
      y: 450,
      width: 240,
      height: 180,
    });
  });

  it('保持原有字符串尺寸解析规则', () => {
    expect(parseDraggablePanelSize('560px', 900)).toBe(560);
    expect(parseDraggablePanelSize('auto', 900)).toBe(900);
  });
});
