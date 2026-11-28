/** 透明度过半算前景。 */
const SOLID_ALPHA = 128;
/**
 * 前景占比与贴边比例的常见范围。在 30 张器物、植物、产品照片上，前景不到 3% 多半是只剩碎片，超过 90% 多半是背景没去掉；
 * 最外一圈超过 8% 是前景，多半是背景连着主体被留下。这几条只拦得住约四成失败，检查图仍要看。
 */
const MIN_FOREGROUND = 0.03;
const MAX_FOREGROUND = 0.9;
const MAX_BORDER_FOREGROUND = 0.08;

export interface ForegroundCoverage {
  readonly foregroundRatio: number;
  readonly borderForeground: number;
  readonly suspicious: boolean;
}

/** 输入单通道透明度。 */
export function foregroundCoverage(alpha: Uint8Array, width: number, height: number): ForegroundCoverage {
  let foreground = 0;
  let border = 0;
  let borderForeground = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const solid = alpha[y * width + x] >= SOLID_ALPHA;
      if (solid) foreground += 1;
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) {
        border += 1;
        if (solid) borderForeground += 1;
      }
    }
  }
  const foregroundRatio = foreground / (width * height);
  const borderRatio = borderForeground / border;
  return {
    foregroundRatio,
    borderForeground: borderRatio,
    suspicious: foregroundRatio < MIN_FOREGROUND || foregroundRatio > MAX_FOREGROUND || borderRatio > MAX_BORDER_FOREGROUND,
  };
}
