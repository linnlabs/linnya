import type { RenderParagraph, RenderTextRun } from '../../renderModel';
import type { TextLayoutContract } from '../definitions/contract';
import type {
  RenderLineSlice,
  InlineBoxLineSlice,
  RenderInlineLineSlice,
  RenderTextLine,
  RunAdvanceProvider,
  TextLayoutResult,
} from '../definitions/types';
import { isRenderTextRun } from '../definitions/types';
import { resolveRunMeasureStyle } from './layoutParagraph';
import { segmentClusters } from './segmentClusters';

const ELLIPSIS = '…';
const OVERFLOW_EPSILON_INCHES = 1e-9;

export interface TextOverflowResolution {
  lines: RenderTextLine[];
  overflow: TextLayoutResult['overflow'];
  advanceSource: TextLayoutResult['advanceSource'];
}

/**
 * 把 ellipsis 作为共享布局结果的一部分确定下来。renderer 只绘制最终 slices，
 * 避免 Canvas/Konva 与 PPTX 各自做一套截断。
 */
export function applyEllipsisOverflow(
  lines: readonly RenderTextLine[],
  paragraphs: readonly RenderParagraph[],
  contract: TextLayoutContract,
  provider: RunAdvanceProvider,
  defaultFontFamily: string,
  fontScale: number,
): TextOverflowResolution {
  const usableWidth = Math.max(contract.box.w - contract.padding.left - contract.padding.right, 0.01);
  const usableHeight = contract.autoFitPolicy === 'resize-shape'
    ? Number.POSITIVE_INFINITY
    : Math.max(contract.box.h - contract.padding.top - contract.padding.bottom, 0);
  const visibleLineCount = resolveVisibleLineCount(lines, usableHeight);
  const vertical = visibleLineCount < lines.length;
  const horizontalLineIndexes = lines.flatMap((line, index) => (
    line.width > usableWidth + OVERFLOW_EPSILON_INCHES ? [index] : []
  ));
  const horizontal = horizontalLineIndexes.length > 0;
  const overflow: TextLayoutResult['overflow'] = {
    horizontal,
    vertical,
    hiddenLineCount: Math.max(lines.length - visibleLineCount, 0),
  };

  if (contract.overflow !== 'ellipsis' || (!horizontal && !vertical) || lines.length === 0) {
    return { lines: [...lines], overflow, advanceSource: 'harfbuzz' };
  }

  const keptCount = vertical ? Math.max(visibleLineCount, 1) : lines.length;
  const keptLines = lines.slice(0, keptCount).map(copyLine);
  const targets = new Set(horizontalLineIndexes.filter((index) => index < keptCount));
  if (vertical) {
    targets.add(keptCount - 1);
  }

  let advanceSource: TextLayoutResult['advanceSource'] = 'harfbuzz';
  for (const index of targets) {
    const line = keptLines[index];
    if (!line) continue;
    const result = ellipsizeLine(
      line,
      paragraphs[line.paragraphIndex],
      usableWidth,
      provider,
      defaultFontFamily,
      fontScale,
    );
    keptLines[index] = result.line;
    advanceSource = combineAdvanceSource(advanceSource, result.advanceSource);
  }

  return { lines: keptLines, overflow, advanceSource };
}

interface EllipsizeLineResult {
  line: RenderTextLine;
  advanceSource: TextLayoutResult['advanceSource'];
}

interface MeasuredCluster {
  paragraphIndex: number;
  runIndex: number;
  text: string;
  width: number;
  textY: number;
}

