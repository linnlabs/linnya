import { describe, expect, it } from 'vitest';
import type { TextEditingTarget } from '../definitions/textEditingTypes';
import { createInlineTextEditorStyle } from './createInlineTextEditorStyle';

const target: TextEditingTarget = {
  elementId: 'headline',
  targetKind: 'text',
  authoringRef: { slideKey: 'overview', editKey: 'headline' },
  content: '标题',
  origin: { x: 1, y: 2 },
  width: 3,
  height: 1,
  rotation: 15,
  padding: { top: 0.1, right: 0.2, bottom: 0.1, left: 0.2 },
  verticalOffset: 0.25,
  fontFamily: 'Inter',
  fontSizePt: 18,
  appliedFontScale: 0.5,
  fontWeight: 'bold',
  fontStyle: 'normal',
  color: '#123456',
  textAlign: 'center',
  lineHeight: 1.25,
  opacity: 0.8,
};

describe('createInlineTextEditorStyle', () => {
  it('keeps the DOM editor aligned with the zoomed slide coordinate system', () => {
    const style = createInlineTextEditorStyle(target, {
      slideLeft: 40,
      slideTop: 60,
      renderScale: 0.5,
    });
    expect(style).toMatchObject({
      left: '88px',
      top: '156px',
      width: '144px',
      height: '48px',
      transform: 'rotate(15deg)',
      fontSize: '6px',
      fontFamily: 'Inter',
      color: '#123456',
    });
    expect(Number.parseFloat(String(style.paddingTop))).toBeCloseTo(16.8);
  });
});
