import type { CanvasAgentGroup, CanvasCamera, CanvasElement } from '@plugin/canvas/shared';
import type { CanvasReviewDirection, CanvasReviewMarker } from '../definitions/agentReview';
import { projectCanvasReviewTargets } from './projectCanvasReviewTargets';

export function projectCanvasReviewMarkers(input: {
  readonly groups: readonly CanvasAgentGroup[];
  readonly elements: readonly CanvasElement[];
  readonly camera: CanvasCamera;
  readonly activeId: string | null;
  readonly documentTitles?: ReadonlyMap<string, string>;
}): CanvasReviewMarker[] {
  const { groups, elements, camera, activeId, documentTitles } = input;
  if (camera.zoom < 0.3) return [];
  const shown = activeId ? groups.filter(group => group.id === activeId) : [];
  return shown.flatMap(group => {
    const reviewed = new Set(group.reviewedElementIds),
      visibleDeleted = new Set(group.visibleDeletedCards.map(card => card.id));
    return projectCanvasReviewTargets(group, elements, documentTitles)
      .filter(
        target =>
          !reviewed.has(target.id) && (target.kind !== 'deleted' || visibleDeleted.has(target.id))
      )
      .map(target => {
        const bounds = target.bounds;
        const screenBounds = {
          x: bounds.x * camera.zoom + camera.x,
          y: bounds.y * camera.zoom + camera.y,
          width: bounds.width * camera.zoom,
          height: bounds.height * camera.zoom,
        };
        return {
          ...target,
          screenBounds,
          x: screenBounds.x + (target.kind === 'deleted' ? 0 : screenBounds.width),
          y: screenBounds.y,
          width: target.kind === 'deleted' ? screenBounds.width : 0,
          height: target.kind === 'deleted' ? screenBounds.height : 0,
        };
      });
  });
}
/** 仅完全离屏的卡片参与方向提示；半可见卡不会同时出现额外提示。 */
export function projectCanvasReviewDirections(
  markers: readonly CanvasReviewMarker[],
  viewport: { readonly width: number; readonly height: number }
): CanvasReviewDirection[] {
  const groups = new Map<CanvasReviewDirection['direction'], CanvasReviewMarker[]>();
  for (const marker of markers) {
    const rect = marker.screenBounds;
    const horizontal = rect.x + rect.width < 0 ? 'left' : rect.x > viewport.width ? 'right' : null;
    const vertical = rect.y + rect.height < 0 ? 'top' : rect.y > viewport.height ? 'bottom' : null;
    const direction = horizontal ?? vertical;
    if (direction) {
      const targets = groups.get(direction) ?? [];
      targets.push(marker);
      groups.set(direction, targets);
    }
  }
  return [...groups].map(([direction, targets]) => ({ direction, targets }));
}
