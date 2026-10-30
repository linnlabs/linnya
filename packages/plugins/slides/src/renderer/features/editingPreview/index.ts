export type { EditingVisualPreview, EditingVisualOperation } from './definitions/editingPreviewTypes';
export { projectEditingPreviewNode } from './functions/projectEditingPreview';
export { collectEditingPreviewGeometries } from './functions/collectEditingPreviewGeometries';

export type { EditingInsertionPreview } from './definitions/editingInsertionPreview';
export { useInsertionPreview } from './orchestration/useInsertionPreview';
export { unpresentedInsertions } from './functions/unpresentedInsertions';

export type { EditingPreviewProjector } from './definitions/editingPreviewTypes';
export { useSlideEditingPreview, useEditingPreviewProjector } from './orchestration/useSlideEditingPreview';
export { projectEditingPreviewSlide } from './functions/projectEditingPreviewSlide';
