import type { RenderParagraph } from '../../renderModel';
import { MathFormulaError } from '../../mathFormula';
import type { InlineBoxLineSlice, RunAdvanceProvider, TextLayoutResult, TextRunStyleResolver } from '../definitions/types';
import { isRenderTextRun } from '../definitions/types';
import { combineTextLayoutAdvanceSources } from './advanceSource';
import { segmentClusters, type TextCluster } from './segmentClusters';

const WIDTH_EPSILON_INCHES = 1e-9;

interface FlatTextAtom extends TextCluster {
  kind: 'text';
  paragraphIndex: number;
  runIndex: number;
  advance: number;
  advanceSource: TextLayoutResult['advanceSource'];
}

interface FlatInlineBoxAtom {
  kind: 'inlineBox';
  paragraphIndex: number;
  runIndex: number;
  advance: number;
  identity: string;
  projection: InlineBoxLineSlice['projection'];
  isForcedBreak: false;
  isWhitespace: false;
  breakAfter: false;
  forbidBreakAfter: false;
  advanceSource: 'pretext';
}

type FlatAtom = FlatTextAtom | FlatInlineBoxAtom;

export interface BrokenLine {
  slices: BrokenLineInlineSlice[];
  width: number;
  advanceSource: TextLayoutResult['advanceSource'];
}

export interface BrokenLineSlice {
  kind?: 'text';
  paragraphIndex: number;
  runIndex: number;
  text: string;
  x: number;
  width: number;
  isBulletMarker?: boolean;
}

export type BrokenLineInlineSlice = BrokenLineSlice | Omit<InlineBoxLineSlice, 'boxY' | 'height'>;

export function breakParagraphIntoLines(
  paragraph: RenderParagraph,
  usableWidthInches: number,
  wrap: 'word' | 'char' | 'none',
  provider: RunAdvanceProvider,
  resolveRunStyle: TextRunStyleResolver,
  paragraphIndex = 0,
  fontScale = 1,
): BrokenLine[] {
  const flat = flattenParagraph(paragraph, paragraphIndex, provider, resolveRunStyle, fontScale);
  if (flat.some((atom) => atom.kind === 'inlineBox' && atom.advance > usableWidthInches)) {
    throw new MathFormulaError(
      'slides.formula.inline_formula_too_wide',
      'Inline formula is wider than the available text line.',
    );
  }
  if (flat.length === 0) return [toLine(flat)];
  if (wrap === 'none') return splitAtForcedBreaks(flat).map(toLine);

  const lines: FlatAtom[][] = [];
  let lineStart = 0;
  let widthSoFar = 0;
  let lastBreak = -1;

  for (let index = lineStart; index < flat.length; index += 1) {
    const atom = flat[index]!;
    if (atom.isForcedBreak) {
      lines.push(flat.slice(lineStart, index));
      lineStart = index + 1;
      widthSoFar = 0;
      lastBreak = -1;
      continue;
    }
    const overflows = widthSoFar + atom.advance > usableWidthInches + WIDTH_EPSILON_INCHES
      && !atom.isWhitespace;
    if (overflows && index > lineStart) {
      const breakAt = lastBreak >= lineStart ? lastBreak + 1 : index;
      lines.push(flat.slice(lineStart, breakAt));
      lineStart = breakAt;
      widthSoFar = 0;
      lastBreak = -1;
      index = breakAt - 1;
      continue;
    }
    widthSoFar += atom.advance;
    if ((wrap === 'char' && !atom.forbidBreakAfter) || atom.breakAfter) lastBreak = index;
  }
  lines.push(flat.slice(lineStart));
  return lines.map(toLine);
}

function splitAtForcedBreaks(atoms: readonly FlatAtom[]): FlatAtom[][] {
  const lines: FlatAtom[][] = [[]];
  for (const atom of atoms) {
    if (atom.isForcedBreak) lines.push([]);
    else lines[lines.length - 1]?.push(atom);
  }
  return lines;
}

function flattenParagraph(
  paragraph: RenderParagraph,
  paragraphIndex: number,
  provider: RunAdvanceProvider,
  resolveRunStyle: TextRunStyleResolver,
  fontScale: number,
): FlatAtom[] {
  return paragraph.runs.flatMap((run, runIndex): FlatAtom[] => {
    if (!isRenderTextRun(run)) {
      return [{
        kind: 'inlineBox',
        paragraphIndex,
        runIndex,
        advance: run.projection.metrics.advanceWidth * fontScale,
        identity: `formula:${run.projection.contentHash}`,
        projection: run.projection,
        isForcedBreak: false,
        isWhitespace: false,
        breakAfter: false,
        forbidBreakAfter: false,
        advanceSource: 'pretext',
      }];
    }
    const clusters = segmentClusters(run.text);
    const measuredClusters = clusters.filter((cluster) => !cluster.isForcedBreak);
    const clusterTexts = measuredClusters.map((cluster) => cluster.text);
    if (clusterTexts.length === 0) {
      return clusters.map((cluster) => ({
        ...cluster,
        kind: 'text',
        paragraphIndex,
        runIndex,
        advance: 0,
        advanceSource: 'pretext',
      }));
    }
    const measurement = provider.getClusterAdvances(clusterTexts, resolveRunStyle(run));
    if (measurement.advances.length !== clusters.length) {
      throw new Error(`RunAdvanceProvider returned ${measurement.advances.length} advances for ${clusters.length} clusters`);
    }
    let measuredIndex = 0;
    return clusters.map((cluster) => ({
      ...cluster,
      kind: 'text',
      paragraphIndex,
      runIndex,
      advance: cluster.isForcedBreak ? 0 : measurement.advances[measuredIndex++]!,
      advanceSource: measurement.source,
    }));
  });
}

function toLine(atoms: readonly FlatAtom[]): BrokenLine {
  const slices: BrokenLineInlineSlice[] = [];
  let x = 0;
  for (const atom of atoms) {
    if (atom.isForcedBreak) continue;
    if (atom.kind === 'inlineBox') {
      slices.push({
        kind: 'inlineBox',
        paragraphIndex: atom.paragraphIndex,
        runIndex: atom.runIndex,
        identity: atom.identity,
        projection: atom.projection,
        x,
        width: atom.advance,
      });
      x += atom.advance;
      continue;
    }
    const previous = slices[slices.length - 1];
    if (previous && previous.kind !== 'inlineBox' && previous.runIndex === atom.runIndex && !previous.isBulletMarker) {
      previous.text += atom.text;
      previous.width = roundInches(previous.width + atom.advance);
    } else {
      slices.push({
        kind: 'text',
        paragraphIndex: atom.paragraphIndex,
        runIndex: atom.runIndex,
        text: atom.text,
        x,
        width: atom.advance,
      });
    }
    x += atom.advance;
  }
  return {
    slices,
    width: roundInches(trimTrailingWhitespaceWidth(atoms)),
    advanceSource: combineTextLayoutAdvanceSources(atoms.map((atom) => atom.advanceSource)),
  };
}

function trimTrailingWhitespaceWidth(atoms: readonly FlatAtom[]): number {
  let end = atoms.length;
  while (end > 0 && atoms[end - 1]?.isWhitespace === true) end -= 1;
  return atoms.slice(0, end).reduce((sum, atom) => sum + atom.advance, 0);
}

function roundInches(value: number): number {
  return Number(value.toFixed(6));
}
