import {
  readCanvasCardCssPalette,
  readCanvasLinePalette,
  type CanvasColor,
} from '@plugin/canvas/shared';

const css = (value: number) => `#${value.toString(16).padStart(6, '0')}`;

/**
 * 颜色选择里的小色块。浅色主题直接用卡片纸色，描边取同色相深墨，淡染纸也能分辨；
 * 暗色主题的纸色都接近黑，七个色块看起来一样，改用同色相的中间色（与该色连线一致），
 * 默认色用中性灰。
 */
export function readCanvasSwatchStyle(
  color: CanvasColor,
  dark: boolean
): { readonly backgroundColor: string; readonly borderColor: string } {
  const palette = readCanvasCardCssPalette(color, dark);
  if (!dark)
    return {
      backgroundColor: palette.paper,
      borderColor: `color-mix(in srgb, ${palette.title} 38%, transparent)`,
    };
  return {
    backgroundColor: color === 'white' ? palette.muted : css(readCanvasLinePalette(true)[color]),
    borderColor: `color-mix(in srgb, ${palette.title} 20%, transparent)`,
  };
}
