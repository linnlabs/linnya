import { useSlidesStore } from '../../store/slidesStore';
import { useSlidesRenderStore } from '../../store/slidesRenderStore';

/** 文档可能已经刷新成功而 RenderModel 读取失败；重试不能被文档版本去重吞掉。 */
export async function refreshSlidesDocumentPresentation(documentId: string, revision?: number): Promise<void> {
  const slides = useSlidesStore();
  const render = useSlidesRenderStore();
  await slides.refreshDeck(documentId, revision);
  if (slides.currentDeckId === documentId && render.renderError) {
    await render.loadRenderModel(documentId, { keepExisting: true });
    if (render.renderError) throw new Error(render.renderError);
  }
}
