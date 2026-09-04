import { describe, expect, it, vi } from 'vitest';
import { updateAnnotationsPositionForMovedBlock } from './AnnoMoveCommands';

describe('updateAnnotationsPositionForMovedBlock', () => {
  it('does not write a zero fallback when owner layout coordinates are invalid', async () => {
    const updateAnnotation = vi.fn();
    const recalculateAllPositions = vi.fn();

    await updateAnnotationsPositionForMovedBlock({
      blockId: 'root-a',
      annotationStore: {
        getAnnotationsByBlockId: () => [{ id: 'annotation-a' }],
        updateAnnotation,
      },
      panelPositionManager: {
        calculateInitialPositionCSS: () => ({ top: 'invalid', left: '20px' }),
        recalculateAllPositions,
      },
    });

    expect(updateAnnotation).not.toHaveBeenCalled();
    expect(recalculateAllPositions).not.toHaveBeenCalled();
  });
});