function ellipsizeLine(
  line: RenderTextLine,
  paragraph: RenderParagraph | undefined,
  usableWidth: number,
  provider: RunAdvanceProvider,
  defaultFontFamily: string,
  fontScale: number,
): EllipsizeLineResult {
  if (line.slices.some((slice) => slice.kind === 'inlineBox')) {
    return ellipsizeMixedLine(line, paragraph, usableWidth, provider, defaultFontFamily, fontScale);
  }
  const textSlices = line.slices.filter(
    (slice): slice is RenderLineSlice => slice.kind !== 'inlineBox' && slice.isBulletMarker !== true,
  );
  const bulletSlices = line.slices.filter(
    (slice): slice is RenderLineSlice => slice.kind !== 'inlineBox' && slice.isBulletMarker === true,
  ).map(copySlice);
  // slice.x 已经包含居中/右对齐偏移，不能把它误当作段落缩进再次参与对齐。
  const indent = Math.max(paragraph?.indent ?? 0, 0);
  const textWidth = Math.max(usableWidth - indent, 0.01);
  const clusters: MeasuredCluster[] = [];
  let advanceSource: TextLayoutResult['advanceSource'] = 'harfbuzz';

  for (const slice of textSlices) {
    const run = paragraph?.runs[slice.runIndex] ?? paragraph?.runs[0];
    if (!run || !isRenderTextRun(run)) continue;
    const segmented = segmentClusters(slice.text);
    const measured = provider.getClusterAdvances(
      segmented.map((cluster) => cluster.text),
      resolveRunMeasureStyle(run, defaultFontFamily, fontScale),
    );
    if (measured.advances.length !== segmented.length) {
      throw new Error(`RunAdvanceProvider returned ${measured.advances.length} advances for ${segmented.length} ellipsis clusters`);
    }
    advanceSource = combineAdvanceSource(advanceSource, measured.source);
    for (const [clusterIndex, cluster] of segmented.entries()) {
      clusters.push({
        paragraphIndex: slice.paragraphIndex,
        runIndex: slice.runIndex,
        text: cluster.text,
        width: measured.advances[clusterIndex] ?? 0,
        textY: slice.textY,
      });
    }
  }

  const ellipsisRunIndex = clusters[clusters.length - 1]?.runIndex ?? textSlices[0]?.runIndex ?? 0;
  const ellipsisRun = findTextRun(paragraph, ellipsisRunIndex);
  const measuredEllipsis = ellipsisRun
    ? provider.getClusterAdvances(
      [ELLIPSIS],
      resolveRunMeasureStyle(ellipsisRun, defaultFontFamily, fontScale),
    )
    : { advances: [0], source: 'heuristic' as const };
  advanceSource = combineAdvanceSource(advanceSource, measuredEllipsis.source);
  if (measuredEllipsis.advances.length !== 1) {
    throw new Error(`RunAdvanceProvider returned ${measuredEllipsis.advances.length} advances for ellipsis`);
  }
  const ellipsisWidth = measuredEllipsis.advances[0]!;

  let keptWidth = clusters.reduce((sum, cluster) => sum + cluster.width, 0);
  while (clusters.length > 0 && keptWidth + ellipsisWidth > textWidth + OVERFLOW_EPSILON_INCHES) {
    const removed = clusters.pop();
    keptWidth -= removed?.width ?? 0;
  }

  const finalRunIndex = clusters[clusters.length - 1]?.runIndex ?? ellipsisRunIndex;
  const finalTextY = clusters[clusters.length - 1]?.textY ?? textSlices[0]?.textY ?? line.y;
  clusters.push({
    paragraphIndex: line.paragraphIndex,
    runIndex: finalRunIndex,
    text: ELLIPSIS,
    width: ellipsisWidth,
    textY: finalTextY,
  });

  const totalWidth = clusters.reduce((sum, cluster) => sum + cluster.width, 0);
  const alignOffset = resolveAlignOffset(line.align, textWidth, totalWidth);
  let x = indent + alignOffset;
  const rebuiltSlices: RenderLineSlice[] = [];
  for (const cluster of clusters) {
    const previous = rebuiltSlices[rebuiltSlices.length - 1];
    if (previous && previous.runIndex === cluster.runIndex && previous.textY === cluster.textY) {
      previous.text += cluster.text;
      previous.width = roundInches(previous.width + cluster.width);
    } else {
      rebuiltSlices.push({
        paragraphIndex: cluster.paragraphIndex,
        runIndex: cluster.runIndex,
        text: cluster.text,
        x: roundInches(x),
        width: roundInches(cluster.width),
        textY: cluster.textY,
      });
    }
    x += cluster.width;
  }

  return {
    line: {
      ...line,
      slices: [...bulletSlices, ...rebuiltSlices],
      width: roundInches(indent + totalWidth),
    },
    advanceSource,
  };
}

type MixedEllipsisAtom =
  | { kind: 'text'; slice: RenderLineSlice; text: string; width: number }
  | { kind: 'inlineBox'; slice: InlineBoxLineSlice; width: number };

