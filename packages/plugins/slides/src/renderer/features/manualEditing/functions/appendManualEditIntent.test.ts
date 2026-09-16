import { describe, expect, it } from 'vitest';
import type { ManualEditIntent } from '../definitions/manualEditingTypes';
import { appendManualEditIntent } from './appendManualEditIntent';

const target = { slideKey: 'overview', editKey: 'headline' };

function textStyleIntent(
  value: { readonly fontSizePt?: number; readonly color?: string },
  operationTarget = target,
): ManualEditIntent {
  const operation = { op: 'set_text_style' as const, target: operationTarget, ...value };
  return {
    operation,
    visualPreview: {
      elementId: 'headline',
      affectedElementIds: ['headline'],
      operation,
    },
  };
}

describe('appendManualEditIntent', () => {
  it('merges adjacent text style fields for the same authoring target', () => {
    const result = appendManualEditIntent(
      [textStyleIntent({ fontSizePt: 24 })],
      textStyleIntent({ color: '#2563EB' }),
    );

    expect(result).toHaveLength(1);
    expect(result[0]?.operation).toEqual({
      op: 'set_text_style',
      target,
      fontSizePt: 24,
      color: '#2563EB',
    });
    expect(result[0]?.visualPreview?.operation).toEqual(result[0]?.operation);
  });

  it('keeps edits for different targets in their original order', () => {
    const first = textStyleIntent({ fontSizePt: 24 });
    const second = textStyleIntent(
      { color: '#2563EB' },
      { slideKey: 'overview', editKey: 'subtitle' },
    );

    expect(appendManualEditIntent([first], second)).toEqual([first, second]);
  });

  it('adds adjacent queued translations for the same target', () => {
    const createTranslation = (dx: number): ManualEditIntent => ({
      operation: {
        op: 'translate_by',
        target,
        targetKind: 'text',
        delta: { dx, dy: 0.1 },
      },
      translationPreview: {
        elementId: 'headline',
        affectedElementIds: ['headline'],
        dx,
        dy: 0.1,
      },
    });

    const result = appendManualEditIntent([createTranslation(0.2)], createTranslation(0.3));
    expect(result).toHaveLength(1);
    expect(result[0]?.operation).toMatchObject({ delta: { dx: 0.5, dy: 0.2 } });
    expect(result[0]?.translationPreview).toMatchObject({ dx: 0.5, dy: 0.2 });
  });
});
