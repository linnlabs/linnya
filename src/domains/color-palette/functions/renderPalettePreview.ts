import type { ColorPalette } from '@app/schemas/color-palette';
import { parseColor } from '@linnya/color-core';
import type { ImageThumbnailPixels } from 'src/shared/media/image-pixels';

const WIDTH = 1200;
const ROW_HEIGHT = 140;
const MARGIN = 20;
const GROUP_GAP = 20;
/** 页面用中灰，近白和近黑的底都看得见边界。 */
const PAGE_CHANNEL = 138;
const GROUND_WIDTHS = [220, 110, 60, 60] as const;
const ACCENT_GROUP_WIDTH = 360;

interface Rect {
  readonly x: number;
  readonly width: number;
  readonly hex: string;
}

function evenCells(colors: readonly string[], x: number, width: number): Rect[] {
  return colors.map((hex, index) => {
    const left = x + Math.round((index * width) / colors.length);
    const right = x + Math.round(((index + 1) * width) / colors.length);
    return { x: left, width: right - left, hex };
  });
}

function rowCells(palette: ColorPalette): Rect[] {
  const grounds = [palette.bg, palette.surface, palette.ink, palette.muted];
  let x = MARGIN;
  const cells = grounds.map((hex, index) => {
    const width = GROUND_WIDTHS[index] ?? 0;
    const cell = { x, width, hex };
    x += width;
    return cell;
  });
  const accentX = x + GROUP_GAP;
  const chartX = accentX + ACCENT_GROUP_WIDTH + GROUP_GAP;
  return [
    ...cells,
    ...evenCells(palette.accent, accentX, ACCENT_GROUP_WIDTH),
    ...evenCells(palette.chart, chartX, WIDTH - MARGIN - chartX),
  ];
}

/** 每套一行，从上到下与 palettes 同序：底、面、墨、弱墨 | 强调色 | 图表色。不写文字，不依赖字体。 */
export function renderPalettePreview(palettes: readonly ColorPalette[]): ImageThumbnailPixels {
  const height = MARGIN + palettes.length * (ROW_HEIGHT + MARGIN);
  const data = new Uint8Array(WIDTH * height * 4);
  data.fill(PAGE_CHANNEL);
  for (let alpha = 3; alpha < data.length; alpha += 4) data[alpha] = 255;
  palettes.forEach((palette, row) => {
    const top = MARGIN + row * (ROW_HEIGHT + MARGIN);
    for (const cell of rowCells(palette)) {
      const channels = parseColor(cell.hex)?.channels;
      if (!channels) continue;
      for (let y = top; y < top + ROW_HEIGHT; y += 1) {
        for (let x = cell.x; x < cell.x + cell.width; x += 1) {
          data.set(channels, (y * WIDTH + x) * 4);
        }
      }
    }
  });
  return { width: WIDTH, height, data };
}
