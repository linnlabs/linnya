import { describe, expect, it } from 'vitest';
import type { ManualEditIntent, ManualEditingTranslationPreview } from '../definitions/manualEditingTypes';
import {
  collectManualTranslationPreviews,
  collectManualVisualPreviews,
  mergeManualTranslationPreviews,
  resolveManualTargetTranslation,
} from './manualIntentPreviews';

const parent: ManualEditingTranslationPreview = {
  elementId: 'frame',
  affectedElementIds: ['frame', 'child'],
  dx: 1,
  dy: 0.5,
};
const child: ManualEditingTranslationPreview = {
  elementId: 'child',
  affectedElementIds: ['child'],
  dx: 0.25,
  dy: -0.5,
};

describe('manual intent previews', () => {
  it('combines active and queued translations without double-applying an ancestor', () => {
    const queued: ManualEditIntent[] = [{
      operation: {
        op: 'translate_by',
        target: { slideKey: 'overview', editKey: 'child' },
        targetKind: 'text',
        delta: { dx: child.dx, dy: child.dy },
      },
      translationPreview: child,
    }];
    const previews = collectManualTranslationPreviews(null, parent, queued);
    expect(mergeManualTranslationPreviews(previews).get('child')).toMatchObject({
      dx: 1.25,
      dy: 0,
    });
    expect(resolveManualTargetTranslation('child', previews)).toMatchObject({
      dx: 0.25,
      dy: -0.5,
    });
  });

  it('keeps property previews for every queued target in submission order', () => {
    const first = {
      elementId: 'title',
      affectedElementIds: ['title'],
      operation: {
        op: 'set_text_style' as const,
        target: { slideKey: 'overview', editKey: 'title' },
        color: '#2563EB',
      },
    };
    const second = {
      elementId: 'shape',
      affectedElementIds: ['shape'],
      operation: {
        op: 'set_fill_color' as const,
        target: { slideKey: 'overview', editKey: 'shape' },
        targetKind: 'shape' as const,
        color: '#DC2626',
      },
    };
    expect(collectManualVisualPreviews(first, [{ operation: second.operation, visualPreview: second }]))
      .toEqual([first, second]);
  });
});
