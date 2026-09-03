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
 * - 主色用"30° hue 桶面积之和最大者 → 桶内圆形加权平均"避免桶边界抖动。
 */

import {
  parseHex,
  rgbToHsl,
  isNeutralColor,
  type RgbColor,
  type HslColor,
} from '../colorUtils.js';
import type { SlideElementInfo } from '@plugin/slides/shared';
import { HUE_CLUSTER_GRANULARITY_DEG } from './thresholds.js';

export interface ChromaticSample {
  hex: string;
  rgb: RgbColor;
  hsl: HslColor;
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
  const hsl = rgbToHsl(rgb);
  if (isNeutralColor(hsl)) return null;
  return { hex, rgb, hsl, area: Math.max(0, area) };
}

/**
 * 选出页面"主色"（hue, 度）：把所有 chromatic 采样按 30° hue 桶聚类，
 * 桶面积之和最大的桶 → 取该桶面积加权的平均 hue。
 *
 * 没有 chromatic 采样 → 返回 null（视为该页无主色，不参与跨页漂移统计）。
 */
export function pickPrimaryHue(samples: ChromaticSample[]): number | null {
  if (samples.length === 0) return null;
  const buckets = new Map<number, { area: number; samples: ChromaticSample[] }>();
  for (const s of samples) {
    const key = Math.floor(s.hsl.h / HUE_CLUSTER_GRANULARITY_DEG);
    const cur = buckets.get(key);
    if (cur) {
      cur.area += s.area;
      cur.samples.push(s);
    } else {
      buckets.set(key, { area: s.area, samples: [s] });
    }
  }
  let bestKey: number | null = null;
  let bestArea = -Infinity;
  for (const [key, v] of buckets) {
    if (v.area > bestArea) {
      bestArea = v.area;
      bestKey = key;
    }
  }
  if (bestKey == null) return null;
  const bucket = buckets.get(bestKey)!;
  /* 桶内做圆形加权平均（区间窄，可视作线性平均 + 360 折叠） */
  let sumCos = 0;
  let sumSin = 0;
  let weightSum = 0;
  for (const s of bucket.samples) {
    const w = Math.max(s.area, 1e-6);
    const rad = (s.hsl.h * Math.PI) / 180;
    sumCos += Math.cos(rad) * w;
    sumSin += Math.sin(rad) * w;
    weightSum += w;
  }
  if (weightSum === 0) return bucket.samples[0].hsl.h;
  const meanRad = Math.atan2(sumSin / weightSum, sumCos / weightSum);
  let hue = (meanRad * 180) / Math.PI;
  if (hue < 0) hue += 360;
  return hue;
}
