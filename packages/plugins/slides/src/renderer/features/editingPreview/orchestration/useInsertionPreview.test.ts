// @vitest-environment jsdom
import { effectScope, nextTick, shallowRef } from 'vue';
import { expect, it, vi } from 'vitest';
import { loadSlideVisualResources } from '../../renderVisualResources/orchestration/loadSlideVisualResources';
import type { SlideVisualResources } from '../../renderVisualResources/definitions/slideVisualResources';
import type { EditingInsertionPreview } from '../definitions/editingInsertionPreview';
import { unpresentedInsertions } from '../functions/unpresentedInsertions';
import { useInsertionPreview } from './useInsertionPreview';

vi.mock('../../renderVisualResources/orchestration/loadSlideVisualResources', () => ({ loadSlideVisualResources: vi.fn() }));

it('正式页接管和失败撤下立即生效，慢图片完成不能复活已取消的预览', async () => {
  const resources: SlideVisualResources = { imageResources: new Map(), chartResources: new Map() };
  const resolveLoads: Array<(value: SlideVisualResources) => void> = [];
  vi.mocked(loadSlideVisualResources).mockImplementation(() => new Promise(resolve => resolveLoads.push(resolve)));
  const shape: EditingInsertionPreview = { object: { kind: 'shape', editKey: 'shape', geometry: 'rect', content: '', fill: '#224466', box: { x: 1, y: 1, w: 2, h: 1 } } };
  const image: EditingInsertionPreview = { object: { kind: 'image', editKey: 'image', assetId: 'owned-image', fit: 'contain', alt: 'Photo', box: { x: 4, y: 1, w: 2, h: 1 } }, imageSource: 'data:image/png;base64,fixture' };
  const entries = shallowRef<readonly EditingInsertionPreview[]>([shape]);
  const scope = effectScope();
  const preview = scope.run(() => useInsertionPreview(entries));
  if (!preview) throw new Error('Expected preview scope');
  try {
    resolveLoads[0](resources);
    await nextTick();
    expect(preview.displayedSlide.value?.elements[0]).toMatchObject({ kind: 'shape', fill: { type: 'solid', color: '#224466' } });
    entries.value = [shape, image];
    await nextTick();
    const ready = preview.displayedSlide.value;
    if (!ready) throw new Error('Expected ready shape');
    const confirmed = { ...ready, elements: ready.elements.map(node => ({ ...node, authoringRef: { slideKey: 'page', editKey: 'shape', targetKind: 'shape' as const } })) };
    entries.value = unpresentedInsertions(entries.value, confirmed);
    expect(entries.value).toEqual([image]);
    expect(preview.displayedSlide.value).toBeNull();
    entries.value = [];
    for (const resolve of resolveLoads) resolve(resources);
    await nextTick();
    await nextTick();
    expect(preview.displayedSlide.value).toBeNull();
  } finally { scope.stop(); }
});
