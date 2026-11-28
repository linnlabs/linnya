import type { RgbColor, SheetKeyMode } from '../definitions/imageProcessing';

/** 3px 边框各通道的中位绝对偏差超过它，说明底色不是纯色（例如生图模型画出来的假棋盘格，实测 16；真纯色底实测 2）。 */
export const MAX_BACKGROUND_DEVIATION = 8;
/** 键色通道比另两个通道高出这么多才算品红或绿：生图模型给的绿底实测在 150 以上。 */
const CHROMA_MARGIN = 40;

export interface SheetBackground {
  readonly color: RgbColor;
  /** 三个通道里最大的中位绝对偏差。 */
  readonly deviation: number;
}

function median(values: number[]): number {
  values.sort((a, b) => a - b);
  return values[values.length >> 1];
}

/** 实测底色：取 3px 边框逐通道的中位数。生图模型给的“纯绿”很少正好是 #00FF00，不能假设标准值。 */
export function measureSheetBackground(rgba: Uint8Array, width: number, height: number): SheetBackground {
  const channels: number[][] = [[], [], []];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (x > 2 && y > 2 && x < width - 3 && y < height - 3) continue;
      const o = (y * width + x) * 4;
      for (let c = 0; c < 3; c += 1) channels[c].push(rgba[o + c]);
    }
  }
  const color: RgbColor = [median([...channels[0]]), median([...channels[1]]), median([...channels[2]])];
  const deviation = Math.max(...channels.map((values, c) => median(values.map(value => Math.abs(value - color[c])))));
  return { color, deviation };
}

/**
 * 按实测底色选算法：品红、绿走色键（能处理半透明边缘和元素中间的空隙），其余纯色底（白底、灰底）从边框泛洪
 * （不会把元素内部和底色相近的白色抠掉）。
 */
export function sheetKeyModeOf(color: RgbColor): SheetKeyMode {
  const [r, g, b] = color;
  if (g > r + CHROMA_MARGIN && g > b + CHROMA_MARGIN) return 'green';
  if (r > g + CHROMA_MARGIN && b > g + CHROMA_MARGIN) return 'magenta';
  return 'flood';
}
