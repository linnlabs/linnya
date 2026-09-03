import { describe, expect, it } from 'vitest';
import type { SlideRenderModel, TextRenderNode } from '../../renderModel';
import { summarizeSlideTextLayoutProvenance } from '../functions/summarizeTextLayoutProvenance';

const FACE_FINGERPRINT = 'a'.repeat(64);

describe('summarizeSlideTextLayoutProvenance', () => {
  it('聚合普通节点，只展开字距、溢出、字体替换与未决节点', () => {
    const plain = makeTextNode('plain', 0, 'harfbuzz');
    const spaced = makeTextNode('spaced', 1.55, 'heuristic', {
      horizontal: true,
      vertical: false,
      hiddenLineCount: 0,
    });
    spaced.paragraphs[0]!.runs[0]!.fontFaceFingerprint = FACE_FINGERPRINT;
    const unresolved = makeTextNode('unresolved', 0, 'pretext');
    unresolved.paragraphs[0]!.runs[0]!.fontResolution = 'unresolved';
    const substituted = makeTextNode('substituted', 0, 'harfbuzz');
    substituted.paragraphs[0]!.runs[0]!.fontResolution = 'substituted';
    substituted.paragraphs[0]!.runs[0]!.resolvedFontFamily = 'Hiragino Sans W6';
    const styleMismatch = makeTextNode('style-mismatch', 0, 'harfbuzz');
    styleMismatch.paragraphs[0]!.runs[0]!.resolvedFontWeight = 'bold';

    const summary = summarizeSlideTextLayoutProvenance(makeSlide([
      plain,
      spaced,
      unresolved,
      substituted,
      styleMismatch,
    ]));

    expect(summary).toMatchObject({
      nodeCount: 5,
      advanceSourceCounts: { harfbuzz: 3, pretext: 1, heuristic: 1 },
      overflowNodeCount: 1,
      unresolvedFontRunCount: 1,
      fontFamilySubstitutionRunCount: 1,
      fontStyleMismatchRunCount: 1,
    });
    expect(summary.attentionNodes.map((node) => node.nodeId)).toEqual([
      'spaced',
      'unresolved',
      'substituted',
      'style-mismatch',
    ]);
    expect(summary.attentionNodes[0]).toMatchObject({
      contentWidthInches: 1.7,
      maxLineWidthInches: 1.82,
      maxSliceRightInches: 1.82,
      maxLetterSpacingPt: 1.55,
      fontIdentities: [{ faceFingerprint: FACE_FINGERPRINT }],
    });
    expect(JSON.stringify(summary)).not.toContain('/System/Library/Fonts');
    expect(summary.attentionNodes[2]?.fontIdentities[0]).toMatchObject({
      requestedFamily: 'Avenir Next',
      resolvedFamily: 'Hiragino Sans W6',
      resolution: 'substituted',
    });
    expect(summary.attentionNodes[3]?.fontIdentities[0]).toMatchObject({
      requestedWeight: 'normal',
      resolvedWeight: 'bold',
    });
  });
});

function makeSlide(elements: TextRenderNode[]): SlideRenderModel {
  return {
    slideId: 'slide-1',
    index: 0,
    layoutKey: 'blank',
    background: { paint: { type: 'solid', color: '#FFFFFF' } },
    elements,
  };
}

function makeTextNode(
  id: string,
  letterSpacing: number,
  advanceSource: 'harfbuzz' | 'pretext' | 'heuristic',
  overflow = { horizontal: false, vertical: false, hiddenLineCount: 0 },
): TextRenderNode {
  return {
    id,
    kind: 'text',
    box: { x: 0, y: 0, w: 2, h: 0.5, unit: 'in' },
    zIndex: 0,
    padding: { top: 0.1, right: 0.1, bottom: 0.1, left: 0.2 },
    paragraphs: [{
      runs: [{
        text: 'DESIGNED TENSION',
        fontFamily: 'Avenir Next',
        resolvedFontFamily: 'Avenir Next',
        fontScript: 'latin',
        fontResolution: 'exact',
        letterSpacing,
      }],
    }],
    layout: {
      lines: [{
        paragraphIndex: 0,
        y: 0,
        baseline: 0.1,
        height: 0.15,
        width: 1.82,
        align: 'left',
        slices: [{
          paragraphIndex: 0,
          runIndex: 0,
          text: 'DESIGNED TENSION',
          x: 0,
          width: 1.82,
          textY: 0,
        }],
      }],
      contentHeightInches: 0.15,
      appliedFontScale: 1,
      appliedLineSpacingReduction: 0,
      advanceSource,
      overflow,
    },
  };
}
