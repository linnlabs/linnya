import type { CustomSelectOption } from '@linnya/renderer-ui';
import type { CanvasPatch } from '@plugin/canvas/shared';
import { canvasChromeColorChoices } from '../../canvasChrome';
const directions = [
  { value: 'direction-none', text: '无箭头' },
  { value: 'direction-forward', text: '单向' },
  { value: 'direction-both', text: '双向' },
];
const shapes: readonly CustomSelectOption<string>[] = [
  { value: 'shape-curve', text: '曲线' },
  { value: 'shape-straight', text: '直线' },
  { isSeparator: true },
  { value: 'pattern-solid', text: '实线' },
  { value: 'pattern-dashed', text: '虚线' },
];
const colors = canvasChromeColorChoices(
  [
    { color: 'white', text: '原色' },
    { color: 'red', text: '红' },
    { color: 'orange', text: '橙' },
    { color: 'yellow', text: '黄' },
    { color: 'green', text: '绿' },
    { color: 'cyan', text: '青' },
    { color: 'purple', text: '紫' },
  ],
  color => `color-${color}`
);
export const canvasConnectionContextActions: readonly CustomSelectOption<string>[] = [
  { value: 'label', text: '编辑标签', shortcut: '↩' },
  { text: '方向', children: directions },
  { text: '线形', children: shapes },
  { text: '颜色', children: colors },
  { value: 'reverse', text: '反转方向' },
  { value: 'jump-from', text: '跳到起点' },
  { value: 'jump-to', text: '跳到终点' },
  { isSeparator: true },
  { value: 'delete', text: '删除连线', shortcut: '⌫' },
];
const patches: ReadonlyMap<string, CanvasPatch> = new Map([
  ['direction-none', { direction: 'none' }],
  ['direction-forward', { direction: 'forward' }],
  ['direction-both', { direction: 'both' }],
  ['shape-curve', { lineStyle: 'curve' }],
  ['shape-straight', { lineStyle: 'straight' }],
  ['pattern-solid', { linePattern: 'solid' }],
  ['pattern-dashed', { linePattern: 'dashed' }],
  ['color-white', { color: 'white' }],
  ['color-red', { color: 'red' }],
  ['color-orange', { color: 'orange' }],
  ['color-yellow', { color: 'yellow' }],
  ['color-green', { color: 'green' }],
  ['color-cyan', { color: 'cyan' }],
  ['color-purple', { color: 'purple' }],
]);
export function readCanvasConnectionMenuPatch(value: string): CanvasPatch | null {
  return patches.get(value) ?? null;
}
