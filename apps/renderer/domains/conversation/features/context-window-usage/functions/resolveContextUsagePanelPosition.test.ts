import { describe, expect, it } from 'vitest';
import { resolveContextUsagePanelPosition } from './resolveContextUsagePanelPosition';

describe('resolveContextUsagePanelPosition', () => {
  it('优先在输入框上方与触发器右对齐', () => {
    expect(resolveContextUsagePanelPosition({
      trigger: { top: 600, right: 800, bottom: 624 },
      panel: { width: 360, height: 300 },
      viewport: { width: 1_000, height: 700 },
      gap: 8,
      padding: 8,
    })).toEqual({ top: 292, left: 440 });
  });

  it('上方空间不足时改到下方，并约束在视口内', () => {
    expect(resolveContextUsagePanelPosition({
      trigger: { top: 20, right: 100, bottom: 44 },
      panel: { width: 360, height: 300 },
      viewport: { width: 400, height: 500 },
      gap: 8,
      padding: 8,
    })).toEqual({ top: 52, left: 8 });
  });
});
