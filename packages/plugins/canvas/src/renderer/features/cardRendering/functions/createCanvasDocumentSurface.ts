import { createDocumentPreviewSurface, documentPreviewMessage } from '@linnya/document-preview';
import type { CanvasDocumentSurfacePresentation } from '../definitions/canvasDocumentSurface';

export const canvasDocumentPreviewMessage = documentPreviewMessage;

/** Canvas 只提供几何和已授权事实，正文、标题与状态均消费超级标签同一个用户预览。 */
export async function createCanvasDocumentSurface(
  presentation: CanvasDocumentSurfacePresentation | undefined,
  document: Document,
  card: { readonly documentId: string; readonly width: number; readonly height: number },
  signal: AbortSignal,
  theme: 'light' | 'dark'
): Promise<HTMLElement> {
  const status = presentation?.status ?? (presentation ? 'ready' : 'preview_unavailable');
  const result = await createDocumentPreviewSurface({
    preview: {
      documentId: card.documentId,
      title: presentation?.title ?? null,
      nodeType: null,
      status,
      ...((status === 'ready' || status === 'plugin_unavailable') && presentation ? {
        content: {
          revisionKey: 'resolved', summary: presentation.summary ?? '',
          ...(status === 'ready' && presentation.body ? { detail: presentation.body } : {}),
          ...(status === 'ready' && presentation.image ? {
            image: { dataUri: presentation.image, widthPx: card.width, heightPx: card.height },
          } : {}),
          ...(presentation.thumbnail ? { overview: 'thumbnail' as const } : {}),
        },
      } : {}),
    },
    document, signal, theme, icon: presentation?.icon,
    widthPx: card.width, maxHeight: card.height,
  });
  return result.element;
}
