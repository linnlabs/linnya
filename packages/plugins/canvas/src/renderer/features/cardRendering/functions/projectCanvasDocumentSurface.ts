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
    ...((available || snapshot) && resource.summary ? { summary: resource.summary } : {}),
    ...(available ? availablePreview(resource) : {}),
  };
}
/** 可显示时才带出封面、正文与缩略图偏好。 */
function availablePreview(
  resource: NonNullable<CanvasRenderRequest['documents'][string]>
): Partial<CanvasDocumentSurfacePresentation> {
  return {
    ...(resource.image ? { image: resource.image } : {}),
    ...(resource.body ? { body: resource.body } : {}),
    ...(resource.keepThumbnail ? { thumbnail: true } : {}),
  };
}
