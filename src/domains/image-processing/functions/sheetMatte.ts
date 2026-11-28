import type { RgbColor } from '../definitions/imageProcessing';

/**
 * 键色通道超出量（绿幕抠像的经典做法）：绿底看 G 比 max(R,B) 高多少，品红底看 min(R,B) 比 G 高多少，
 * 再用底色自身的超出量归一。比按 RGB 距离稳：底色有渐变、元素有阴影时亮度变了，超出量的比例不变。
 * 低于 LOW 当作完全不透明，高于 HIGH 当作完全透明；两个阈值来自 18 张生图色键素材的实测（透明度误差中位 1.2/255）。
 */
const EXCESS_OPAQUE = 0.12;
const EXCESS_TRANSPARENT = 0.75;
/** 去溢色后仍有这么多键色超出量的可见像素算“残留键色”。 */
const RESIDUAL_EXCESS = 40;
/** 泛洪时与底色的 RGB 距离在它以内算底：JPEG 压缩噪声与轻微渐变实测都在 30 以内。 */
const FLOOD_TOLERANCE = 40;
/** 泛洪模式下贴着底的那一圈按距离给柔边，距离到这么远才算完全不透明。 */
const FLOOD_EDGE_SOFTNESS = 120;

function excessOf(green: boolean, r: number, g: number, b: number): number {
  return green ? g - Math.max(r, b) : Math.min(r, b) - g;
}

/** 由观测色、透明度和底色解出前景色：观测色 = a·前景 + (1-a)·底色。 */
function unmix(observed: number, alpha: number, key: number): number {
  return Math.min(255, Math.max(0, (observed - (1 - alpha) * key) / alpha));
}

export interface SheetMatte {
  /** 预乘前的 RGBA，透明处为 0。 */
  readonly rgba: Uint8Array;
  /** 可见像素（透明度过半）里仍带键色的比例，0–1；泛洪模式没有键色，记为 0。 */
  readonly residual: number;
}

/** 品红或绿底：逐像素算透明度、反混合去掉边缘溢色，再把残留的键色分量压到另两个通道的水平。 */
export function chromaKeyMatte(rgba: Uint8Array, width: number, height: number, key: RgbColor, green: boolean): SheetMatte {
  const keyExcess = excessOf(green, key[0], key[1], key[2]);
  const out = new Uint8Array(width * height * 4);
  let visible = 0;
  let residual = 0;
  for (let i = 0; i < width * height; i += 1) {
    const o = i * 4;
    const q = excessOf(green, rgba[o], rgba[o + 1], rgba[o + 2]) / keyExcess;
    const alpha = Math.min(1, Math.max(0, (EXCESS_TRANSPARENT - q) / (EXCESS_TRANSPARENT - EXCESS_OPAQUE))) * (rgba[o + 3] / 255);
    if (alpha <= 0) continue;
    let r = unmix(rgba[o], alpha, key[0]);
    let g = unmix(rgba[o + 1], alpha, key[1]);
    let b = unmix(rgba[o + 2], alpha, key[2]);
    if (green) {
      g = Math.min(g, Math.max(r, b));
    } else {
      const floor = Math.min(r, b);
      if (floor > g) {
        r -= (floor - g) / 2;
        b -= (floor - g) / 2;
      }
    }
    out[o] = Math.round(r);
    out[o + 1] = Math.round(g);
    out[o + 2] = Math.round(b);
    out[o + 3] = Math.round(alpha * 255);
    if (alpha > 0.5) {
      visible += 1;
      if (excessOf(green, out[o], out[o + 1], out[o + 2]) > RESIDUAL_EXCESS) residual += 1;
    }
  }
  return { rgba: out, residual: visible === 0 ? 0 : residual / visible };
}

/**
 * 白底、灰底等其他纯色底：从边框向内泛洪“接近底色”的像素当背景，元素内部和底色相近的白色（高光、骷髅、药瓶）
 * 不和边框连通，所以保得住。元素贴着背景的那一圈按与底色的距离给柔边并反混合，避免在深色页面上露出白边。
 */
export function floodMatte(rgba: Uint8Array, width: number, height: number, key: RgbColor): SheetMatte {
  const distance = (i: number): number => Math.hypot(rgba[i * 4] - key[0], rgba[i * 4 + 1] - key[1], rgba[i * 4 + 2] - key[2]);
  const background = new Uint8Array(width * height);
  const stack: number[] = [];
  for (let x = 0; x < width; x += 1) stack.push(x, (height - 1) * width + x);
  for (let y = 0; y < height; y += 1) stack.push(y * width, y * width + width - 1);
  for (let i = stack.pop(); i !== undefined; i = stack.pop()) {
    if (background[i] || distance(i) > FLOOD_TOLERANCE) continue;
    background[i] = 1;
    const x = i % width;
    if (x > 0) stack.push(i - 1);
    if (x < width - 1) stack.push(i + 1);
    if (i >= width) stack.push(i - width);
    if (i < width * (height - 1)) stack.push(i + width);
  }
  const out = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    if (background[i]) continue;
    const o = i * 4;
    const x = i % width;
    const touchesBackground = (x > 0 && background[i - 1] === 1) || (x < width - 1 && background[i + 1] === 1)
      || (i >= width && background[i - width] === 1) || (i < width * (height - 1) && background[i + width] === 1);
    const alpha = touchesBackground ? Math.min(1, distance(i) / FLOOD_EDGE_SOFTNESS) * (rgba[o + 3] / 255) : rgba[o + 3] / 255;
    if (alpha <= 0) continue;
    out[o] = Math.round(unmix(rgba[o], alpha, key[0]));
    out[o + 1] = Math.round(unmix(rgba[o + 1], alpha, key[1]));
    out[o + 2] = Math.round(unmix(rgba[o + 2], alpha, key[2]));
    out[o + 3] = Math.round(alpha * 255);
  }
  return { rgba: out, residual: 0 };
}
