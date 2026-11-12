import {
  readCanvasElementText,
  type CanvasAgentGroup,
  type CanvasCard,
  type CanvasElement,
  type CanvasElementId,
} from '@plugin/canvas/shared';
import type { CanvasReviewTarget } from '../definitions/agentReview';
import { canvasText } from '../../localization';

const FIELD_KEYS = {
  data: 'canvas.review.field.data',
  color: 'canvas.review.field.color',
  width: 'canvas.review.field.width',
  height: 'canvas.review.field.height',
  locked: 'canvas.review.field.locked',
  x: 'canvas.review.field.x',
  y: 'canvas.review.field.y',
  order: 'canvas.review.field.order',
  parentId: 'canvas.review.field.parentId',
  $entity: 'canvas.review.field.entity',
  $existence: 'canvas.review.field.existence',
  from: 'canvas.review.field.from',
  to: 'canvas.review.field.to',
  label: 'canvas.review.field.label',
  direction: 'canvas.review.field.direction',
  lineStyle: 'canvas.review.field.lineStyle',
  linePattern: 'canvas.review.field.linePattern',
} as const;
function isKnownField(field: string): field is keyof typeof FIELD_KEYS {
  return Object.prototype.hasOwnProperty.call(FIELD_KEYS, field);
}
export function canvasReviewFields(fields: readonly string[] | null): string {
  return fields === null
    ? canvasText('canvas.review.field.unrecorded')
    : [
        ...new Set(
          fields.map(field =>
            canvasText(isKnownField(field) ? FIELD_KEYS[field] : 'canvas.review.field.other')
          )
        ),
      ].join(canvasText('canvas.list.comma'));
}
export function canvasReviewCardTitle(
  card: CanvasCard,
  documentTitles?: ReadonlyMap<string, string>
): string {
  if (card.type === 'document')
    return documentTitles?.get(card.data.documentId) ?? canvasText('canvas.card.document');
  return (
    readCanvasElementText(card).replace(/\s+/g, ' ').trim().slice(0, 64) ||
    (card.type === 'image' ? canvasText('canvas.card.image') : canvasText('canvas.card.blankText'))
  );
}
export function projectCanvasReviewTargets(
  group: CanvasAgentGroup,
  elements: readonly CanvasElement[],
  documentTitles?: ReadonlyMap<string, string>
): CanvasReviewTarget[] {
  const live = new Map<CanvasElementId, CanvasCard>(
    elements.filter(element => element.type !== 'edge').map(card => [card.id, card])
  );
  const deleted = new Map<CanvasElementId, CanvasCard>(
    group.deletedCards.filter(card => !live.has(card.id)).map(card => [card.id, card])
  );
  return group.changes
    .flatMap(change => {
      const card = change.kind === 'deleted' ? deleted.get(change.id) : live.get(change.id);
      if (!card) return [];
      const description =
        change.kind === 'added'
          ? canvasText('canvas.review.describe.added')
          : change.kind === 'deleted'
            ? canvasText('canvas.review.describe.deleted')
            : canvasText('canvas.review.describe.updated', {
                fields: canvasReviewFields(
                  change.fields.filter(
                    field =>
                      !['x', 'y', 'order', 'parentId'].includes(field) &&
                      !(card.type === 'section' && (field === 'width' || field === 'height'))
                  )
                ),
              });
      return [
        {
          id: card.id,
          groupId: group.id,
          kind: change.kind,
          bounds: { x: card.x, y: card.y, width: card.width, height: card.height },
          title: canvasReviewCardTitle(card, documentTitles),
          description,
        },
      ];
    })
    .sort(
      (left, right) =>
        left.bounds.x - right.bounds.x ||
        left.bounds.y - right.bounds.y ||
        left.id.localeCompare(right.id)
    );
}
/** 只有新的实际写入替换当前显示组；审阅/跳过结果刷新不会抢走用户正在查看的旧组。 */
export function chooseCanvasReviewGroup(
  previous: readonly CanvasAgentGroup[],
  groups: readonly CanvasAgentGroup[],
  activeId: string | null
): string | null {
  const latest = [...groups].sort(
    (a, b) => b.lastWriteAt - a.lastWriteAt || b.createdAt - a.createdAt
  )[0];
  if (!latest) return null;
  const old = previous.find(group => group.id === latest.id);
  if (!old || latest.lastWriteAt > old.lastWriteAt || !groups.some(group => group.id === activeId))
    return latest.id;
  return activeId;
}
