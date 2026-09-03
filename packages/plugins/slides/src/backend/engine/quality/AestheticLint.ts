/**
 * AestheticLint
 *
 * 扩展 LayoutLint，增加审美维度的检查：
 * - 文本密度
 * - 视觉层级
 * - 留白平衡
 * - 色彩一致性
 * - 页面重复检测
 *
 * 设计原则：
 * - 基于 PresentationInfo 运行，不依赖 DSL
 * - 每条规则独立，可单独启用/禁用
 * - 输出结构化 issue，可被自动修正回路消费
 *
 * **拆分约束**（详见 [`./aesthetic/README.md`](./aesthetic/README.md)）：
 * - 类型 / 阈值：`./aesthetic/{types,thresholds}.ts`
 * - 通用 lint 规则（纯函数）：`./aesthetic/lintRules.ts`
 * - 图表可读性规则（纯函数）：`./aesthetic/chartReadability.ts`
 * - 色彩采样 / 主色：`./aesthetic/colorSampling.ts`
 * - 元素小工具：`./aesthetic/elementUtils.ts`
 * - 重复检测：`./aesthetic/repetition.ts`
 * - 指标：`./aesthetic/metrics.ts`
 *
 * 主类只做编排：page-level 规则在 slide loop 里依次调，
 * deck-level 规则跨 slide 累计后调，最后合并可复算 metrics。
 * 新增 page-level 规则只需在 `aesthetic/lintRules.ts` 加一个 export function，
 * 在下面 `lint()` 的 slide-loop 里挂上即可——主类不再增长。
 */

import {
  flattenSlideElements,
  type PresentationInfo,
} from '@plugin/slides/shared';
import { LayoutLint } from './LayoutLint.js';
import { pickPrimaryHue, samplePageChromaticColors } from './aesthetic/colorSampling.js';
import { lintChartReadability } from './aesthetic/chartReadability.js';
import {
  lintEdgeMargins,
  lintElementCount,
  lintFontFamilyConsistency,
  lintFontFamilySubstitution,
  lintFontStyleSubstitution,
  lintFontSizeFloor,
  lintFontSizeTiers,
  lintHierarchy,
  lintImageAspect,
  lintPaletteDiversity,
  lintPrimaryHueDrift,
  lintTextContrast,
  lintTextDensity,
  lintVisualAnchor,
  lintWhitespace,
} from './aesthetic/lintRules.js';
import { analyzeSlideRepetition } from './aesthetic/repetition.js';
import { computeMetrics } from './aesthetic/metrics.js';
import type {
  AestheticLintIssue,
  AestheticLintReport,
} from './aesthetic/types.js';

export type {
  AestheticLintCode,
  AestheticLintIssue,
  AestheticLintMetrics,
  AestheticLintReport,
  SlideRepetitionPair,
} from './aesthetic/types.js';

export class AestheticLint {
  private readonly layoutLint = new LayoutLint();

  lint(info: PresentationInfo): AestheticLintReport {
    const layout = this.layoutLint.lint(info);
    const aesthetic: AestheticLintIssue[] = [];

    /** 跨页主色累积，供 lintPrimaryHueDrift 使用 */
    const slidePrimaryHues: Array<{ slideNumber: number; hue: number }> = [];

    for (const slide of info.slides) {
      const positioned = flattenSlideElements(slide.elements).filter((e) => e.position);
      aesthetic.push(...lintTextDensity(slide.number, info.slideSize, positioned));
      aesthetic.push(...lintHierarchy(slide.number, positioned));
      aesthetic.push(...lintWhitespace(slide.number, info.slideSize, positioned));
      aesthetic.push(...lintElementCount(slide.number, positioned));
      aesthetic.push(...lintVisualAnchor(slide.number, info.slideSize, positioned));
      /* P1 Tier-1：纯数值、零语义依赖 */
      aesthetic.push(...lintFontSizeFloor(slide.number, positioned));
      aesthetic.push(...lintFontSizeTiers(slide.number, positioned));
      aesthetic.push(...lintEdgeMargins(slide.number, info.slideSize, positioned));
      /* P1 Tier-1：颜色 / fit 通道 */
      const sampled = samplePageChromaticColors(positioned);
      aesthetic.push(...lintPaletteDiversity(slide.number, sampled));
      aesthetic.push(...lintTextContrast(slide.number, positioned));
      aesthetic.push(...lintImageAspect(slide.number, positioned));
      aesthetic.push(...lintChartReadability(slide.number, positioned));
      const primary = pickPrimaryHue(sampled);
      if (primary != null) {
        slidePrimaryHues.push({ slideNumber: slide.number, hue: primary });
      }
    }

    aesthetic.push(...lintFontFamilyConsistency(info));
    aesthetic.push(...lintFontFamilySubstitution(info));
    aesthetic.push(...lintFontStyleSubstitution(info));
    aesthetic.push(...lintPrimaryHueDrift(slidePrimaryHues));
    const repetition = analyzeSlideRepetition(info);
    aesthetic.push(...repetition.issues);

    const metrics = computeMetrics(layout, aesthetic, repetition.pairs);
    return { layout, aesthetic, metrics };
  }
}
