import type { CanvasCommand } from '../../changeset/definitions/canvasCommands';
import type { CanvasRectangle } from '../../geometry/definitions/canvasGeometry';
import type {
  CanvasCard,
  CanvasCardId,
  CanvasElement,
  CanvasSectionCard,
} from '../definitions/canvasElement';

/** 分区内边距：标题占上方一条，其余三边留白；成员卡始终落在这圈之内。 */
export const CANVAS_SECTION_PADDING = 24;
export const CANVAS_SECTION_HEADER = 48;
export const CANVAS_SECTION_DEFAULT_WIDTH = 360;
export const CANVAS_SECTION_DEFAULT_HEIGHT = 240;
/** 区与区排布时的间隔：染纸色差本身就是边界，只留一道窄缝。 */
export const CANVAS_SECTION_GAP = 24;

export function isCanvasSection(element: CanvasElement): element is CanvasSectionCard {
  return element.type === 'section';
}

/** 能命中、拖动分区的只有标题条；其余区域留给框选、新建与放卡。 */
export function canvasSectionHeader(section: CanvasRectangle): CanvasRectangle {
  return {
    x: section.x,
    y: section.y,
    width: section.width,
    height: Math.min(CANVAS_SECTION_HEADER, section.height),
  };
}

/** 包住成员所需的最小外框；没有成员时为 null。 */
export function canvasSectionContentBounds(
  members: readonly CanvasRectangle[]
): CanvasRectangle | null {
  if (!members.length) return null;
  const left = Math.min(...members.map(member => member.x)),
    top = Math.min(...members.map(member => member.y)),
    right = Math.max(...members.map(member => member.x + member.width)),
    bottom = Math.max(...members.map(member => member.y + member.height));
  return {
    x: left - CANVAS_SECTION_PADDING,
    y: top - CANVAS_SECTION_HEADER,
    width: right - left + CANVAS_SECTION_PADDING * 2,
    height: bottom - top + CANVAS_SECTION_HEADER + CANVAS_SECTION_PADDING,
  };
}

/** 分区只向外长：用户拉大的空位保留，成员越界时撑开到刚好包住。 */
export function fitCanvasSection(
  section: CanvasRectangle,
  members: readonly CanvasRectangle[]
): CanvasRectangle {
  const content = canvasSectionContentBounds(members);
  if (!content) return section;
  const x = Math.min(section.x, content.x),
    y = Math.min(section.y, content.y);
  return {
    x,
    y,
    width: Math.max(section.x + section.width, content.x + content.width) - x,
    height: Math.max(section.y + section.height, content.y + content.height) - y,
  };
}

/** 卡片中心落在哪个分区里；重叠时取最小的那块（更贴近用户的意图）。 */
export function findCanvasSectionAt(
  elements: readonly CanvasElement[],
  rectangle: CanvasRectangle,
  excluded: ReadonlySet<CanvasCardId> = new Set()
): CanvasSectionCard | null {
  const x = rectangle.x + rectangle.width / 2,
    y = rectangle.y + rectangle.height / 2;
  let found: CanvasSectionCard | null = null;
  for (const element of elements) {
    if (!isCanvasSection(element) || excluded.has(element.id)) continue;
    if (
      x < element.x ||
      y < element.y + Math.min(CANVAS_SECTION_HEADER, element.height) ||
      x > element.x + element.width ||
      y > element.y + element.height
    )
      continue;
    if (!found || element.width * element.height < found.width * found.height) found = element;
  }
  return found;
}

/** 按分区归组成员；不属于任何分区的卡不在结果里。 */
export function readCanvasSectionMembers(
  elements: readonly CanvasElement[]
): ReadonlyMap<CanvasCardId, readonly CanvasCard[]> {
  const sections = new Set(elements.filter(isCanvasSection).map(section => section.id));
  const members = new Map<CanvasCardId, CanvasCard[]>();
  for (const element of elements) {
    if (element.type === 'edge' || !element.parentId || !sections.has(element.parentId)) continue;
    const list = members.get(element.parentId) ?? [];
    list.push(element);
    members.set(element.parentId, list);
  }
  return members;
}

/**
 * 用户在界面里新建、拖动、粘贴卡片时，按卡片落点决定归属：中心落在哪个分区就进哪个分区，
 * 拖出去就离开。分区和成员一起移动时成员不换区；调用方已显式给出归属的操作不改。
 */
export function assignCanvasSections(
  elements: readonly CanvasElement[],
  operations: readonly CanvasCommand[]
): CanvasCommand[] {
  if (!operations.length || !elements.some(isCanvasSection)) return [...operations];
  const current = new Map<string, CanvasCard>(
    elements.flatMap(element => (element.type === 'edge' ? [] : [[element.id, element] as const]))
  );
  const deleted = new Set(operations.flatMap(op => (op.op === 'delete' ? [op.id] : [])));
  const moved = new Map<string, CanvasRectangle>();
  for (const op of operations)
    if (op.op === 'update' && current.has(op.id)) {
      const base = moved.get(op.id) ?? current.get(op.id)!;
      moved.set(op.id, {
        x: op.patch.x ?? base.x,
        y: op.patch.y ?? base.y,
        width: op.patch.width ?? base.width,
        height: op.patch.height ?? base.height,
      });
    }
  const sections = elements
    .filter(isCanvasSection)
    .filter(section => !deleted.has(section.id))
    .map(section => ({ ...section, ...moved.get(section.id) }));
  const shifted = new Set<CanvasCardId>(
    sections
      .filter(section => {
        const before = current.get(section.id)!;
        return before.x !== section.x || before.y !== section.y;
      })
      .map(section => section.id)
  );
  return operations.map(op =>
    op.op === 'update'
      ? assignMovedCard(op, { current, moved, sections, shifted })
      : assignAddedCard(op, sections)
  );
}

function assignAddedCard(op: CanvasCommand, sections: readonly CanvasSectionCard[]): CanvasCommand {
  if (op.op !== 'addText' && op.op !== 'addImage' && op.op !== 'addDocument') return op;
  if (op.parentId !== undefined || op.x === undefined || op.y === undefined) return op;
  const section = findCanvasSectionAt(sections, {
    x: op.x,
    y: op.y,
    width: op.width,
    height: op.height,
  });
  return section ? { ...op, parentId: section.id } : op;
}

interface MovedBatch {
  readonly current: ReadonlyMap<string, CanvasCard>;
  readonly moved: ReadonlyMap<string, CanvasRectangle>;
  readonly sections: readonly CanvasSectionCard[];
  readonly shifted: ReadonlySet<CanvasCardId>;
}
function assignMovedCard(
  op: Extract<CanvasCommand, { op: 'update' }>,
  batch: MovedBatch
): CanvasCommand {
  const { current, moved, sections, shifted } = batch;
  const position = moved.get(op.id),
    card = current.get(op.id);
  if (op.patch.parentId !== undefined || (op.patch.x === undefined && op.patch.y === undefined))
    return op;
  if (!card || !position || card.type === 'section') return op;
  if (card.parentId && shifted.has(card.parentId)) return op;
  const next = findCanvasSectionAt(sections, position)?.id ?? null;
  return next === card.parentId ? op : { ...op, patch: { ...op.patch, parentId: next } };
}
