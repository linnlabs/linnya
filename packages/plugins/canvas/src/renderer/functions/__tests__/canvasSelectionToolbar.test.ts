import { expect, it } from 'vitest';
import { canvasSelectionToolbarStyle } from '../canvasSelectionToolbarStyle';

it('普通选区上方保留10屏幕px，贴近胶囊时整体翻到卡下方，不覆盖正文', () => {
  const bounds = { x: 200, y: 160, width: 300, height: 100 };
  expect(canvasSelectionToolbarStyle(bounds, { x: 0, y: 0, zoom: 1 }, 1000).top).toBe('106px');
  expect(canvasSelectionToolbarStyle({ ...bounds, y: 50, height: 200 }, { x: 0, y: 0, zoom: 1 }, 1000).top).toBe('260px');
  // 卡顶118时浮条顶64，与胶囊底56恰好间隔8，无须提前翻下。
  expect(canvasSelectionToolbarStyle({ ...bounds, y: 118 }, { x: 0, y: 0, zoom: 1 }, 1000).top).toBe('64px');
  expect(canvasSelectionToolbarStyle({ ...bounds, y: 117 }, { x: 0, y: 0, zoom: 1 }, 1000).top).toBe('227px');
});
it('缩放和平移后依然按屏幕几何判断冲突，并支持实测工具栏尺寸', () => {
  const bounds = { x: 0, y: 200, width: 400, height: 300 };
  expect(canvasSelectionToolbarStyle(bounds, { x: 10, y: -80, zoom: 0.5 }, 320, { toolbarHeight: 44, capsuleBottom: 60 })).toEqual({ left: '160px', top: '180px' });
  expect(canvasSelectionToolbarStyle(null, { x: 0, y: 0, zoom: 1 }, 320)).toEqual({ display: 'none' });
});
