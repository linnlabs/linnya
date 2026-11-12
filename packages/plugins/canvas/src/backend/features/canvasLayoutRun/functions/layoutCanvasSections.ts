import {
  CANVAS_SECTION_GAP,
  CANVAS_SECTION_HEADER,
  CANVAS_SECTION_PADDING,
  orderCanvasCardsForReading,
  readCanvasCardConnections,
  type CanvasCard,
  type CanvasCardId,
  type CanvasEdge,
  type CanvasLayoutDiagnostic,
  type CanvasLayoutRequest,
  type CanvasRectangle,
  type CanvasSectionCard,
} from '../../../../shared';
import type {
  CanvasLayoutAlgorithm,
  CanvasLayoutPosition,
  CanvasLayoutScope,
} from '../definitions/canvasLayoutPlan';
import { layoutCanvasGrid } from './layoutCanvasGrid';
import { layoutCanvasTree } from './layoutCanvasTree';
import { placeCanvasLayoutApart } from './placeCanvasLayoutApart';

const BLOCK_GAP = 40;

export interface CanvasSectionLayout {
  readonly positions: readonly CanvasLayoutPosition[];
  readonly sizes: ReadonlyMap<CanvasCardId, { readonly width: number; readonly height: number }>;
  readonly occupied: readonly CanvasRectangle[];
  readonly handled: ReadonlySet<CanvasCardId>;
  readonly diagnostics: readonly CanvasLayoutDiagnostic[];
}

const extent = (positions: readonly CanvasLayoutPosition[], cards: readonly CanvasCard[]) => {
  const byId = new Map(cards.map(card => [card.id, card]));
  return {
    width: Math.max(0, ...positions.map(p => p.x + (byId.get(p.id)?.width ?? 0))),
    height: Math.max(0, ...positions.map(p => p.y + (byId.get(p.id)?.height ?? 0))),
  };
};
const normalize = (positions: readonly CanvasLayoutPosition[]) => {
  if (!positions.length) return positions;
  const left = Math.min(...positions.map(p => p.x)),
    top = Math.min(...positions.map(p => p.y));
  return positions.map(p => ({ ...p, x: p.x - left, y: p.y - top }));
};

interface MemberLayoutContext {
  readonly request: CanvasLayoutRequest;
  readonly layered: CanvasLayoutAlgorithm;
  readonly diagnostics: CanvasLayoutDiagnostic[];
}
/** 区内：有连线的卡按所选算法排成行，没有连线的卡在下方排成网格；起点为 (0,0)。 */
async function layoutMembers(
  cards: readonly CanvasCard[],
  edges: readonly CanvasEdge[],
  { request, layered, diagnostics }: MemberLayoutContext
): Promise<readonly CanvasLayoutPosition[]> {
  if (request.algorithm === 'grid') return normalize(layoutCanvasGrid(cards, request.columns));
  const linked = new Set(
    edges.flatMap(edge =>
      edge.from.kind === 'card' && edge.to.kind === 'card' ? [edge.from.cardId, edge.to.cardId] : []
    )
  );
  const connected = cards.filter(card => linked.has(card.id)),
    loose = cards.filter(card => !linked.has(card.id));
  let block: readonly CanvasLayoutPosition[] = [];
  if (connected.length && request.algorithm === 'tree') {
    const tree = layoutCanvasTree(connected, edges, request.direction);
    diagnostics.push(...tree.diagnostics);
    block = normalize(tree.positions);
  } else if (connected.length) block = normalize(await layered(connected, edges, request));
  const top = block.length ? extent(block, connected).height + BLOCK_GAP : 0;
  const grid = normalize(layoutCanvasGrid(loose, request.columns)).map(p => ({
    ...p,
    y: p.y + top,
  }));
  return [...block, ...grid];
}

/** 区按阅读顺序逐行摆，一行不超过总面积开方的约 1.6 倍，区与区只隔一道窄缝。 */
function packSections(
  sections: readonly CanvasSectionCard[],
  direction: 'right' | 'down'
): readonly CanvasLayoutPosition[] {
  const area = sections.reduce((sum, s) => sum + (s.width + CANVAS_SECTION_GAP) ** 2, 0);
  const along = (s: { width: number; height: number }) =>
    direction === 'right' ? s.width : s.height;
  const limit = Math.max(...sections.map(along), Math.sqrt(area) * 1.6);
  const positions: CanvasLayoutPosition[] = [];
  let main = 0,
    cross = 0,
    line = 0;
  for (const section of sections) {
    if (main > 0 && main + along(section) > limit) {
      cross += line + CANVAS_SECTION_GAP;
      main = 0;
      line = 0;
    }
    positions.push(
      direction === 'right'
        ? { id: section.id, x: main, y: cross }
        : { id: section.id, x: cross, y: main }
    );
    main += along(section) + CANVAS_SECTION_GAP;
    line = Math.max(line, direction === 'right' ? section.height : section.width);
  }
  return positions;
}

/** 范围内的分区，加上范围内卡片所在的分区。 */
function collectSections(request: CanvasLayoutRequest, scope: CanvasLayoutScope) {
  const sections = new Map<CanvasCardId, CanvasSectionCard>();
  for (const element of request.snapshot.elements)
    if (element.type === 'section') sections.set(element.id, element);
  const parents = new Set(scope.cards.flatMap(card => (card.parentId ? [card.parentId] : [])));
  const scoped = new Set(scope.cards.map(card => card.id));
  return new Map([...sections].filter(([id]) => scoped.has(id) || parents.has(id)));
}

