import { canvasText } from '../../localization';
import type { CanvasColor } from '@plugin/canvas/shared';

/** 菜单与浮条共用的颜色顺序；名称按当前语言取。 */
export const CANVAS_PALETTE_COLORS: readonly CanvasColor[] = [
  'white',
  'red',
  'orange',
  'yellow',
  'green',
  'cyan',
  'purple',
];

export function canvasColorPalette(): readonly {
  readonly color: CanvasColor;
  readonly text: string;
}[] {
  return CANVAS_PALETTE_COLORS.map(color => ({ color, text: canvasText(`canvas.color.${color}`) }));
}
