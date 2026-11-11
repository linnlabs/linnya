/**
 * 根据子 Agent 对同一来源的全部 web_read 回执，说明它实际读到了哪些部分。
 * 只陈述回执里的事实（字符区间、PDF 页、查找词），不推断没读的部分写了什么。
 */

import type { WebReadResult } from '@app/schemas';

type WebReadData = WebReadResult['data'];

/** gap=1 用于页码闭区间（3-4 与 5-8 相邻），字符半开区间用 gap=0。 */
function mergeRanges(ranges: readonly (readonly [number, number])[], gap = 0): [number, number][] {
  const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const [from, to] of sorted) {
    const last = merged[merged.length - 1];
    if (last && from <= last[1] + gap) last[1] = Math.max(last[1], to);
    else merged.push([from, to]);
  }
  return merged;
}

const span = (from: number, to: number) => (from === to ? String(from) : `${from}-${to}`);
const quote = (values: readonly string[]) => values.map(value => JSON.stringify(value)).join(', ');

export interface AcquiredRange {
  readonly description: string;
  /** 读到的正文不完整（只读了部分、快照截断、PDF 页未读完或文件未解析）。只有搜索摘要时为 false。 */
  readonly partial: boolean;
}

export function describeAcquiredRange(reads: readonly WebReadData[]): AcquiredRange {
  if (reads.length === 0) return { description: 'Search result snippet only; the page was not read.', partial: false };
  const pdfReads = reads.filter(read => read.pdf);
  if (pdfReads.length > 0) {
    const pageCount = pdfReads[0]!.pdf!.page_count;
    const pages = mergeRanges(
      pdfReads.filter(read => !read.find).map(read => [read.pdf!.pages.from, read.pdf!.pages.to] as const),
      1,
    );
    const readPages = pages.reduce((sum, [from, to]) => sum + (to - from + 1), 0);
    const searched = [...new Set(pdfReads.flatMap(read => (read.find ? [read.find.query] : [])))];
    const noText = [...new Set(pdfReads.flatMap(read => read.pdf!.pages_without_text))].sort((a, b) => a - b);
    return {
      description: [
        pages.length
          ? `PDF ${readPages === 1 ? 'page' : 'pages'} ${pages.map(([from, to]) => span(from, to)).join(', ')} of ${pageCount} read.`
          : `PDF of ${pageCount} pages; no page text read.`,
        ...(searched.length ? [`Searched for ${quote(searched)}.`] : []),
        ...(noText.length ? [`No text layer on ${noText.length === 1 ? 'page' : 'pages'} ${noText.join(', ')}.`] : []),
      ].join(' '),
      partial: readPages < pageCount || noText.length > 0,
    };
  }
  if (reads.every(read => read.file && read.extractor === 'file_download')) {
    return { description: `Original ${reads[0]!.file!.format.toUpperCase()} file saved; its contents were not read here.`, partial: true };
  }
  const windows = reads.filter(read => read.window);
  const searched = [...new Set(reads.flatMap(read => (read.find ? [read.find.query] : [])))];
  if (windows.length === 0 && reads.every(read => read.find)) {
    return { description: `Only searched within the page for ${quote(searched)}; matching passages seen, the page itself not read.`, partial: true };
  }
  if (windows.length === 0) {
    // 旧回执没有 window：整次返回即从开头读起的正文。
    const truncated = reads.filter(read => !read.find).every(read => read.truncated);
    return {
      description: [
        truncated ? 'Read from the start; the returned text was cut off before the end.' : 'Read in full.',
        ...(searched.length ? [`Searched for ${quote(searched)}.`] : []),
      ].join(' '),
      partial: truncated,
    };
  }
  const total = Math.max(...windows.map(read => read.window!.total_chars));
  const ranges = mergeRanges(windows.map(read => [read.window!.offset, read.window!.end] as const));
  const readChars = ranges.reduce((sum, [from, to]) => sum + (to - from), 0);
  const snapshotCut = windows.some(read => read.window!.capture_truncated);
  const whole = ranges.length === 1 && ranges[0]![0] === 0 && ranges[0]![1] >= total;
  return {
    description: [
      whole
        ? `Read in full (${total} characters).`
        : `Read characters ${ranges.map(([from, to]) => `${from}-${to}`).join(', ')} of ${total} (${Math.round((100 * readChars) / Math.max(1, total))}%).`,
      ...(searched.length ? [`Searched for ${quote(searched)}.`] : []),
      ...(snapshotCut ? ['The saved text stops at its size limit; the page continues beyond it.'] : []),
    ].join(' '),
    partial: !whole || snapshotCut,
  };
}
