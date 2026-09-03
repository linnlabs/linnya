/**
 * InspectSnapshot
 *
 * 将 PresentationInfo 规范化为稳定的、可 diff 的格式。
 * 用于 golden fixture 回归测试：同一 DeckSpec 两次生成后 inspect 结果应一致。
 */

import {
  flattenSlideElements,
  type PresentationInfo,
  type SlideElementInfo,
  type SlideInfo,
} from '@plugin/slides/shared';

// ─── 输出类型 ──────────────────────────────────────────────────────────────

export interface NormalizedSnapshot {
  slideCount: number;
  slideSize: { width: number; height: number };
  slides: NormalizedSlide[];
  theme: {
    colors: Record<string, string>;
    fonts: { major: string; minor: string };
    chart?: { palette: [string, ...string[]] };
  };
  masterCount: number;
}

interface NormalizedSlide {
  number: number;
  layoutName?: string;
  elements: NormalizedElement[];
}

interface NormalizedElement {
  type: string;
  text?: string;
  position?: { x: number; y: number; w: number; h: number };
  chartType?: string;
}

export interface SnapshotDiff {
  equal: boolean;
  differences: SnapshotDifference[];
}

export interface SnapshotDifference {
  path: string;
  expected: unknown;
  actual: unknown;
}

// ─── 规范化 ────────────────────────────────────────────────────────────────

/**
 * 将 PresentationInfo 规范化为稳定的 NormalizedSnapshot。
 *
 * 规范化规则：
 * - slide 按 number 排序
 * - 元素按 position (y, x) 排序，消除 XML 遍历顺序不稳定性
 * - 移除 creationId / name 等每次生成都不同的字段
 * - 数值保留 3 位小数
 */
export function normalizeInspectSnapshot(info: PresentationInfo): NormalizedSnapshot {
  const slides = [...info.slides]
    .sort((a, b) => a.number - b.number)
    .map((slide) => normalizeSlide(slide));

  return {
    slideCount: info.slideCount,
    slideSize: {
      width: round3(info.slideSize.width),
      height: round3(info.slideSize.height),
    },
    slides,
    theme: {
      colors: { ...info.theme.colors },
      fonts: { ...info.theme.fonts },
      chart: info.theme.chart
        ? { palette: [info.theme.chart.palette[0], ...info.theme.chart.palette.slice(1)] }
        : undefined,
    },
    masterCount: info.masters.length,
  };
}

/** 序列化为稳定 JSON 字符串 */
export function serializeSnapshot(snapshot: NormalizedSnapshot): string {
  return JSON.stringify(snapshot, null, 2);
}

/** 从 PresentationInfo 直接生成稳定 JSON */
export function toSnapshotString(info: PresentationInfo): string {
  return serializeSnapshot(normalizeInspectSnapshot(info));
}

// ─── Diff ──────────────────────────────────────────────────────────────────

/** 对比两个序列化后的 snapshot，返回结构化 diff */
export function diffSnapshots(expectedJson: string, actualJson: string): SnapshotDiff {
  const expected = JSON.parse(expectedJson) as NormalizedSnapshot;
  const actual = JSON.parse(actualJson) as NormalizedSnapshot;
  const differences: SnapshotDifference[] = [];

  deepDiff(expected, actual, '', differences);

  return { equal: differences.length === 0, differences };
}

// ─── 内部辅助 ──────────────────────────────────────────────────────────────

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function normalizeSlide(slide: SlideInfo): NormalizedSlide {
  const elements = flattenSlideElements(slide.elements)
    .map(normalizeElement)
    .sort(compareElementPosition);

  const result: NormalizedSlide = {
    number: slide.number,
    elements,
  };
  if (slide.layoutName) {
    result.layoutName = slide.layoutName;
  }
  return result;
}

function normalizeElement(el: SlideElementInfo): NormalizedElement {
  const result: NormalizedElement = { type: el.type };

  if (el.text) {
    result.text = el.text;
  }
  if (el.position) {
    result.position = {
      x: round3(el.position.x),
      y: round3(el.position.y),
      w: round3(el.position.w),
      h: round3(el.position.h),
    };
  }
  if (el.chartType) {
    result.chartType = el.chartType;
  }
  return result;
}

function compareElementPosition(a: NormalizedElement, b: NormalizedElement): number {
  const ay = a.position?.y ?? 0;
  const by = b.position?.y ?? 0;
  if (ay !== by) return ay - by;
  const ax = a.position?.x ?? 0;
  const bx = b.position?.x ?? 0;
  return ax - bx;
}

function deepDiff(
  expected: unknown,
  actual: unknown,
  path: string,
  out: SnapshotDifference[],
): void {
  if (expected === actual) return;

  if (typeof expected !== typeof actual) {
    out.push({ path: path || '(root)', expected, actual });
    return;
  }

  if (Array.isArray(expected) && Array.isArray(actual)) {
    const maxLen = Math.max(expected.length, actual.length);
    for (let i = 0; i < maxLen; i++) {
      const childPath = `${path}[${i}]`;
      if (i >= expected.length) {
        out.push({ path: childPath, expected: undefined, actual: actual[i] });
      } else if (i >= actual.length) {
        out.push({ path: childPath, expected: expected[i], actual: undefined });
      } else {
        deepDiff(expected[i], actual[i], childPath, out);
      }
    }
    return;
  }

  if (expected !== null && actual !== null && typeof expected === 'object' && typeof actual === 'object') {
    const allKeys = new Set([
      ...Object.keys(expected as Record<string, unknown>),
      ...Object.keys(actual as Record<string, unknown>),
    ]);
    for (const key of allKeys) {
      const childPath = path ? `${path}.${key}` : key;
      deepDiff(
        (expected as Record<string, unknown>)[key],
        (actual as Record<string, unknown>)[key],
        childPath,
        out,
      );
    }
    return;
  }

  // 基本类型不等
  if (expected !== actual) {
    out.push({ path: path || '(root)', expected, actual });
  }
}
