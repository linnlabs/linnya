import type { CustomSelectOption } from '@linnya/renderer-ui';
import type { CanvasPatch } from '@plugin/canvas/shared';
import { canvasChromeColorChoices, canvasColorPalette, canvasMenuIcons } from '../../canvasChrome';
import { canvasText } from '../../localization';
function directions(): readonly CustomSelectOption<string>[] {
  return [
    {
      value: 'direction-none',
      text: canvasText('canvas.connection.directionNone'),
      iconComponent: canvasMenuIcons['direction:none'],
    },
    {
      value: 'direction-forward',
      text: canvasText('canvas.connection.directionForward'),
      iconComponent: canvasMenuIcons['direction:forward'],
    },
    {
      value: 'direction-both',
      text: canvasText('canvas.connection.directionBoth'),
      iconComponent: canvasMenuIcons['direction:both'],
    },
  ];
}
function shapes(): readonly CustomSelectOption<string>[] {
  return [
    {
      value: 'shape-curve',
      text: canvasText('canvas.connection.curve'),
      iconComponent: canvasMenuIcons['lineStyle:curve'],
    },
    {
      value: 'shape-straight',
      text: canvasText('canvas.connection.straight'),
      iconComponent: canvasMenuIcons['lineStyle:straight'],
    },
    { isSeparator: true },
    {
      value: 'pattern-solid',
      text: canvasText('canvas.connection.solid'),
      iconComponent: canvasMenuIcons['linePattern:solid'],
    },
    {
      value: 'pattern-dashed',
      text: canvasText('canvas.connection.dashed'),
      iconComponent: canvasMenuIcons['linePattern:dashed'],
    },
  ];
}
/** 菜单项按当前语言现取现建；颜色名与卡片菜单同源。 */
export function canvasConnectionContextActions(): readonly CustomSelectOption<string>[] {
  return [
    { value: 'label', text: canvasText('canvas.connection.editLabel'), shortcut: '↩' },
    { text: canvasText('canvas.connection.direction'), children: directions() },
    { text: canvasText('canvas.connection.shape'), children: shapes() },
    {
      text: canvasText('canvas.color.menu'),
      children: canvasChromeColorChoices(canvasColorPalette(), color => `color-${color}`),
    },
    { value: 'reverse', text: canvasText('canvas.connection.reverse') },
    { value: 'jump-from', text: canvasText('canvas.connection.jumpFrom') },
    { value: 'jump-to', text: canvasText('canvas.connection.jumpTo') },
    { isSeparator: true },
    {
      value: 'delete',
      text: canvasText('canvas.connection.delete'),
      shortcut: '⌫',
      variant: 'danger',
    },
  ];
}
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
