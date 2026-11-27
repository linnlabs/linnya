import { expect, it } from 'vitest';
import { resolveComposerReferenceHoverSide } from './resolveComposerReferenceHoverSide';

// 弹层的实际坐标、打开期间不翻面由 renderer-ui 的浏览器测试覆盖（flip: false 一例），这里只验朝向规则。
it('prefers opening above the reference so the composer stays visible', () => {
  expect(resolveComposerReferenceHoverSide({ top: 407, bottom: 425 }, 900)).toBe('top');
});

it('opens below only when the room above cannot hold a preview and below has more', () => {
  expect(resolveComposerReferenceHoverSide({ top: 50, bottom: 68 }, 900)).toBe('bottom');
  expect(resolveComposerReferenceHoverSide({ top: 300, bottom: 318 }, 900)).toBe('bottom');
  // 上方不足一屏预览，但下方更窄：仍朝上。
  expect(resolveComposerReferenceHoverSide({ top: 300, bottom: 318 }, 500)).toBe('top');
});
