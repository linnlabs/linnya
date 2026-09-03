import type {
  GeneratedLayoutBox,
  GeneratedLayoutComputedRatios,
  GeneratedLayoutConstraintNode,
  GeneratedLayoutDeclaredConstraints,
  SlideElementInfo,
} from '@plugin/slides/shared';
import type {
  DiagnosticNodeRef,
  QualityDiagnosticDraft,
} from './definitions';
import { buildDiagnosticNodeRef } from './functions/buildDiagnosticNodeRef';

type PositionedElement = SlideElementInfo & {
  position: NonNullable<SlideElementInfo['position']>;
};
type GeneratedConstraintIssue = Extract<QualityDiagnosticDraft, {
  code: 'layout_constraint_compressed' | 'descendant_outside_computed_parent';
}>;

interface ConstraintSubject {
  readonly layoutNodeId: string;
  readonly positionMode: 'flow' | 'absolute';
  readonly declared: GeneratedLayoutDeclaredConstraints;
  readonly computedRatios: GeneratedLayoutComputedRatios;
  readonly finalBox: GeneratedLayoutBox;
  readonly node: DiagnosticNodeRef;
  readonly parent: DiagnosticNodeRef;
}

interface OverflowGroup {
  readonly parent: GeneratedLayoutConstraintNode;
  readonly descendants: Map<string, DiagnosticNodeRef>;
  readonly sides: Set<'left' | 'right' | 'top' | 'bottom'>;
  readonly rootCauseKey?: string;
}

const CONSTRAINT_COMPRESSION_RATIO = 0.8;
const PARENT_OVERFLOW_TOLERANCE_INCHES = 0.01;

/**
 * 只消费 Flex compiler 提供的 generated-only 事实，禁止从最终盒反推作者约束。
 */
export function lintGeneratedLayoutConstraints(
  slideNumber: number,
  elements: readonly PositionedElement[],
): GeneratedConstraintIssue[] {
  const rootIssues = lintCompressedConstraints(slideNumber, elements);
  const rootCauseKeys = new Set(
    rootIssues.flatMap((issue) => issue.rootCauseKey ? [issue.rootCauseKey] : []),
  );
  return [
    ...rootIssues,
    ...lintComputedParentOverflow(slideNumber, elements, rootCauseKeys),
  ];
}

function lintCompressedConstraints(
  slideNumber: number,
  elements: readonly PositionedElement[],
): GeneratedConstraintIssue[] {
  const subjects = collectConstraintSubjects(elements);
  const issues: GeneratedConstraintIssue[] = [];

  for (const subject of subjects.values()) {
    if (subject.positionMode !== 'flow') continue;
    const axisFacts = [
      {
        axis: 'horizontal' as const,
        declared: subject.declared.widthInches,
        final: subject.finalBox.w,
        ratio: subject.computedRatios.widthToDeclared,
        min: subject.declared.minWidthInches,
        max: subject.declared.maxWidthInches,
      },
      {
        axis: 'vertical' as const,
        declared: subject.declared.heightInches,
        final: subject.finalBox.h,
        ratio: subject.computedRatios.heightToDeclared,
        min: subject.declared.minHeightInches,
        max: subject.declared.maxHeightInches,
      },
    ];

    for (const fact of axisFacts) {
      if (fact.declared === undefined || fact.declared <= 0) continue;
      if (fact.ratio === undefined || fact.ratio >= CONSTRAINT_COMPRESSION_RATIO) continue;

      const rootCauseKey = constraintRootCauseKey(subject.layoutNodeId, fact.axis);
      issues.push({
        code: 'layout_constraint_compressed',
        severity: 'warning',
        confidence: 'high',
        slides: [slideNumber],
        rootCauseKey,
        evidence: {
          kind: 'constraint_delta',
          node: subject.node,
          parent: subject.parent,
          axis: fact.axis,
          positionMode: subject.positionMode,
          declaredInches: fact.declared,
          finalInches: fact.final,
          ...(fact.min !== undefined ? { minInches: fact.min } : {}),
          ...(fact.max !== undefined ? { maxInches: fact.max } : {}),
          finalToDeclaredRatio: fact.ratio,
        },
      });
    }
  }

  return issues;
}

