import type {
  RenderPadding,
  RenderParagraph,
  SlideRenderModel,
  TextRenderNode,
} from '../../renderModel';
import {
  TABLE_DEFAULT_CELL_PADDING,
  resolveTableCellLayouts,
  visitRenderNodes,
} from '../../renderModel';
import type {
  SlideTextLayoutProvenance,
  TextLayoutAttentionNodeProvenance,
  TextLayoutFontProvenance,
} from '../definitions/provenance';
import type { TextLayoutResult } from '../definitions/types';

interface TextLayoutProvenanceInput {
  readonly nodeId: string;
  readonly boxWidthInches: number;
  readonly padding?: RenderPadding;
  readonly paragraphs: readonly RenderParagraph[];
  readonly layout?: TextLayoutResult;
}

export function summarizeSlideTextLayoutProvenance(
  slide: SlideRenderModel,
): SlideTextLayoutProvenance {
  const inputs = collectTextLayoutInputs(slide);
  const advanceSourceCounts: Record<TextLayoutResult['advanceSource'], number> = {
    harfbuzz: 0,
    pretext: 0,
    heuristic: 0,
  };
  const fontIdentities = new Map<string, TextLayoutFontProvenance>();
  const attentionNodes: TextLayoutAttentionNodeProvenance[] = [];
  let overflowNodeCount = 0;
  let unresolvedFontRunCount = 0;
  let fontFamilySubstitutionRunCount = 0;
  let fontStyleMismatchRunCount = 0;

  for (const input of inputs) {
    const layout = input.layout;
    if (layout == null) {
      continue;
    }
    advanceSourceCounts[layout.advanceSource] += 1;
    if (layout.overflow.horizontal || layout.overflow.vertical) {
      overflowNodeCount += 1;
    }

    const nodeFontIdentities = new Map<string, TextLayoutFontProvenance>();
    let maxLetterSpacingPt = 0;
    let hasUnresolvedFont = false;
    let hasFontFamilySubstitution = false;
    let hasFontStyleMismatch = false;
    for (const paragraph of input.paragraphs) {
      for (const run of paragraph.runs) {
        if (!('text' in run)) continue;
        maxLetterSpacingPt = Math.max(maxLetterSpacingPt, Math.abs(run.letterSpacing ?? 0));
        if (run.fontResolution === 'not-ready' || run.fontResolution === 'unresolved') {
          unresolvedFontRunCount += 1;
          hasUnresolvedFont = true;
        }
        if (run.fontResolution === 'substituted') {
          fontFamilySubstitutionRunCount += 1;
          hasFontFamilySubstitution = true;
        }
        if (hasResolvedStyleMismatch(run)) {
          fontStyleMismatchRunCount += 1;
          hasFontStyleMismatch = true;
        }
        const identity = toFontIdentity(run);
        const identityKey = fontIdentityKey(identity);
        fontIdentities.set(identityKey, identity);
        nodeFontIdentities.set(identityKey, identity);
      }
    }

    if (
      maxLetterSpacingPt > 0
      || layout.overflow.horizontal
      || layout.overflow.vertical
      || hasUnresolvedFont
      || hasFontFamilySubstitution
      || hasFontStyleMismatch
    ) {
      attentionNodes.push({
        nodeId: input.nodeId,
        advanceSource: layout.advanceSource,
        lineCount: layout.lines.length,
        contentWidthInches: round6(resolveContentWidth(input.boxWidthInches, input.padding)),
        maxLineWidthInches: round6(maxLineWidth(layout)),
        maxSliceRightInches: round6(maxSliceRight(layout)),
        maxLetterSpacingPt: round6(maxLetterSpacingPt),
        overflow: { ...layout.overflow },
        fontIdentities: [...nodeFontIdentities.values()],
      });
    }
  }

  return {
    nodeCount: inputs.filter((input) => input.layout != null).length,
    advanceSourceCounts,
    overflowNodeCount,
    unresolvedFontRunCount,
    fontFamilySubstitutionRunCount,
    fontStyleMismatchRunCount,
    fontIdentities: [...fontIdentities.values()],
    attentionNodes,
  };
}

function collectTextLayoutInputs(slide: SlideRenderModel): TextLayoutProvenanceInput[] {
  const inputs: TextLayoutProvenanceInput[] = [];
  visitRenderNodes(slide.elements, ({ node }) => {
    if (node.kind === 'text') {
      inputs.push(fromTextNode(node));
      return;
    }
    if (node.kind === 'shape' && node.innerText != null) {
      inputs.push(fromTextNode(node.innerText));
      return;
    }
    if (node.kind !== 'table') {
      return;
    }
    for (const cellLayout of resolveTableCellLayouts(node)) {
      inputs.push({
        nodeId: `${node.id}:cell:${cellLayout.cell.row}:${cellLayout.cell.col}`,
        boxWidthInches: cellLayout.width,
        padding: cellLayout.cell.padding ?? TABLE_DEFAULT_CELL_PADDING,
        paragraphs: cellLayout.cell.paragraphs,
        layout: cellLayout.cell.textLayout,
      });
    }
  });
  return inputs;
}

function fromTextNode(node: TextRenderNode): TextLayoutProvenanceInput {
  return {
    nodeId: node.id,
    boxWidthInches: node.box.w,
    padding: node.padding,
    paragraphs: node.paragraphs,
    layout: node.layout,
  };
}

function toFontIdentity(
  run: RenderParagraph['runs'][number],
): TextLayoutFontProvenance {
  if (!('text' in run)) return {};
  return {
    requestedFamily: run.fontFamily,
    resolvedFamily: run.resolvedFontFamily,
    script: run.fontScript,
    resolution: run.fontResolution,
    faceFingerprint: run.fontFaceFingerprint,
    requestedWeight: run.fontWeight ?? 'normal',
    resolvedWeight: run.resolvedFontWeight,
    requestedStyle: run.fontStyle ?? 'normal',
    resolvedStyle: run.resolvedFontStyle,
  };
}

function fontIdentityKey(identity: TextLayoutFontProvenance): string {
  return [
    identity.requestedFamily ?? '',
    identity.resolvedFamily ?? '',
    identity.script ?? '',
    identity.resolution ?? '',
    identity.faceFingerprint ?? '',
    identity.requestedWeight ?? '',
    identity.resolvedWeight ?? '',
    identity.requestedStyle ?? '',
    identity.resolvedStyle ?? '',
  ].join('\u0000');
}

function hasResolvedStyleMismatch(run: RenderParagraph['runs'][number]): boolean {
  if (!('text' in run)) return false;
  const weightMismatch = run.resolvedFontWeight != null
    && run.resolvedFontWeight !== (run.fontWeight ?? 'normal');
  const styleMismatch = run.resolvedFontStyle != null
    && run.resolvedFontStyle !== (run.fontStyle ?? 'normal');
  return weightMismatch || styleMismatch;
}

function resolveContentWidth(boxWidthInches: number, padding: RenderPadding | undefined): number {
  return Math.max(boxWidthInches - (padding?.left ?? 0) - (padding?.right ?? 0), 0);
}

function maxLineWidth(layout: TextLayoutResult): number {
  return layout.lines.reduce((maximum, line) => Math.max(maximum, line.width), 0);
}

function maxSliceRight(layout: TextLayoutResult): number {
  return layout.lines.reduce((lineMaximum, line) => (
    Math.max(
      lineMaximum,
      line.slices.reduce((sliceMaximum, slice) => Math.max(sliceMaximum, slice.x + slice.width), 0),
    )
  ), 0);
}

function round6(value: number): number {
  return Number(value.toFixed(6));
}
