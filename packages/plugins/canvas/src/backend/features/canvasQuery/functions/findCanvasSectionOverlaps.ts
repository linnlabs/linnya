import {
  canvasRectanglesOverlap,
  type CanvasElement,
  type CanvasLayoutDiagnostic,
  type CanvasSectionCard,
} from '../../../../shared';

const sectionsOf = (elements: readonly CanvasElement[]) =>
  elements.filter((element): element is CanvasSectionCard => element.type === 'section');
const sameBox = (a: CanvasSectionCard, b: CanvasSectionCard | undefined) =>
  !!b && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;

/**
 * 这一批让分区压到了相邻分区：只报至少一方位置或大小在本批变过的重叠对，
 * 原本就重叠且都没动的不重复提醒。提交时不自动推开，由 Agent 只整理分区。
 */
export function findCanvasSectionOverlaps(
  before: readonly CanvasElement[],
  after: readonly CanvasElement[]
): CanvasLayoutDiagnostic[] {
  const previous = new Map(sectionsOf(before).map(section => [section.id, section]));
  const sections = sectionsOf(after);
  const pairs: [string, string][] = [];
  for (let i = 0; i < sections.length; i++)
    for (let j = i + 1; j < sections.length; j++) {
      const [a, b] = [sections[i], sections[j]];
      const moved = !sameBox(a, previous.get(a.id)) || !sameBox(b, previous.get(b.id));
      if (moved && canvasRectanglesOverlap(a, b)) pairs.push([a.id, b.id]);
    }
  if (!pairs.length) return [];
  const all = sections.map(section => section.id).join(',');
  return pairs.map(([a, b]) => ({
    code: 'section_overlap',
    elementIds: [a, b],
    message: `分区 ${a} 与 ${b} 重叠。用 arrange --scope ${all} 只整理分区：成员随分区整体移动，区内摆放不变。`,
  }));
}
