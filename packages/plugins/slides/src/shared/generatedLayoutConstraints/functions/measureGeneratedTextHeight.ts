import { HeuristicMeasureAdapter, normalizeTextMeasureInput } from '@linnya/text-measurement-core';
import type { GeneratedTextHeightMeasurement } from '../definitions/generatedLayoutConstraintEvidence';

const adapter = new HeuristicMeasureAdapter();

/** 与生产 build Worker 的 Yoga 估高完全同源；它只决定排版前外框，不替代最终字形测量。 */
export function measureGeneratedTextHeight(content: string, width: number, input: GeneratedTextHeightMeasurement): number {
  if (!content || width <= 0) return 0;
  return adapter.measure(normalizeTextMeasureInput({ paragraphs: [{ text: content }],
    style: { fontSizePt: input.fontSizePt, lineHeightMultiplier: input.lineSpacingMultiple, letterSpacingPt: input.letterSpacingPt },
    box: { widthInches: width, wrap: 'word' }, sourceKind: 'generated',
  })).totalHeightInches;
}
