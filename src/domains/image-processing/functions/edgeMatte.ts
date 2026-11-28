/**
 * 边缘抠图：没有系统前景遮罩时的去背。假设四条边都是背景，沿每条边取一条背景颜色曲线，
 * 用 Coons 曲面插值出画面内部每一点“背景应该是什么颜色”，再从边框向内泛洪与估计背景足够接近的像素。
 * 能处理无缝背景纸上的渐变和暗角；展柜、复杂背景、人像会失败，所以调用方必须出检查图。
 */

/** 与估计背景的 CIELAB 色差在它以内算背景。在 30 张器物、植物、产品照片上，9 在“留投影”和“吃掉主体”之间最均衡。 */
export const EDGE_TOLERANCE = 9;

function linear(value: number): number {
  const v = value / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

function labF(t: number): number {
  return t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116;
}

/** sRGB → CIELAB（D65）。按色差而不按 RGB 距离判，暗部和亮部的容差才一致。 */
function toLab(rgb: Uint8Array, count: number): Float32Array {
  const lab = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    const r = linear(rgb[i * 3]);
    const g = linear(rgb[i * 3 + 1]);
    const b = linear(rgb[i * 3 + 2]);
    const x = labF((0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047);
    const y = labF(0.2126 * r + 0.7152 * g + 0.0722 * b);
    const z = labF((0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883);
    lab[i * 3] = 116 * y - 16;
    lab[i * 3 + 1] = 500 * (x - y);
    lab[i * 3 + 2] = 200 * (y - z);
  }
  return lab;
}

function median(values: number[]): number {
  values.sort((a, b) => a - b);
  return values[values.length >> 1];
}

/** 一条边上每个位置取边框条带内的中位色，条带上偶尔压到主体的像素不会把曲线带偏。 */
function edgeCurve(length: number, band: number, at: (position: number, depth: number) => number, lab: Float32Array): Float32Array {
  const curve = new Float32Array(length * 3);
  for (let position = 0; position < length; position += 1) {
    for (let c = 0; c < 3; c += 1) {
      curve[position * 3 + c] = median(Array.from({ length: band }, (_, depth) => lab[at(position, depth) * 3 + c]));
    }
  }
  return curve;
}

/**
 * 输入 3 通道 RGB（已缩小、轻微模糊），返回每个像素是不是背景（1 是背景）。
 * 只把与边框连通的近背景色当背景：主体内部和背景颜色相近的部分（白瓷的高光）不会被抠掉。
 */
export function edgeBackgroundMask(rgb: Uint8Array, width: number, height: number, tolerance: number): Uint8Array {
  const count = width * height;
  const lab = toLab(rgb, count);
  const band = Math.max(2, Math.round(Math.min(width, height) * 0.015));
  const top = edgeCurve(width, band, (x, d) => d * width + x, lab);
  const bottom = edgeCurve(width, band, (x, d) => (height - 1 - d) * width + x, lab);
  const left = edgeCurve(height, band, (y, d) => y * width + d, lab);
  const right = edgeCurve(height, band, (y, d) => y * width + width - 1 - d, lab);
  const distance = new Float32Array(count);
  for (let y = 0; y < height; y += 1) {
    const v = height === 1 ? 0 : y / (height - 1);
    for (let x = 0; x < width; x += 1) {
      const u = width === 1 ? 0 : x / (width - 1);
      const i = y * width + x;
      let sum = 0;
      for (let c = 0; c < 3; c += 1) {
        // Coons 曲面：上下、左右两组边线性插值相加，再减去四个角的双线性插值，四条边上正好等于边曲线
        const corners = (1 - u) * (1 - v) * top[c] + u * (1 - v) * top[(width - 1) * 3 + c]
          + (1 - u) * v * bottom[c] + u * v * bottom[(width - 1) * 3 + c];
        const background = (1 - v) * top[x * 3 + c] + v * bottom[x * 3 + c]
          + (1 - u) * left[y * 3 + c] + u * right[y * 3 + c] - corners;
        sum += (lab[i * 3 + c] - background) ** 2;
      }
      distance[i] = Math.sqrt(sum);
    }
  }
  const background = new Uint8Array(count);
  const stack: number[] = [];
  for (let x = 0; x < width; x += 1) stack.push(x, (height - 1) * width + x);
  for (let y = 0; y < height; y += 1) stack.push(y * width, y * width + width - 1);
  for (let i = stack.pop(); i !== undefined; i = stack.pop()) {
    if (background[i] || distance[i] >= tolerance) continue;
    background[i] = 1;
    const x = i % width;
    if (x > 0) stack.push(i - 1);
    if (x < width - 1) stack.push(i + 1);
    if (i >= width) stack.push(i - width);
    if (i < count - width) stack.push(i + width);
  }
  return background;
}
