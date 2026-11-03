import type { CanvasPatch } from '@plugin/canvas/shared';
const directions = [{ value: 'direction-none', text: '方向 · 无箭头' }, { value: 'direction-forward', text: '方向 · 单向' }, { value: 'direction-both', text: '方向 · 双向' }];
const shapes = [{ value: 'shape-curve', text: '线形 · 曲线' }, { value: 'shape-straight', text: '线形 · 直线' }, { value: 'pattern-solid', text: '笔触 · 实线' }, { value: 'pattern-dashed', text: '笔触 · 虚线' }];
const colors = [{ value: 'color-white', text: '颜色 · 原色' }, { value: 'color-red', text: '颜色 · 红' }, { value: 'color-orange', text: '颜色 · 橙' }, { value: 'color-yellow', text: '颜色 · 黄' }, { value: 'color-green', text: '颜色 · 绿' }, { value: 'color-cyan', text: '颜色 · 青' }, { value: 'color-purple', text: '颜色 · 紫' }];
export const canvasConnectionContextActions = [
  { value: 'label', text: '编辑标签 ↩' }, ...directions, ...shapes, ...colors,
  { value: 'reverse', text: '反转方向' }, { value: 'jump-from', text: '跳到起点' }, { value: 'jump-to', text: '跳到终点' }, { value: 'delete', text: '删除连线 ⌫' },
];
const patches: ReadonlyMap<string, CanvasPatch> = new Map([
  ['direction-none', { direction: 'none' }], ['direction-forward', { direction: 'forward' }], ['direction-both', { direction: 'both' }],
  ['shape-curve', { lineStyle: 'curve' }], ['shape-straight', { lineStyle: 'straight' }], ['pattern-solid', { linePattern: 'solid' }], ['pattern-dashed', { linePattern: 'dashed' }],
  ['color-white', { color: 'white' }], ['color-red', { color: 'red' }], ['color-orange', { color: 'orange' }], ['color-yellow', { color: 'yellow' }], ['color-green', { color: 'green' }], ['color-cyan', { color: 'cyan' }], ['color-purple', { color: 'purple' }],
]);
export function readCanvasConnectionMenuPatch(value: string): CanvasPatch | null { return patches.get(value) ?? null; }
