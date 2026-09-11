import type {
  GeneratedLayoutConstraintEvidence,
  GeneratedLayoutDeclaredConstraints,
} from '@plugin/slides/shared';
import type {
  AbsolutePositionBox,
  FlexProps,
  LayoutNode,
} from './LayoutTypes.js';
import type { LayoutResult } from './YogaAdapter.js';

export function readAbsolutePositionBox(
  position: FlexProps['position'],
): AbsolutePositionBox | undefined {
  return typeof position === 'object' ? position : undefined;
}

export function resolveLayoutPositionMode(props: FlexProps): 'flow' | 'absolute' {
  return props.position === 'absolute'
    || readAbsolutePositionBox(props.position) !== undefined
    || hasImplicitAbsolutePosition(props)
    ? 'absolute'
    : 'flow';
}

export function buildGeneratedLayoutConstraintEvidence(input: {
  result: LayoutResult;
  parent: LayoutResult;
  slideNumber: number;
  nodePath: string;
  parentPath: string;
  grandparent?: LayoutResult;
  grandparentPath?: string;
}): GeneratedLayoutConstraintEvidence {
  const {
    result,
    parent,
    slideNumber,
    nodePath,
    parentPath,
    grandparent,
    grandparentPath,
  } = input;
  const allowedBleedInches = 'bleed' in result.node ? result.node.bleed : undefined;
  if (allowedBleedInches != null && (!Number.isFinite(allowedBleedInches) || allowedBleedInches < 0)) {
    throw new Error('bleed 必须是非负有限英寸数。');
  }
  const declared = readDeclaredConstraints(result.node);
  const finalBox = toGeneratedBox(result.box);
  const parentNode = buildConstraintNode(
    parent,
    slideNumber,
    parentPath,
    grandparentPath,
  );

  return {
    ...(allowedBleedInches != null ? { allowedBleedInches } : {}),
    layoutNodeId: buildLayoutNodeId(slideNumber, nodePath),
    positionMode: resolveLayoutPositionMode(result.node),
    declared,
    finalBox,
    computedRatios: buildComputedRatios(result.node, result.box),
    parent: parentNode,
    ...(grandparent && grandparentPath
      ? {
          parentConstraint: {
            positionMode: resolveLayoutPositionMode(parent.node),
            declared: readDeclaredConstraints(parent.node),
            computedRatios: buildComputedRatios(parent.node, parent.box),
            parent: buildConstraintNode(
              grandparent,
              slideNumber,
              grandparentPath,
              undefined,
            ),
          },
        }
      : {}),
    clipSemantics: 'visible',
  };
}

function buildConstraintNode(
  result: LayoutResult,
  slideNumber: number,
  nodePath: string,
  parentPath: string | undefined,
): GeneratedLayoutConstraintEvidence['parent'] {
  return {
    nodeId: buildLayoutNodeId(slideNumber, nodePath),
    kind: result.node._type === 'Slide' ? 'slide' : 'layout_container',
    label: buildLayoutNodeLabel(result.node),
    finalBox: toGeneratedBox(result.box),
    zIndex: -1,
    ...(parentPath ? { parentNodeId: buildLayoutNodeId(slideNumber, parentPath) } : {}),
    ...(result.node._sourceSpan ? { sourceSpan: result.node._sourceSpan } : {}),
  };
}

function buildComputedRatios(
  node: LayoutNode,
  box: LayoutResult['box'],
): GeneratedLayoutConstraintEvidence['computedRatios'] {
  const declared = readDeclaredConstraints(node);
  return {
    ...(declared.widthInches !== undefined && declared.widthInches > 0
      ? { widthToDeclared: ratio(box.w, declared.widthInches) }
      : {}),
    ...(declared.heightInches !== undefined && declared.heightInches > 0
      ? { heightToDeclared: ratio(box.h, declared.heightInches) }
      : {}),
  };
}

function readDeclaredConstraints(node: LayoutNode): GeneratedLayoutDeclaredConstraints {
  const positionBox = readAbsolutePositionBox(node.position);
  const width = finiteNumber(node.width ?? node.w ?? positionBox?.w);
  const height = finiteNumber(node.height ?? node.h ?? positionBox?.h);
  const minWidth = finiteNumber(node.minWidth);
  const minHeight = finiteNumber(node.minHeight);
  const maxWidth = finiteNumber(node.maxWidth);
  const maxHeight = finiteNumber(node.maxHeight);
  const top = finiteNumber(node.top ?? node.y ?? positionBox?.y);
  const right = finiteNumber(node.right);
  const bottom = finiteNumber(node.bottom);
  const left = finiteNumber(node.left ?? node.x ?? positionBox?.x);
  return {
    ...(width !== undefined ? { widthInches: width } : {}),
    ...(height !== undefined ? { heightInches: height } : {}),
    ...(minWidth !== undefined ? { minWidthInches: minWidth } : {}),
    ...(minHeight !== undefined ? { minHeightInches: minHeight } : {}),
    ...(maxWidth !== undefined ? { maxWidthInches: maxWidth } : {}),
    ...(maxHeight !== undefined ? { maxHeightInches: maxHeight } : {}),
    ...(top !== undefined ? { topInches: top } : {}),
    ...(right !== undefined ? { rightInches: right } : {}),
    ...(bottom !== undefined ? { bottomInches: bottom } : {}),
    ...(left !== undefined ? { leftInches: left } : {}),
  };
}

function finiteNumber(
  value: number | string | undefined,
): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : undefined;
}

function hasImplicitAbsolutePosition(props: FlexProps): boolean {
  return props.top != null
    || props.right != null
    || props.bottom != null
    || props.left != null
    || props.x != null
    || props.y != null;
}

function buildLayoutNodeId(slideNumber: number, path: string): string {
  return `layout:s${slideNumber}:${path}`;
}

function buildLayoutNodeLabel(node: LayoutNode): string {
  const span = node._sourceSpan;
  return span ? `${node._type} L${span.startLine}-${span.endLine}` : node._type;
}

function toGeneratedBox(box: LayoutResult['box']): GeneratedLayoutConstraintEvidence['finalBox'] {
  return {
    x: round4(box.x),
    y: round4(box.y),
    w: round4(box.w),
    h: round4(box.h),
    unit: 'in',
  };
}

function ratio(finalValue: number, declaredValue: number): number {
  return round4(finalValue / declaredValue);
}

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}
