/**
 * AestheticLint 色彩采样 / 聚类
 *
 * 单一职责：把一页/一组元素的"chromatic（非中性）填充与文字色"提取为
 * `ChromaticSample[]`，并提供"主色"（hue）的稳健提取。
 *
 * 服务于：
 * - `palette_too_diverse`（单页色相簇数）
 * - `primary_hue_drift`（跨页主色漂移）
 *
 * 设计要点：
 * - 中性色（近灰/近白/近黑）通过 `isNeutralColor` 过滤——它们不参与"色相统计"；
 * - 文本色按其元素 bbox 面积折半计入，避免大文本框压过 shape fill；
 * - 色相按 OKLCH，归档用 color-core 的 12 档色相名，与配色建议同一口径；
 * - 主色用"同名色相面积之和最大者 → 其中圆形加权平均"避免分界处抖动。
 */

import type { Oklch } from '@linnya/color-core';
import { hueName } from '@linnya/color-core/palette';
import { parseHex, toOklch, isNeutralColor, type RgbColor } from '../colorUtils.js';
import type { SlideElementInfo } from '@plugin/slides/shared';

export interface ChromaticSample {
  hex: string;
  rgb: RgbColor;
  color: Oklch;
  /** 用于面积加权统计 */
  area: number;
}

/**
 * 采样单页所有非中性 fill / textColor，按面积加权。
 * 用于 palette diversity（单页）和 primary hue（跨页）两个规则共用。
 */
export function samplePageChromaticColors(elements: SlideElementInfo[]): ChromaticSample[] {
  const out: ChromaticSample[] = [];
  for (const el of elements) {
    const area = el.position ? el.position.w * el.position.h : 0;
    if (el.fill) {
      const sample = toSample(el.fill, area);
      if (sample) out.push(sample);
    }
    if (el.textColor) {
      /* 文本色按其元素 bbox 面积折半计入（避免大文本框压过 shape fill） */
      const sample = toSample(el.textColor, area * 0.5);
      if (sample) out.push(sample);
    }
  }
  return out;
}

export function toSample(hex: string, area: number): ChromaticSample | null {
  const rgb = parseHex(hex);
  if (!rgb) return null;
  const color = toOklch(rgb);
  if (isNeutralColor(color)) return null;
  return { hex, rgb, color, area: Math.max(0, area) };
}

/**
 * 选出页面"主色"（OKLCH 色相，度）：把所有 chromatic 采样按色相名聚类，
 * 面积之和最大的一类 → 取该类面积加权的平均色相。
 *
 * 没有 chromatic 采样 → 返回 null（视为该页无主色，不参与跨页漂移统计）。
 */
export function pickPrimaryHue(samples: ChromaticSample[]): number | null {
  if (samples.length === 0) return null;
  const clusters = new Map<string, { area: number; samples: ChromaticSample[] }>();
  for (const s of samples) {
    const key = hueName(s.color.h);
    const cur = clusters.get(key);
    if (cur) {
      cur.area += s.area;
      cur.samples.push(s);
    } else {
      clusters.set(key, { area: s.area, samples: [s] });
    }
  }
  let best: { area: number; samples: ChromaticSample[] } | null = null;
  for (const cluster of clusters.values()) {
    if (best == null || cluster.area > best.area) best = cluster;
  }
  if (best == null) return null;
  /* 类内做圆形加权平均（区间窄，可视作线性平均 + 360 折叠） */
  let sumCos = 0;
  let sumSin = 0;
  for (const s of best.samples) {
    const w = Math.max(s.area, 1e-6);
    const rad = (s.color.h * Math.PI) / 180;
    sumCos += Math.cos(rad) * w;
    sumSin += Math.sin(rad) * w;
  }
  let hue = (Math.atan2(sumSin, sumCos) * 180) / Math.PI;
  if (hue < 0) hue += 360;
  return hue;
}
