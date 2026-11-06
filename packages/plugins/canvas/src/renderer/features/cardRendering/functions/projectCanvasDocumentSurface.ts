import type { CanvasRenderRequest } from '../../../../shared/rendering';
import type { CanvasDocumentSurfacePresentation } from '../definitions/canvasDocumentSurface';
/** 当前身份优先于迟到封面；停用状态只接纳明确来自文本快照的摘要。 */
export function projectCanvasDocumentSurface(
  resource: CanvasRenderRequest['documents'][string] | undefined
): CanvasDocumentSurfacePresentation | undefined {
  if (!resource) return undefined;
  const status =
    resource.status && resource.status !== 'available'
      ? resource.status
      : (resource.previewStatus ?? (resource.status === 'available' ? 'ready' : undefined));
  const available = status === undefined || status === 'ready';
  const snapshot =
    status === 'plugin_unavailable' && resource.previewStatus === 'plugin_unavailable';
  return {
    title: resource.title,
    status,
    ...(available && resource.image ? { image: resource.image } : {}),
    ...((available || snapshot) && resource.summary ? { summary: resource.summary } : {}),
  };
}
