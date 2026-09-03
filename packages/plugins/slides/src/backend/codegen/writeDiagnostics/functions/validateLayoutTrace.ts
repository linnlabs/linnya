import type { SlideSourceRange } from '@plugin/slides/shared';
import type { LayoutTraceNode, LayoutTraceSnapshot } from '../../../sandbox/layoutTrace';
import type { StructureCodegenDiagnostic } from '../definitions/codegenDiagnostic';

export function validateLayoutTrace(
  trace: LayoutTraceSnapshot,
  slideRanges: readonly SlideSourceRange[],
): StructureCodegenDiagnostic[] {
  if (trace.truncated) return [];

  const nodesById = new Map(trace.nodes.map((node) => [node.id, node]));
  const parentIdsByChild = buildParentIdsByChild(trace.nodes);
  const reachable = collectReachableNodeIds(trace.roots, nodesById);
  const diagnostics: StructureCodegenDiagnostic[] = [];

  for (const node of trace.nodes) {
    if (reachable.has(node.id) || hasUnreachableParent(node.id, parentIdsByChild, reachable)) continue;

    const containsContent = subtreeContainsContent(node.id, nodesById);
    const sourceSpan = { startLine: node.startLine, endLine: node.endLine };
    const slideNumber = findSlideNumber(node.startLine, slideRanges);

    if (containsContent) {
      const isContainer = node.type === 'View' || node.type === 'Slide';
      diagnostics.push({
        phase: 'structure',
        severity: 'warning',
        code: isContainer
          ? 'LAYOUT_UNATTACHED_CONTENT_SUBTREE'
          : 'LAYOUT_UNATTACHED_RENDERABLE_NODE',
        message: isContainer
          ? '该容器包含可见内容，但没有通过 .add(...) 加入最终页面层级，因此整个容器及其内容都不会渲染。'
          : '该可见元素已创建，但没有通过 .add(...) 加入最终页面层级，因此不会渲染。',
        hint: isContainer
          ? '检查该行对应的容器变量是否漏写 slide.add(variable) 或 parent.add(variable)，以及 .add(...) 的父容器是否写错。'
          : '检查该行对应的元素变量，并通过 slide.add(variable) 或 parent.add(variable) 将它加入当前页面。',
        ...(slideNumber ? { slideNumber } : {}),
        sourceSpan,
      });
      continue;
    }

    if (node.type === 'View' && node.configured) {
      diagnostics.push({
        phase: 'structure',
        severity: 'warning',
        code: 'LAYOUT_UNATTACHED_CONFIGURED_CONTAINER',
        message: '该 Frame 已设置布局属性，但没有通过 .add(...) 加入最终页面层级，因此这些设置不会生效。',
        hint: '检查创建该 Frame 的 helper 参数，并确认没有漏写 slide.add(variable) 或 parent.add(variable)，且父容器选择正确。',
        ...(slideNumber ? { slideNumber } : {}),
        sourceSpan,
      });
    }
  }

  return diagnostics;
}

function buildParentIdsByChild(nodes: readonly LayoutTraceNode[]): Map<number, Set<number>> {
  const result = new Map<number, Set<number>>();
  for (const node of nodes) {
    for (const childId of node.children) {
      const parents = result.get(childId) ?? new Set<number>();
      parents.add(node.id);
      result.set(childId, parents);
    }
  }
  return result;
}

function collectReachableNodeIds(
  roots: readonly number[],
  nodesById: ReadonlyMap<number, LayoutTraceNode>,
): Set<number> {
  const reachable = new Set<number>();
  const pending = [...roots];
  while (pending.length > 0) {
    const id = pending.pop();
    if (id === undefined || reachable.has(id)) continue;
    reachable.add(id);
    const node = nodesById.get(id);
    if (node) pending.push(...node.children);
  }
  return reachable;
}

function hasUnreachableParent(
  nodeId: number,
  parentIdsByChild: ReadonlyMap<number, ReadonlySet<number>>,
  reachable: ReadonlySet<number>,
): boolean {
  const parents = parentIdsByChild.get(nodeId);
  if (!parents) return false;
  return [...parents].some((parentId) => !reachable.has(parentId));
}

function subtreeContainsContent(
  rootId: number,
  nodesById: ReadonlyMap<number, LayoutTraceNode>,
): boolean {
  const visited = new Set<number>();
  const pending = [rootId];
  while (pending.length > 0) {
    const id = pending.pop();
    if (id === undefined || visited.has(id)) continue;
    visited.add(id);
    const node = nodesById.get(id);
    if (!node) continue;
    if (node.content) return true;
    pending.push(...node.children);
  }
  return false;
}

function findSlideNumber(
  line: number,
  slideRanges: readonly SlideSourceRange[],
): number | undefined {
  return slideRanges.find((range) => line >= range.startLine && line <= range.endLine)?.slideNumber;
}
