import { describe, expect, it } from 'vitest';
import { resolveRemovalViewportAnchor } from './removalViewportAnchor';

/** user 0–60，过程三行 60–460，回答 460–1260。 */
const rows = [
  { key: 'user', start: 0, end: 60 },
  { key: 'thought', start: 60, end: 120 },
  { key: 'search', start: 120, end: 400 },
  { key: 'preamble', start: 400, end: 460 },
  { key: 'answer', start: 460, end: 1260 },
];
const afterFold = new Set(['user', 'fold', 'answer']);

describe('收起工作过程时保持正在看的回答不动', () => {
  it('视口里有被收起的过程：锚定其下方的回答，回答在屏幕上的位置不变', () => {
    // 视口 300–900：看到搜索卡的下半截和回答开头。
    expect(resolveRemovalViewportAnchor({ previous: rows, nextKeys: afterFold, scrollOffset: 300, viewportHeight: 600 }))
      .toEqual({ rowKey: 'answer', offsetFromRowStartPx: -160 });
  });

  it('被收起的行都在视口外（已滚过或还没滚到）：交给虚拟列表按顶行归位', () => {
    expect(resolveRemovalViewportAnchor({ previous: rows, nextKeys: afterFold, scrollOffset: 600, viewportHeight: 500 }))
      .toBeNull();
  });
});
