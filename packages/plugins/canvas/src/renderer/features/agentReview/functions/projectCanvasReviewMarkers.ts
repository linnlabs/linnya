import type { CanvasAgentGroup, CanvasCamera, CanvasElement } from '@plugin/canvas/shared';

export function projectCanvasReviewMarkers(groups: readonly CanvasAgentGroup[], elements: readonly CanvasElement[], camera: CanvasCamera, activeId: string | null) {
  const shown = activeId ? groups.filter(group => group.id === activeId) : groups;
  const cards = elements.filter(element => element.type !== 'edge');
  return shown.flatMap(group => [
    ...cards.filter(card => !group.reviewedElementIds.includes(card.id) && (group.added.includes(card.id) || group.updated.includes(card.id)))
      .map(card => ({ id: card.id, groupId: group.id, kind: group.added.includes(card.id) ? 'added' : 'updated',
        x: (card.x + card.width) * camera.zoom + camera.x, y: card.y * camera.zoom + camera.y, width: 0, height: 0 })),
    ...group.visibleDeletedCards.filter(card => !group.reviewedElementIds.includes(card.id)).map(card => ({ id: card.id, groupId: group.id, kind: 'deleted',
      x: card.x * camera.zoom + camera.x, y: card.y * camera.zoom + camera.y, width: card.width * camera.zoom, height: card.height * camera.zoom })),
  ]);
}
