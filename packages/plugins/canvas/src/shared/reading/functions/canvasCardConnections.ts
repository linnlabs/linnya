import type { CanvasCardId, CanvasElement } from '../../model/definitions/canvasElement';

export interface CanvasCardConnection {
  readonly from: CanvasCardId;
  readonly to: CanvasCardId;
}

/** 只取两端都是卡片的连线；端点落在空白处的线不参与结构。 */
export function readCanvasCardConnections(
  elements: readonly CanvasElement[]
): CanvasCardConnection[] {
  return elements.flatMap(element =>
    element.type === 'edge' && element.from.kind === 'card' && element.to.kind === 'card'
      ? [{ from: element.from.cardId, to: element.to.cardId }]
      : []
  );
}

function readNeighbors(connections: readonly CanvasCardConnection[]) {
  const neighbors = new Map<CanvasCardId, CanvasCardId[]>();
  const link = (from: CanvasCardId, to: CanvasCardId) => {
    const list = neighbors.get(from);
    if (list) list.push(to);
    else neighbors.set(from, [to]);
  };
  for (const { from, to } of connections) {
    link(from, to);
    link(to, from);
  }
  return neighbors;
}

/** 不分方向的连通范围；队列迭代，长链不会耗尽调用栈。 */
function collect(
  neighbors: ReadonlyMap<CanvasCardId, readonly CanvasCardId[]>,
  start: CanvasCardId,
  visited: Set<CanvasCardId>
): CanvasCardId[] {
  visited.add(start);
  const queue = [start];
  for (let index = 0; index < queue.length; index++)
    for (const neighbor of neighbors.get(queue[index]) ?? [])
      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        queue.push(neighbor);
      }
  return queue;
}

export function readCanvasCardComponent(
  connections: readonly CanvasCardConnection[],
  start: CanvasCardId
): CanvasCardId[] {
  return collect(readNeighbors(connections), start, new Set());
}

/** 按给定卡片顺序列出各连通范围；连线只在所给卡片之间有效。 */
export function readCanvasCardComponents(
  ids: readonly CanvasCardId[],
  connections: readonly CanvasCardConnection[]
): CanvasCardId[][] {
  const known = new Set(ids),
    neighbors = readNeighbors(
      connections.filter(({ from, to }) => known.has(from) && known.has(to))
    ),
    visited = new Set<CanvasCardId>();
  return ids.flatMap(id => (visited.has(id) ? [] : [collect(neighbors, id, visited)]));
}