interface SectionMembersLayout {
  /** 这次要摆的成员：范围内重排的，加上随分区整体平移的。 */
  readonly members: readonly CanvasCard[];
  /** 相对内容区左上角（标题下、内边距内）的位置。 */
  readonly positions: readonly CanvasLayoutPosition[];
  /** 区内有锁定或正在编辑的成员：分区不动，免得框和卡分开。 */
  readonly pinned: boolean;
  /** 范围内有成员要重排；否则分区整体平移，大小不变。 */
  readonly arranged: boolean;
}
const offsetIn = (section: CanvasSectionCard, card: CanvasCard): CanvasLayoutPosition => ({
  id: card.id,
  x: card.x - section.x - CANVAS_SECTION_PADDING,
  y: card.y - section.y - CANVAS_SECTION_HEADER,
});
/**
 * 范围内的成员重排；不在范围内的成员保持在区内的相对位置，随分区一起走，
 * 重排的成员接在它们下方。只给分区 ID 时就是整区平移，区内摆放不变。
 */
async function layoutSection(
  section: CanvasSectionCard,
  scope: CanvasLayoutScope,
  context: MemberLayoutContext
): Promise<SectionMembersLayout> {
  const scoped = new Set(scope.cards.map(card => card.id));
  const all = context.request.snapshot.elements.filter(
    (element): element is CanvasCard => element.type !== 'edge' && element.parentId === section.id
  );
  const members = all.filter(card => scoped.has(card.id)),
    rest = all.filter(card => !scoped.has(card.id));
  const protectedIds = new Set(context.request.protectedElementIds);
  const pinned = rest.some(card => card.locked || protectedIds.has(card.id));
  const ids = new Set(members.map(card => card.id));
  const edges = scope.edges.filter(
    edge =>
      edge.from.kind === 'card' &&
      edge.to.kind === 'card' &&
      ids.has(edge.from.cardId) &&
      ids.has(edge.to.cardId)
  );
  const kept = rest.map(card => offsetIn(section, card));
  const top = rest.length ? extent(kept, rest).height + BLOCK_GAP : 0;
  const arranged = (await layoutMembers(members, edges, context)).map(p => ({
    ...p,
    y: p.y + top,
  }));
  return {
    members: pinned ? members : [...rest, ...members],
    positions: pinned ? arranged : [...kept, ...arranged],
    pinned,
    arranged: members.length > 0,
  };
}

/** 有成员重排且可移动的分区收紧到刚好包住成员；整区平移或不可移动的保持原尺寸。 */
function sizeSection(section: CanvasSectionCard, layout: SectionMembersLayout, movable: boolean) {
  if (!layout.arranged || !movable || layout.pinned) return section;
  const size = extent(layout.positions, layout.members);
  return {
    ...section,
    width: size.width + CANVAS_SECTION_PADDING * 2,
    height: size.height + CANVAS_SECTION_HEADER + CANVAS_SECTION_PADDING,
  };
}

/**
 * 按分区排布：范围内的分区与范围内卡片所在的分区各自排好成员，可移动的分区收紧到刚好包住成员，
 * 再按阅读顺序紧挨着摆，整体避开范围外的障碍；不可移动的分区原地排它的成员。
 */
export async function layoutCanvasSections(
  request: CanvasLayoutRequest,
  scope: CanvasLayoutScope,
  layered: CanvasLayoutAlgorithm
): Promise<CanvasSectionLayout | null> {
  const sections = collectSections(request, scope);
  if (!sections.size) return null;
  const movable = new Set<CanvasCardId>(scope.cards.map(card => card.id));
  const context: MemberLayoutContext = { request, layered, diagnostics: [] };
  const handled = new Set<CanvasCardId>(sections.keys());
  const local = new Map<CanvasCardId, readonly CanvasLayoutPosition[]>();
  const sized: CanvasSectionCard[] = [];
  for (const section of sections.values()) {
    const layout = await layoutSection(section, scope, context);
    if (layout.pinned) movable.delete(section.id);
    for (const card of layout.members) handled.add(card.id);
    local.set(section.id, layout.positions);
    sized.push(sizeSection(section, layout, movable.has(section.id)));
  }
  const moving = orderCanvasCardsForReading(
    sized.filter(section => movable.has(section.id)),
    readCanvasCardConnections(request.snapshot.elements)
  );
  // 留在原地的分区（不可移动或被区内锁定成员钉住）也是要避开的障碍。
  const obstacles: CanvasRectangle[] = [
    ...scope.obstacles.filter(
      card => !sections.has(card.id) && !(card.parentId && sections.has(card.parentId))
    ),
    ...sized.filter(section => !movable.has(section.id)),
  ];
  const origin = moving.length
    ? placeCanvasLayoutApart(packSections(moving, request.direction), moving, obstacles, 'down')
    : [];
  return {
    ...placeMembers(sized, origin, local, movable),
    handled,
    diagnostics: context.diagnostics,
  };
}

function placeMembers(
  sized: readonly CanvasSectionCard[],
  origin: readonly CanvasLayoutPosition[],
  local: ReadonlyMap<CanvasCardId, readonly CanvasLayoutPosition[]>,
  movable: ReadonlySet<CanvasCardId>
) {
  const origins = new Map(origin.map(p => [p.id, p]));
  const positions: CanvasLayoutPosition[] = [...origin];
  const sizes = new Map<CanvasCardId, { width: number; height: number }>();
  const occupied: CanvasRectangle[] = [];
  for (const section of sized) {
    const at = origins.get(section.id) ?? section;
    if (movable.has(section.id))
      sizes.set(section.id, { width: section.width, height: section.height });
    occupied.push({ x: at.x, y: at.y, width: section.width, height: section.height });
    for (const p of local.get(section.id) ?? [])
      positions.push({
        id: p.id,
        x: at.x + CANVAS_SECTION_PADDING + p.x,
        y: at.y + CANVAS_SECTION_HEADER + p.y,
      });
  }
  return { positions, sizes, occupied };
}
