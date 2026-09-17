import type { Box, TextStyle } from '../../deckSpec';

import type { ShapeTextLayout } from '../definitions/shapeTextLayout';

export function estimateShapeTextFontSize(
  box: Box,
  text: string,
  rotated: boolean,
): number {
  const lines = text.split('\n').length;
  const longestLine = Math.max(...text.split('\n').map((line) => line.trim().length), 0);

  let size = 16;
  if (box.h <= 0.45) size = 8;
  else if (box.h <= 0.65) size = 9;
  else if (box.h <= 0.95) size = 10;
  else if (box.h <= 1.3) size = 11;
  else if (box.h <= 1.8) size = 12;
  else if (box.h <= 2.4) size = 13;

  if (lines >= 3) size -= 1;
  if (lines >= 4) size -= 1;
  if (longestLine >= 28) size -= 1;
  if (longestLine >= 40) size -= 1;
  if (rotated) size -= 1;
  if (box.w <= 1.4) size -= 1;

  return Math.max(8, Math.min(18, size));
}

export function resolveShapeTextLayout(
  box: Box,
  text: string,
  style?: TextStyle,
  rotated = false,
): ShapeTextLayout {
  const lines = text.split('\n').length;
  const longestLine = Math.max(...text.split('\n').map((line) => line.trim().length), 0);
  const multiline = lines > 1 || longestLine > 24;
  const compact = box.w <= 1.6 || box.h <= 0.55;

  return {
    fontSize: style?.fontSize ?? estimateShapeTextFontSize(box, text, rotated),
    align: multiline && !rotated ? 'left' : (style?.align ?? 'center'),
    valign: multiline && !rotated ? 'top' : (style?.valign ?? 'middle'),
    marginPoints: compact ? [2, 4, 2, 4] : [6, 8, 6, 8],
    paddingInches: compact
      ? { top: 2 / 72, right: 4 / 72, bottom: 2 / 72, left: 4 / 72 }
      : { top: 6 / 72, right: 8 / 72, bottom: 6 / 72, left: 8 / 72 },
  };
}