function collectConstraintSubjects(
  elements: readonly PositionedElement[],
): Map<string, ConstraintSubject> {
  const subjects = new Map<string, ConstraintSubject>();

  // 可渲染节点优先，确保有背景的 View 仍指向可直接编辑的 RenderNode。
  for (const element of elements) {
    const trace = element.layoutConstraintEvidence;
    if (!trace) continue;
    subjects.set(trace.layoutNodeId, {
      layoutNodeId: trace.layoutNodeId,
      positionMode: trace.positionMode,
      declared: trace.declared,
      computedRatios: trace.computedRatios,
      finalBox: trace.finalBox,
      node: buildDiagnosticNodeRef(element),
      parent: buildConstraintNodeRef(trace.parent),
    });
  }

  // 无装饰 View 没有 RenderNode；其直接后代携带的 parentConstraint 是唯一权威事实。
  for (const element of elements) {
    const trace = element.layoutConstraintEvidence;
    const parentConstraint = trace?.parentConstraint;
    if (!trace || !parentConstraint || subjects.has(trace.parent.nodeId)) continue;
    subjects.set(trace.parent.nodeId, {
      layoutNodeId: trace.parent.nodeId,
      positionMode: parentConstraint.positionMode,
      declared: parentConstraint.declared,
      computedRatios: parentConstraint.computedRatios,
      finalBox: trace.parent.finalBox,
      node: buildConstraintNodeRef(trace.parent),
      parent: buildConstraintNodeRef(parentConstraint.parent),
    });
  }

  return subjects;
}

function lintComputedParentOverflow(
  slideNumber: number,
  elements: readonly PositionedElement[],
  rootCauseKeys: ReadonlySet<string>,
): GeneratedConstraintIssue[] {
  const groups = new Map<string, OverflowGroup>();

  for (const element of elements) {
    const trace = element.layoutConstraintEvidence;
    if (!trace || trace.positionMode !== 'absolute' || trace.parent.kind === 'slide') continue;
    if (element.type === 'shape' && !element.text) continue;

    const overflowSides = computedParentOverflowSides(
      trace.finalBox,
      trace.parent.finalBox,
      PARENT_OVERFLOW_TOLERANCE_INCHES,
    );
    if (overflowSides.length === 0) continue;

    const candidateGroups = [
      {
        rootCauseKey: findRootCauseKey(trace.parent.nodeId, 'horizontal', rootCauseKeys),
        sides: overflowSides.filter((side) => side === 'left' || side === 'right'),
      },
      {
        rootCauseKey: findRootCauseKey(trace.parent.nodeId, 'vertical', rootCauseKeys),
        sides: overflowSides.filter((side) => side === 'top' || side === 'bottom'),
      },
    ].filter((candidate) => candidate.sides.length > 0);

    for (const candidate of candidateGroups) {
      const groupKey = candidate.rootCauseKey ?? `parent-overflow:${trace.parent.nodeId}`;
      const group = groups.get(groupKey) ?? {
        parent: trace.parent,
        descendants: new Map(),
        sides: new Set(),
        ...(candidate.rootCauseKey ? { rootCauseKey: candidate.rootCauseKey } : {}),
      };
      const node = buildDiagnosticNodeRef(element);
      group.descendants.set(node.nodeId, node);
      candidate.sides.forEach((side) => group.sides.add(side));
      groups.set(groupKey, group);
    }
  }

  return [...groups.values()].map((group) => ({
    code: 'descendant_outside_computed_parent',
    severity: 'warning',
    confidence: 'high',
    slides: [slideNumber],
    ...(group.rootCauseKey ? { rootCauseKey: group.rootCauseKey } : {}),
    evidence: {
      kind: 'parent_overflow',
      parent: buildConstraintNodeRef(group.parent),
      descendants: [...group.descendants.values()].sort(
        (left, right) => left.nodeId.localeCompare(right.nodeId),
      ),
      overflowSides: [...group.sides].sort(),
      clipSemantics: 'visible',
    },
  }));
}

function findRootCauseKey(
  layoutNodeId: string,
  axis: 'horizontal' | 'vertical',
  rootCauseKeys: ReadonlySet<string>,
): string | undefined {
  const key = constraintRootCauseKey(layoutNodeId, axis);
  return rootCauseKeys.has(key) ? key : undefined;
}

function buildConstraintNodeRef(parent: GeneratedLayoutConstraintNode): DiagnosticNodeRef {
  return {
    nodeId: parent.nodeId,
    kind: parent.kind,
    label: parent.label,
    finalBox: parent.finalBox,
    zIndex: parent.zIndex,
    ...(parent.parentNodeId ? { parentNodeId: parent.parentNodeId } : {}),
  };
}

function constraintRootCauseKey(
  layoutNodeId: string,
  axis: 'horizontal' | 'vertical',
): string {
  return `layout-constraint:${layoutNodeId}:${axis}`;
}

function computedParentOverflowSides(
  child: GeneratedLayoutBox,
  parent: GeneratedLayoutBox,
  tolerance: number,
): Array<'left' | 'right' | 'top' | 'bottom'> {
  const sides: Array<'left' | 'right' | 'top' | 'bottom'> = [];
  if (child.x < parent.x - tolerance) sides.push('left');
  if (child.x + child.w > parent.x + parent.w + tolerance) sides.push('right');
  if (child.y < parent.y - tolerance) sides.push('top');
  if (child.y + child.h > parent.y + parent.h + tolerance) sides.push('bottom');
  return sides;
}
