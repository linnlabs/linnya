/**
 * AestheticLint 页面重复检测
 *
 * 单一职责：把 deck 跨相邻页比较，输出
 * - `slide_repetition` issues
 * - 与之配套的 `SlideRepetitionPair[]` 指标（供 metrics / scoring 二次消费）
 *
 * 设计要点：
 * - **结构指纹**（`slideFingerprint`）：把每个元素抽成 `type:role:zone:size:span` 五元组 token；
 *   token 排序后用 `|` join，得到与"绘制顺序无关、与精确坐标无关"的稳定指纹。
 * - **文本摘要**（`slideTextDigest`）：仅取所有文本元素 trim 后排序拼接，
 *   用来判断"页面长得像但写的字不同"vs"页面真的复制粘贴"。
 * - 严重度策略：结构 > 0.98 且内容 > 0.8 → warning（真正复制页）；
 *   否则 → info（同模板不同内容，咨询风正常）。
 */

import {
  flattenSlideElements,
  type PresentationInfo,
  type SlideElementInfo,
} from '@plugin/slides/shared';
import { r3 } from './elementUtils.js';
import { SIMILARITY_THRESHOLD } from './thresholds.js';
import type { AestheticLintIssue, SlideRepetitionPair } from './types.js';

export interface SlideRepetitionResult {
  issues: AestheticLintIssue[];
  pairs: SlideRepetitionPair[];
}

interface SlideEntry {
  slideNumber: number;
  fp: string;
  textDigest: string;
}

export function analyzeSlideRepetition(info: PresentationInfo): SlideRepetitionResult {
  const issues: AestheticLintIssue[] = [];
  const pairs: SlideRepetitionPair[] = [];
  if (info.slides.length < 2) return { issues, pairs };

  const entries: SlideEntry[] = [];

  for (const slide of info.slides) {
    const flattened = flattenSlideElements(slide.elements);
    const fp = slideFingerprint(flattened);
    const textDigest = slideTextDigest(flattened);
    entries.push({ slideNumber: slide.number, fp, textDigest });
  }

  for (let i = 1; i < entries.length; i++) {
    const prev = entries[i - 1];
    const curr = entries[i];
    // 空页面跳过
    if (prev.fp === 'empty' || curr.fp === 'empty') continue;

    const structureSim = stringSimilarity(prev.fp, curr.fp);
    if (structureSim <= SIMILARITY_THRESHOLD) continue;

    const contentSim = stringSimilarity(prev.textDigest, curr.textDigest);

    pairs.push({
      previousSlideNumber: prev.slideNumber,
      slideNumber: curr.slideNumber,
      similarity: r3(structureSim),
    });

    /**
     * 严重度判定逻辑：
     * - 结构 + 内容都高度一致 → warning（真正的重复页，需要修复）
     * - 结构相似但内容不同 → info（同模板不同内容，正常的咨询风格）
     */
    const isContentDuplicate = contentSim > 0.8;
    const severity = (structureSim > 0.98 && isContentDuplicate) ? 'warning' : 'info';
    issues.push({
      code: 'slide_repetition',
      severity,
      confidence: severity === 'warning' ? 'medium' : 'low',
      slides: [prev.slideNumber, curr.slideNumber],
      evidence: {
        kind: 'slide_similarity',
        previousSlideNumber: prev.slideNumber,
        currentSlideNumber: curr.slideNumber,
        structureSimilarity: structureSim,
        contentSimilarity: contentSim,
        structureThreshold: SIMILARITY_THRESHOLD,
        contentThreshold: 0.8,
      },
    });
  }

  return { issues, pairs };
}

/**
 * 提取页面所有文本元素的内容摘要，用于判断内容是否实质重复。
 * 不关注位置，只关注文字。
 */
function slideTextDigest(elements: SlideElementInfo[]): string {
  const texts = elements
    .filter((e) => e.type === 'text' && e.text)
    .map((e) => e.text!.trim())
    .filter((t) => t.length > 0);
  if (texts.length === 0) return '';
  return texts.sort().join('|');
}

function slideFingerprint(elements: SlideElementInfo[]): string {
  const positioned = elements.filter((e) => e.position);
  if (positioned.length === 0) return 'empty';

  const tokens = positioned.flatMap((element) => {
    const p = element.position!;
    const zone = quantizeZone(p);
    const size = quantizeSize(p.w * p.h);
    const width = quantizeSpan(p.w);
    const height = quantizeSpan(p.h);
    const anchor = inferAnchorRole(element);
    return [
      `type:${element.type}`,
      `role:${anchor}`,
      `zone:${element.type}:${zone}`,
      `size:${element.type}:${size}`,
      `span:${element.type}:${width}x${height}`,
    ];
  });

  tokens.push(`count:${quantizeElementCount(positioned.length)}`);
  return tokens.sort().join('|');
}

/** Jaccard 相似度（按 `|` token 集合），0=不相似，1=完全相同。 */
function stringSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length === 0 || b.length === 0) return 0;

  const partsA = a.split('|');
  const partsB = b.split('|');
  const setA = new Set(partsA);
  const setB = new Set(partsB);

  let intersection = 0;
  for (const part of setA) {
    if (setB.has(part)) intersection++;
  }

  const union = setA.size + setB.size - intersection;
  return union > 0 ? intersection / union : 0;
}

function quantizeZone(position: NonNullable<SlideElementInfo['position']>): string {
  const cx = position.x + position.w / 2;
  const cy = position.y + position.h / 2;
  const col = cx < 3.33 ? 'l' : cx < 6.66 ? 'c' : 'r';
  const row = cy < 1.875 ? 't' : cy < 3.75 ? 'm' : 'b';
  return `${row}${col}`;
}

function quantizeSize(area: number): string {
  if (area >= 18) return 'xl';
  if (area >= 8) return 'lg';
  if (area >= 3) return 'md';
  return 'sm';
}

function quantizeSpan(span: number): string {
  if (span >= 7) return 'xl';
  if (span >= 4) return 'lg';
  if (span >= 2) return 'md';
  return 'sm';
}

function quantizeElementCount(count: number): string {
  if (count >= 10) return 'dense';
  if (count >= 6) return 'medium';
  if (count >= 3) return 'light';
  return 'minimal';
}

/**
 * 按元素类型分类，不做位置启发式的语义猜测。
 * chart/image/table 归为 visual，其余直接用 type。
 */
function inferAnchorRole(element: SlideElementInfo): string {
  if (element.type === 'chart' || element.type === 'image' || element.type === 'table') return 'visual';
  return element.type;
}

/**
 * 在 `repetitionPairs` 序列中找最长"连续相邻重复链"长度。
 *
 * 例如 pairs = [(1,2), (2,3), (4,5)] → 链长 [3, 2] → 最长 = 3。
 * 没有任何 pair → 1（单页就算"运行长度 1"）。
 */
export function computeLongestRun(repetitionPairs: SlideRepetitionPair[]): number {
  if (repetitionPairs.length === 0) return 1;

  let longest = 2;
  let current = 2;
  for (let i = 1; i < repetitionPairs.length; i++) {
    const prev = repetitionPairs[i - 1];
    const curr = repetitionPairs[i];
    if (curr.previousSlideNumber === prev.slideNumber) {
      current += 1;
    } else {
      current = 2;
    }
    longest = Math.max(longest, current);
  }
  return longest;
}
