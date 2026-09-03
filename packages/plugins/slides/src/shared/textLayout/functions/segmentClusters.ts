import {
  isKinsokuLineEndForbidden,
  isKinsokuLineStartForbidden,
} from '../definitions/kinsokuChars';

export interface TextCluster {
  text: string;
  /** 是否允许在该 cluster 之后断行（M3 kinsoku 会在此基础上过滤）。 */
  breakAfter: boolean;
  /** char-wrap 也要遵守避头尾，因此需要与 word break opportunity 分开表达。 */
  forbidBreakAfter: boolean;
  isWhitespace: boolean;
  /** OOXML a:br / run 内换行，宽度为 0 且必须立即结束当前行。 */
  isForcedBreak: boolean;
}

declare global {
  namespace Intl {
    class Segmenter {
      constructor(locales?: string | string[], options?: { granularity?: 'grapheme' | 'word' | 'sentence' });
      segment(input: string): Iterable<{ segment: string }>;
    }
  }
}

const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

export function segmentClusters(text: string): TextCluster[] {
  const clusters = [...graphemeSegmenter.segment(text)].map((entry) => entry.segment);
  const segmented = clusters.map((cluster, index) => {
    const isWhitespace = /^\s+$/u.test(cluster);
    return {
      text: cluster,
      isWhitespace,
      isForcedBreak: cluster === '\n' || cluster === '\r\n',
      forbidBreakAfter: false,
      breakAfter: isWhitespace
        || isCjk(cluster)
        || cluster === '-'
        || (index + 1 < clusters.length && isCjk(clusters[index + 1] ?? '')),
    };
  });
  return applyKinsokuBreakFilters(segmented);
}

function applyKinsokuBreakFilters(clusters: TextCluster[]): TextCluster[] {
  return clusters.map((cluster, index) => {
    const forbidsLineEnd = isKinsokuLineEndForbidden(cluster.text);
    const next = clusters[index + 1];
    const nextForbidsLineStart = next ? isKinsokuLineStartForbidden(next.text) : false;
    const forbidBreakAfter = forbidsLineEnd || nextForbidsLineStart;
    return {
      ...cluster,
      forbidBreakAfter,
      breakAfter: forbidBreakAfter ? false : cluster.breakAfter,
    };
  });
}

function isCjk(cluster: string): boolean {
  const codePoint = cluster.codePointAt(0);
  if (codePoint == null) return false;
  return (codePoint >= 0x2E80 && codePoint <= 0x9FFF)
    || (codePoint >= 0x3040 && codePoint <= 0x30FF)
    || (codePoint >= 0xAC00 && codePoint <= 0xD7AF)
    || (codePoint >= 0xF900 && codePoint <= 0xFAFF)
    || (codePoint >= 0xFF00 && codePoint <= 0xFFEF);
}
