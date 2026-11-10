import type { TextItem } from '../types';

const LINE_TOLERANCE_RATIO = 0.5;
const MIN_LINE_TOLERANCE = 2;
const WORD_GAP_RATIO = 0.15;

function lineTolerance(item: TextItem): number {
  return Math.max(MIN_LINE_TOLERANCE, Math.abs(item.height) * LINE_TOLERANCE_RATIO);
}

/**
 * 把同一栏的 PDF.js 文本项按坐标排成行。
 *
 * 知识库分块只需要一段连续文本，所以旧实现用空格把整页连成一行；给 Agent 读的页面需要保留
 * 换行，并且不能在中日文字之间插入空格。行内只有视觉上确有间隙时才补空格。
 */
export function assembleColumnLines(items: readonly TextItem[]): string {
  const sorted = [...items]
    .filter(item => item.str.length > 0)
    .sort((a, b) => {
      const yDiff = b.transform[5] - a.transform[5];
      if (Math.abs(yDiff) > Math.min(lineTolerance(a), lineTolerance(b))) return yDiff;
      return a.transform[4] - b.transform[4];
    });

  const lines: string[] = [];
  let current = '';
  let previous: TextItem | undefined;
  for (const item of sorted) {
    if (previous && Math.abs(previous.transform[5] - item.transform[5]) > lineTolerance(previous)) {
      lines.push(current.trimEnd());
      current = '';
      previous = undefined;
    }
    if (previous) {
      const gap = item.transform[4] - (previous.transform[4] + previous.width);
      const needsSpace = gap > Math.abs(previous.height) * WORD_GAP_RATIO
        && !/\s$/u.test(current)
        && !/^\s/u.test(item.str);
      if (needsSpace) current += ' ';
    }
    current += item.str;
    previous = item;
  }
  if (current.trim()) lines.push(current.trimEnd());
  return lines.filter(line => line.trim().length > 0).join('\n');
}

/** 多栏页逐栏成行，栏之间空一行，保持从左到右的阅读顺序。 */
export function assembleColumnsText(columns: readonly (readonly TextItem[])[]): string {
  return columns
    .map(column => assembleColumnLines(column))
    .filter(text => text.length > 0)
    .join('\n\n');
}
