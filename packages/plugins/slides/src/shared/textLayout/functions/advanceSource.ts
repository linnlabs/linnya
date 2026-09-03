import type { TextLayoutResult } from '../definitions/types';

type TextLayoutAdvanceSource = TextLayoutResult['advanceSource'];

export function combineTextLayoutAdvanceSources(
  sources: readonly TextLayoutAdvanceSource[],
  emptySource: TextLayoutAdvanceSource = 'heuristic',
): TextLayoutAdvanceSource {
  if (sources.length === 0) {
    return emptySource;
  }
  return sources.reduce<TextLayoutAdvanceSource>(combineTextLayoutAdvanceSource, 'harfbuzz');
}

export function combineTextLayoutAdvanceSource(
  current: TextLayoutAdvanceSource,
  next: TextLayoutAdvanceSource,
): TextLayoutAdvanceSource {
  if (current === 'heuristic' || next === 'heuristic') {
    return 'heuristic';
  }
  if (current === 'pretext' || next === 'pretext') {
    return 'pretext';
  }
  return 'harfbuzz';
}