function ellipsizeMixedLine(
  line: RenderTextLine,
  paragraph: RenderParagraph | undefined,
  usableWidth: number,
  provider: RunAdvanceProvider,
  defaultFontFamily: string,
  fontScale: number,
): EllipsizeLineResult {
  const bulletSlices = line.slices.filter(
    (slice): slice is RenderLineSlice => slice.kind !== 'inlineBox' && slice.isBulletMarker === true,
  ).map(copySlice);
  const atoms: MixedEllipsisAtom[] = [];
  let advanceSource: TextLayoutResult['advanceSource'] = 'harfbuzz';
  for (const slice of line.slices) {
    if (slice.kind === 'inlineBox') {
      atoms.push({ kind: 'inlineBox', slice: copySlice(slice), width: slice.width });
      continue;
    }
    if (slice.isBulletMarker) continue;
    const run = findTextRun(paragraph, slice.runIndex);
    if (!run) continue;
    const clusters = segmentClusters(slice.text);
    const measured = provider.getClusterAdvances(
      clusters.map((cluster) => cluster.text),
      resolveRunMeasureStyle(run, defaultFontFamily, fontScale),
    );
    if (measured.advances.length !== clusters.length) {
      throw new Error(`RunAdvanceProvider returned ${measured.advances.length} advances for ${clusters.length} ellipsis clusters`);
    }
    advanceSource = combineAdvanceSource(advanceSource, measured.source);
    clusters.forEach((cluster, index) => atoms.push({
      kind: 'text',
      slice,
      text: cluster.text,
      width: measured.advances[index] ?? 0,
    }));
  }

  const ellipsisRun = [...(paragraph?.runs ?? [])].reverse().find(isRenderTextRun);
  if (!ellipsisRun) throw new Error('Inline formula ellipsis requires at least one text run.');
  const measuredEllipsis = provider.getClusterAdvances(
    [ELLIPSIS],
    resolveRunMeasureStyle(ellipsisRun, defaultFontFamily, fontScale),
  );
  if (measuredEllipsis.advances.length !== 1) {
    throw new Error(`RunAdvanceProvider returned ${measuredEllipsis.advances.length} advances for ellipsis`);
  }
  advanceSource = combineAdvanceSource(advanceSource, measuredEllipsis.source);
  const ellipsisWidth = measuredEllipsis.advances[0]!;
  let width = atoms.reduce((sum, atom) => sum + atom.width, 0);
  while (atoms.length > 0 && width + ellipsisWidth > usableWidth + OVERFLOW_EPSILON_INCHES) {
    width -= atoms.pop()?.width ?? 0;
  }

  const rebuilt: RenderInlineLineSlice[] = [];
  let x = resolveAlignOffset(line.align, usableWidth, width + ellipsisWidth);
  for (const atom of atoms) {
    if (atom.kind === 'inlineBox') {
      rebuilt.push({ ...atom.slice, x: roundInches(x) });
    } else {
      const previous = rebuilt[rebuilt.length - 1];
      if (previous && previous.kind !== 'inlineBox'
        && previous.runIndex === atom.slice.runIndex && previous.textY === atom.slice.textY) {
        previous.text += atom.text;
        previous.width = roundInches(previous.width + atom.width);
      } else {
        rebuilt.push({
          ...atom.slice,
          kind: 'text',
          text: atom.text,
          x: roundInches(x),
          width: roundInches(atom.width),
        });
      }
    }
    x += atom.width;
  }
  const finalTextSlice = [...rebuilt].reverse().find(
    (slice): slice is RenderLineSlice => slice.kind !== 'inlineBox',
  );
  rebuilt.push({
    kind: 'text',
    paragraphIndex: line.paragraphIndex,
    runIndex: finalTextSlice?.runIndex ?? paragraph?.runs.findIndex(isRenderTextRun) ?? 0,
    text: ELLIPSIS,
    x: roundInches(x),
    width: roundInches(ellipsisWidth),
    textY: finalTextSlice?.textY ?? line.y,
  });
  return {
    line: { ...line, slices: [...bulletSlices, ...rebuilt], width: roundInches(width + ellipsisWidth) },
    advanceSource,
  };
}

function findTextRun(
  paragraph: RenderParagraph | undefined,
  preferredIndex: number,
): RenderTextRun | undefined {
  const preferred = paragraph?.runs[preferredIndex];
  if (preferred && isRenderTextRun(preferred)) return preferred;
  return paragraph?.runs.find(isRenderTextRun);
}

function resolveVisibleLineCount(lines: readonly RenderTextLine[], usableHeight: number): number {
  let count = 0;
  for (const line of lines) {
    if (line.y + line.height <= usableHeight + OVERFLOW_EPSILON_INCHES) {
      count += 1;
    } else {
      break;
    }
  }
  return count;
}

function resolveAlignOffset(
  align: RenderTextLine['align'],
  usableWidth: number,
  lineWidth: number,
): number {
  if (align === 'center') return (usableWidth - lineWidth) / 2;
  if (align === 'right') return usableWidth - lineWidth;
  return 0;
}

function combineAdvanceSource(
  left: TextLayoutResult['advanceSource'],
  right: TextLayoutResult['advanceSource'],
): TextLayoutResult['advanceSource'] {
  if (left === 'heuristic' || right === 'heuristic') return 'heuristic';
  if (left === 'harfbuzz' || right === 'harfbuzz') return 'harfbuzz';
  return 'pretext';
}

function copyLine(line: RenderTextLine): RenderTextLine {
  return { ...line, slices: line.slices.map(copySlice) };
}

function copySlice<T extends RenderInlineLineSlice>(slice: T): T {
  return { ...slice };
}

function roundInches(value: number): number {
  return Number(value.toFixed(6));
}
