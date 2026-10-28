import type { DeckPreview, SlidesDocumentBuildState, PresentationRenderModel } from '@plugin/slides/shared';
import { useSlidesStore } from '../../../store/slidesStore';

/** UI fixture 经同步 action 安装；不再给只读 selector 赋值。生产读取仍必须通过 wire 校验。 */
export function installTestPresentation(input: {
  documentId?: string | null; preview?: DeckPreview | null;
  buildState?: SlidesDocumentBuildState | null; renderModel?: PresentationRenderModel | null;
  error?: string | null; loading?: boolean;
}): void {
  const store = useSlidesStore();
  const previous = store.state.installed;
  if ('documentId' in input) {
    if (input.documentId === null) { store.$reset(); return; }
    if (input.documentId !== undefined) store.beginDocument(input.documentId);
  }
  const id = store.currentDeckId ?? input.preview?.nodeId ?? input.renderModel?.presentationId ?? 'deck';
  const buildState = input.buildState ?? previous?.buildState ?? { state: 'ready', presentationId: id,
    versionId: 'fixture', versionNumber: input.renderModel?.version ?? input.preview?.versionNumber ?? 1, sourceHash: 'a'.repeat(64) };
  store.installSnapshot({ snapshotId: 'fixture', buildState,
    preview: 'preview' in input ? input.preview ?? null : previous?.preview ?? null,
    renderModel: 'renderModel' in input ? input.renderModel ?? null : previous?.renderModel ?? null,
  }, store.currentSlideIndex);
  if ('error' in input) store.setReadError(input.error ?? null);
  if (input.loading) store.beginDocument(id);
}
