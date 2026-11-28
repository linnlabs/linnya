import type { ImageQuad } from '../definitions/imageProcessing';

/** 3×3 单应矩阵按行展开，最后一项固定为 1。 */
type Homography = readonly [number, number, number, number, number, number, number, number, number];

export interface RgbaPixels {
  readonly width: number;
  readonly height: number;
  /** RGBA 8 位，长度 width × height × 4。 */
  readonly data: Uint8Array;
}

/**
 * 解出把 from 的四个点映到 to 的单应矩阵（8 元线性方程组，部分主元高斯消元）。
 * 四边形已由 `quadProblem` 保证凸且不退化，这里不会遇到奇异矩阵。
 */
function solveHomography(from: ImageQuad, to: ImageQuad): Homography {
  const rows: number[][] = [];
  for (let i = 0; i < 4; i += 1) {
    const [x, y] = from[i];
    const [u, v] = to[i];
    rows.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]);
    rows.push([0, 0, 0, x, y, 1, -v * x, -v * y, v]);
  }
  for (let column = 0; column < 8; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < 8; row += 1) {
      if (Math.abs(rows[row][column]) > Math.abs(rows[pivot][column])) pivot = row;
    }
    [rows[column], rows[pivot]] = [rows[pivot], rows[column]];
    const pivotRow = rows[column];
    for (let row = 0; row < 8; row += 1) {
      if (row === column) continue;
      const target = rows[row];
      const factor = target[column] / pivotRow[column];
      for (let k = column; k < 9; k += 1) target[k] = target[k] - factor * pivotRow[k];
    }
  }
  const h = rows.map((row, index) => row[8] / row[index]);
  return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
}

function cross(o: readonly [number, number], a: readonly [number, number], b: readonly [number, number]): number {
  return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
}

/**
 * 四边形能否当投影目标：点要按左上、右上、右下、左下顺时针给出，围成凸四边形，面积至少占画布 1%。
 * 模型最常见的错误是顺序写反或两点重合，返回一句能照着改的原因；成立时返回 null。
 */
export function quadProblem(quad: ImageQuad): string | null {
  if (quad.some(([x, y]) => !Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1 || y < 0 || y > 1)) {
    return '四个角都要在 0–1 之间（按画布宽高的比例）';
  }
  const turns = quad.map((point, index) => cross(point, quad[(index + 1) % 4], quad[(index + 2) % 4]));
  // 画布 y 轴向下，顺时针时叉积为正。
  if (!turns.every(turn => turn > 0)) return '四个角要按左上、右上、右下、左下的顺序，围成凸四边形';
  const area = Math.abs(
    quad.reduce((sum, point, index) => {
      const next = quad[(index + 1) % 4];
      return sum + point[0] * next[1] - next[0] * point[1];
    }, 0),
  ) / 2;
  if (area < 0.01) return '四边形太小（不到画布的 1%）';
  return null;
}

/**
 * 把整张图投影进画布上的四边形，四边形外透明。
 * sharp 只有仿射变换；这里对每个输出像素反算原图位置，双线性取样。透明度按预乘处理，
 * 否则边缘的透明黑像素会把颜色拖暗、出现黑边。
 */
export function warpIntoQuad(source: RgbaPixels, quad: ImageQuad, width: number, height: number): Uint8Array {
  const canvas: ImageQuad = [
    [quad[0][0] * width, quad[0][1] * height],
    [quad[1][0] * width, quad[1][1] * height],
    [quad[2][0] * width, quad[2][1] * height],
    [quad[3][0] * width, quad[3][1] * height],
  ];
  const sw = source.width;
  const sh = source.height;
  const corners: ImageQuad = [[0, 0], [sw, 0], [sw, sh], [0, sh]];
  const m = solveHomography(canvas, corners);
  const out = new Uint8Array(width * height * 4);
  const src = source.data;
  const sample = (x: number, y: number, channel: number): number => src[(y * sw + x) * 4 + channel];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      // 取像素中心
      const px = x + 0.5;
      const py = y + 0.5;
      const d = m[6] * px + m[7] * py + m[8];
      const sx = (m[0] * px + m[1] * py + m[2]) / d - 0.5;
      const sy = (m[3] * px + m[4] * py + m[5]) / d - 0.5;
      if (sx < -0.5 || sy < -0.5 || sx > sw - 0.5 || sy > sh - 0.5) continue;
      const cx = Math.min(Math.max(sx, 0), sw - 1);
      const cy = Math.min(Math.max(sy, 0), sh - 1);
      const x0 = Math.floor(cx);
      const y0 = Math.floor(cy);
      const x1 = Math.min(x0 + 1, sw - 1);
      const y1 = Math.min(y0 + 1, sh - 1);
      const fx = cx - x0;
      const fy = cy - y0;
      const weights = [(1 - fx) * (1 - fy), fx * (1 - fy), (1 - fx) * fy, fx * fy] as const;
      const taps = [[x0, y0], [x1, y0], [x0, y1], [x1, y1]] as const;
      let alpha = 0;
      const color = [0, 0, 0];
      for (let t = 0; t < 4; t += 1) {
        const [tx, ty] = taps[t];
        const a = sample(tx, ty, 3) * weights[t];
        alpha += a;
        for (let c = 0; c < 3; c += 1) color[c] = color[c] + sample(tx, ty, c) * a;
      }
      if (alpha <= 0) continue;
      const o = (y * width + x) * 4;
      out[o] = Math.round(color[0] / alpha);
      out[o + 1] = Math.round(color[1] / alpha);
      out[o + 2] = Math.round(color[2] / alpha);
      out[o + 3] = Math.round(alpha);
    }
  }
  return out;
}
