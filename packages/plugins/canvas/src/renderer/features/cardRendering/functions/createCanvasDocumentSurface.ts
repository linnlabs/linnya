import { createDocumentPreviewSurface, documentPreviewMessage } from '@linnya/document-preview';
import { readCanvasCardCssPalette } from '../../../../shared';
import { CANVAS_CARD_CORNER_RADIUS, CANVAS_CARD_PAPER_INSET } from '../../../kernel/cardFrame';
import type {
  CanvasDocumentSurfacePresentation,
  CanvasDocumentSurfaceContext,
} from '../definitions/canvasDocumentSurface';

export const canvasDocumentPreviewMessage = documentPreviewMessage;

/** Canvas 只提供几何和已授权事实，正文、标题与状态均消费行内引用同一个用户预览。 */
export async function createCanvasDocumentSurface(
  presentation: CanvasDocumentSurfacePresentation | undefined,
  { document, card, signal, theme }: CanvasDocumentSurfaceContext
): Promise<HTMLElement> {
  const status = presentation?.status ?? (presentation ? 'ready' : 'preview_unavailable');
  const result = await createDocumentPreviewSurface({
    preview: {
      documentId: card.documentId,
      title: presentation?.title ?? null,
      nodeType: null,
      status,
      ...((status === 'ready' || status === 'plugin_unavailable') && presentation
        ? {
            content: {
              revisionKey: 'resolved',
              summary: presentation.summary ?? '',
              ...(status === 'ready' && presentation.body ? { detail: presentation.body } : {}),
              ...(status === 'ready' && presentation.image
                ? {
                    image: {
                      dataUri: presentation.image,
                      widthPx: card.width,
                      heightPx: card.height,
                    },
                  }
                : {}),
              ...(presentation.thumbnail ? { overview: 'thumbnail' as const } : {}),
            },
          }
        : {}),
    },
    document,
    signal,
    theme,
    icon: presentation?.icon,
    ...(presentation?.referenceTypeIcon
      ? { referenceTypeIcon: presentation.referenceTypeIcon }
      : {}),
    widthPx: card.width,
    maxHeight: card.height,
    // 位图铺满卡片几何框，看得见的纸面四周内缩；正文和淡出在纸边结束，和选中详情一致。
    visibleInsetPx: CANVAS_CARD_PAPER_INSET,
  });
  result.element.style.setProperty(
    '--document-preview-fade-color',
    readCanvasCardCssPalette(card.color, theme === 'dark').paper
  );
  // 与文字卡淡出同一几何：取卡片材质圆角；纸材质圆角更小，多出的角落透出的是同色纸面。
  result.element.style.setProperty(
    '--document-preview-fade-radius',
    `${CANVAS_CARD_CORNER_RADIUS.card}px`
  );
  return result.element;
}
