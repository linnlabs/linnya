import {
  CANVAS_SECTION_HEADER,
  CANVAS_SECTION_PADDING,
  type CanvasCard,
  type CanvasCardId,
  type CanvasPoint,
  type CanvasSectionCard,
} from '../../../../shared';
import type { CanvasWorkingPlan } from '../definitions/canvasWorkingPlan';
import { findCanvasPlacement } from './findCanvasPlacement';

const GAP = 32;
/** 区内一行最多放这么多张同宽卡再换行，避免分区被拉成一长条。 */
const ROW_CARDS = 3;

/**
 * 放进分区时只避开其他卡与别的分区，本区不是障碍：空区放在标题下方，
 * 否则接在最后一张成员右边，超过一行的宽度就换到最下一行开头。
 */
export function placeCanvasCardInSection(
  plan: CanvasWorkingPlan,
  card: {
    readonly width: number;
    readonly height: number;
    readonly side?: 'right' | 'left' | 'top' | 'bottom';
  },
  section: CanvasSectionCard,
  self?: CanvasCardId
): CanvasPoint {
  const cards = [...plan.elements.values()].flatMap(row =>
    row.element.type === 'edge' || row.element.id === self ? [] : [row.element]
  );
  const members = cards.filter(item => item.parentId === section.id);
  const occupied = [...cards.filter(item => item.id !== section.id), ...plan.reservedRectangles];
  const last = members.reduce<CanvasCard | undefined>(
    (latest, item) => (!latest || item.order > latest.order ? item : latest),
    undefined
  );
  const start = { x: section.x + CANVAS_SECTION_PADDING, y: section.y + CANVAS_SECTION_HEADER };
  if (!last)
    return findCanvasPlacement({
      ...card,
      near: undefined,
      origin: start,
      side: card.side ?? 'right',
      occupied,
    });
  const rowWidth = Math.max(
    section.width - CANVAS_SECTION_PADDING * 2,
    card.width * ROW_CARDS + GAP * (ROW_CARDS - 1)
  );
  const wraps = !card.side && last.x + last.width + GAP + card.width > start.x + rowWidth;
  return findCanvasPlacement({
    ...card,
    near: wraps ? undefined : last,
    origin: wraps
      ? { x: start.x, y: Math.max(...members.map(item => item.y + item.height)) + GAP }
      : undefined,
    side: wraps ? 'bottom' : (card.side ?? 'right'),
    occupied,
  });
}
