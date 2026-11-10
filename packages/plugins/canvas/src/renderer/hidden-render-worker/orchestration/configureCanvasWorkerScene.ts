import type { CanvasWorkerRequest } from '../../../shared/rendering';
import type { CanvasCard } from '../../../shared';
import { canvasRenderRectangles } from '../../../shared/rendering/functions/canvasRenderRectangles';
import type { CanvasKernel } from '../../kernel';

/** 正式快照与资源身份先安装，随后按明确裁切边界或整图fit定位。 */
export function configureCanvasWorkerScene(
  kernel: CanvasKernel,
  request: Extract<CanvasWorkerRequest, { kind: 'render' }>
): void {
  kernel.setElements(request.snapshot.elements);
  kernel.setDocumentTitles(
    new Map(Object.entries(request.documents).map(([id, presentation]) => [id, presentation.title]))
  );
  kernel.setThumbnailCards(
    new Set(
      request.snapshot.elements
        .filter(
          (element): element is CanvasCard =>
            element.type === 'document' &&
            request.documents[element.data.documentId]?.keepThumbnail === true
        )
        .map(card => card.id)
    )
  );
  kernel.setAppearance({
    dark: request.theme === 'dark',
    material: request.material,
    overview: 'titles',
  });
  if (request.region) {
    // 区域是明确的裁切边界，不应用整图fit的40px留白；保持比例并居中。
    const region = request.region,
      zoom = Math.min(request.width / region.width, request.height / region.height);
    kernel.setCamera({
      zoom,
      x: (request.width - region.width * zoom) / 2 - region.x * zoom,
      y: (request.height - region.height * zoom) / 2 - region.y * zoom,
    });
  } else kernel.fit(canvasRenderRectangles(request.snapshot.elements));
}
