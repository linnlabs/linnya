import { describe, expect, it } from 'vitest';
import type { RenderNode } from '../../../types/render';
import type { ManualEditableTarget } from '../../manualEditing/selection';
import { resolveLayerAvailability } from './layerAvailability';

function node(editKey: string, ancestors: readonly string[] = []): RenderNode {
  return { id: editKey, kind: 'shape', zIndex: 0, box: { x: 0, y: 0, w: 1, h: 1, unit: 'in' }, geometry: { type: 'preset', name: 'rect' },
    authoringRef: { slideKey: 'page', editKey, targetKind: 'shape' },
    authoringAncestorRefs: ancestors.map(key => ({ slideKey: 'page', editKey: key, targetKind: 'frame' as const })) };
}
function target(editKey: string, ancestors: readonly string[] = []): Pick<ManualEditableTarget, 'authoringRef' | 'authoringAncestorRefs'> {
  return { authoringRef: { slideKey: 'page', editKey }, authoringAncestorRefs: node(editKey, ancestors).authoringAncestorRefs ?? [] };
}

describe('resolveLayerAvailability', () => {
  it('disables moves that cannot change paint order among siblings of the same parent', () => {
    const nodes = [node('a'), node('b'), node('card'), node('label', ['card']), node('c')];
    expect(resolveLayerAvailability(nodes, target('c'))).toEqual({ front: false, forward: false, backward: true, back: true });
    expect(resolveLayerAvailability(nodes, target('a'))).toEqual({ front: true, forward: true, backward: false, back: false });
    expect(resolveLayerAvailability(nodes, target('label', ['card']))).toEqual({ front: false, forward: false, backward: false, back: false });
  });
});
