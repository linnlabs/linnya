import { canvasBounds } from '../../geometry/functions/canvasGeometry';
import type { CanvasCard, CanvasCardId } from '../../model/definitions/canvasElement';
import { readCanvasCardComponents, type CanvasCardConnection } from './canvasCardConnections';

interface ReadingBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly tie: CanvasCardId;
}
interface ReadingItem extends ReadingBox {
  readonly ids: readonly CanvasCardId[];
}

const compareIds = (a: CanvasCardId, b: CanvasCardId) =>
  a.localeCompare(b, 'en', { numeric: true });
const verticalOverlap = (a: ReadingBox, b: ReadingBox) =>
  Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);

/** 同一行：与这一行里最矮者上下重叠过半；行内从左到右。高卡不会把旁边上下错开的卡并进同一行。 */
function readRows<T extends ReadingBox>(items: readonly T[]): T[] {
  const sorted = [...items].sort((a, b) => a.y - b.y || a.x - b.x || compareIds(a.tie, b.tie));
  const rows: { members: T[]; shortest: T }[] = [];
  for (const item of sorted) {
    const row = rows[rows.length - 1];
    if (
      row &&
      verticalOverlap(item, row.shortest) > Math.min(item.height, row.shortest.height) / 2
    ) {
      row.members.push(item);
      if (item.height < row.shortest.height) row.shortest = item;
    } else rows.push({ members: [item], shortest: item });
  }
  return rows.flatMap(row =>
    row.members.sort((a, b) => a.x - b.x || a.y - b.y || compareIds(a.tie, b.tie))
  );
}

const box = (card: CanvasCard): ReadingBox => ({
  x: card.x,
  y: card.y,
  width: card.width,
  height: card.height,
  tie: card.id,
});

/** 成树：唯一根、每张卡至多一个上级、无环。父子按连线 from→to，与树状键盘一致；不成树返回 null。 */
function readTreeOrder(
  ids: readonly CanvasCardId[],
  connections: readonly CanvasCardConnection[],
  byId: ReadonlyMap<CanvasCardId, CanvasCard>
): CanvasCardId[] | null {
  const members = new Set(ids),
    inside = connections.filter(({ from, to }) => members.has(from) && members.has(to));
  if (inside.length !== ids.length - 1) return null;
  const parent = new Map<CanvasCardId, CanvasCardId>(),
    children = new Map<CanvasCardId, CanvasCard[]>();
  for (const { from, to } of inside) {
    if (parent.has(to) || from === to) return null;
    parent.set(to, from);
    const list = children.get(from);
    if (list) list.push(byId.get(to)!);
    else children.set(from, [byId.get(to)!]);
  }
  const root = ids.find(id => !parent.has(id));
  if (!root) return null;
  const order: CanvasCardId[] = [],
    stack = [root];
  while (stack.length) {
    const id = stack.pop()!;
    order.push(id);
    const next = readRows((children.get(id) ?? []).map(box)).map(child => child.tie);
    for (let index = next.length - 1; index >= 0; index--) stack.push(next[index]);
  }
  return order.length === ids.length ? order : null;
}

/**
 * 画布唯一阅读顺序：Tab、搜索结果、读屏序号、选区与 Agent 投影共用。
 * 按版面从左上到右下按行读；连线成树的一组卡作为一块参与排行，块内从根开始一支读完再读下一支。
 */
export function orderCanvasCardsForReading<T extends CanvasCard>(
  cards: readonly T[],
  connections: readonly CanvasCardConnection[]
): T[] {
  const byId = new Map<CanvasCardId, T>(cards.map(card => [card.id, card]));
  const items: ReadingItem[] = [];
  for (const component of readCanvasCardComponents(
    cards.map(card => card.id),
    connections
  )) {
    const tree = component.length > 1 ? readTreeOrder(component, connections, byId) : null;
    if (!tree) {
      for (const id of component) items.push({ ...box(byId.get(id)!), ids: [id] });
      continue;
    }
    const bounds = canvasBounds(component.map(id => byId.get(id)!))!;
    items.push({ ...bounds, tie: tree[0], ids: tree });
  }
  return readRows(items).flatMap(item => item.ids.map(id => byId.get(id)!));
}
