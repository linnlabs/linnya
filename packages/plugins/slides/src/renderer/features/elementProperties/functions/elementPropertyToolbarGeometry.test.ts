import { describe, expect, it } from 'vitest';
import { resolveElementPropertyPopoverPosition, resolveElementPropertyToolbarPosition } from './elementPropertyToolbarGeometry';

const viewport = { width: 600, height: 400 };
const surface = { width: 180, height: 36 };

describe('选区属性工具条的可见边界', () => {
  it('普通选择优先在上方，层级标签占据额外间距；顶边选择翻到下方', () => {
    const selection = { left: 120, top: 100, width: 200, height: 80 };
    const plain = resolveElementPropertyToolbarPosition({ selection, viewport }, surface, false);
    const grouped = resolveElementPropertyToolbarPosition({ selection, viewport }, surface, true);
    expect(plain).not.toBeNull(); expect(grouped).not.toBeNull();
    expect((grouped?.top ?? 0) + surface.height).toBeLessThan((plain?.top ?? 0) + surface.height);
    const topSelection = { ...selection, top: 0 };
    expect(resolveElementPropertyToolbarPosition({ selection: topSelection, viewport }, surface, true)?.top).toBeGreaterThan(topSelection.height);
  });

  it('超大父框和越界子元素的并集保持工具条可触达；完全离开视口才隐藏', () => {
    for (const selection of [
      { left: -200, top: -100, width: 1000, height: 600 },
      { left: 550, top: 160, width: 200, height: 100 },
      { left: -100, top: 360, width: 200, height: 100 },
    ]) {
      const position = resolveElementPropertyToolbarPosition({ selection, viewport }, surface, true);
      expect(position).not.toBeNull();
      expect(position?.left).toBeGreaterThanOrEqual(0);
      expect((position?.left ?? 0) + surface.width).toBeLessThanOrEqual(viewport.width);
      expect(position?.top).toBeGreaterThanOrEqual(0);
      expect((position?.top ?? 0) + surface.height).toBeLessThanOrEqual(viewport.height);
    }
    expect(resolveElementPropertyToolbarPosition({ selection: { left: 610, top: 100, width: 100, height: 50 }, viewport }, surface, false)).toBeNull();
  });

  it('自定义颜色展开后仍限制在当前 pane，底部色板向上展开', () => {
    const toolbar = { left: 500, top: 340, width: 90, height: 36 };
    const panel = { width: 224, height: 250 };
    const position = resolveElementPropertyPopoverPosition(toolbar, panel, viewport);
    expect(position.top + panel.height).toBeLessThan(toolbar.top);
    expect(position.left + panel.width).toBeLessThanOrEqual(viewport.width);
  });
});
