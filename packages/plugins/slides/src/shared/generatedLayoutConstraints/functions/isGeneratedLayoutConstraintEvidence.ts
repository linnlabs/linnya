import type {
  GeneratedLayoutBox,
  GeneratedLayoutConstraintEvidence,
  GeneratedLayoutConstraintNode,
  GeneratedLayoutDeclaredConstraints,
  GeneratedLayoutSourceSpan,
  GeneratedParentLayoutConstraintFacts,
} from '../definitions/generatedLayoutConstraintEvidence';

/**
 * 校验 Flex 编译器跨线程、持久化与 Renderer 传递的内部布局事实。
 * 该守卫是合同唯一入口，避免各消费端对内部字段的接受范围逐渐漂移。
 */
export function isGeneratedLayoutConstraintEvidence(
  value: unknown,
): value is GeneratedLayoutConstraintEvidence {
  return isRecord(value)
    && hasOnlyKeys(value, [
      'intrinsicTextAdvanceSource',
      'allowedBleedInches',
      'layoutNodeId',
      'positionMode',
      'declared',
      'finalBox',
      'computedRatios',
      'parent',
      'parentConstraint',
      'clipSemantics',
    ])
    && (value.intrinsicTextAdvanceSource === undefined
      || value.intrinsicTextAdvanceSource === 'harfbuzz' || value.intrinsicTextAdvanceSource === 'pretext'
      || value.intrinsicTextAdvanceSource === 'heuristic' || value.intrinsicTextAdvanceSource === 'mixed')
    && (value.allowedBleedInches === undefined
      || (isFiniteNumber(value.allowedBleedInches) && value.allowedBleedInches >= 0))
    && isNonEmptyString(value.layoutNodeId)
    && isPositionMode(value.positionMode)
    && isGeneratedLayoutDeclaredConstraints(value.declared)
    && isGeneratedLayoutBox(value.finalBox)
    && isGeneratedLayoutComputedRatios(value.computedRatios)
    && isGeneratedLayoutConstraintNode(value.parent)
    && (value.parentConstraint === undefined
      || isGeneratedParentLayoutConstraintFacts(value.parentConstraint))
    && value.clipSemantics === 'visible';
}

function isGeneratedParentLayoutConstraintFacts(
  value: unknown,
): value is GeneratedParentLayoutConstraintFacts {
  return isRecord(value)
    && hasOnlyKeys(value, ['positionMode', 'declared', 'computedRatios', 'parent'])
    && isPositionMode(value.positionMode)
    && isGeneratedLayoutDeclaredConstraints(value.declared)
    && isGeneratedLayoutComputedRatios(value.computedRatios)
    && isGeneratedLayoutConstraintNode(value.parent);
}

function isGeneratedLayoutDeclaredConstraints(
  value: unknown,
): value is GeneratedLayoutDeclaredConstraints {
  return isRecord(value)
    && hasOnlyKeys(value, [
      'widthInches',
      'heightInches',
      'minWidthInches',
      'minHeightInches',
      'maxWidthInches',
      'maxHeightInches',
      'topInches',
      'rightInches',
      'bottomInches',
      'leftInches',
    ])
    && Object.values(value).every(isFiniteNumber);
}

function isGeneratedLayoutComputedRatios(value: unknown): boolean {
  return isRecord(value)
    && hasOnlyKeys(value, ['widthToDeclared', 'heightToDeclared'])
    && Object.values(value).every(ratio => isFiniteNumber(ratio) && ratio >= 0);
}

function isGeneratedLayoutConstraintNode(
  value: unknown,
): value is GeneratedLayoutConstraintNode {
  return isRecord(value)
    && hasOnlyKeys(value, [
      'nodeId',
      'kind',
      'label',
      'finalBox',
      'zIndex',
      'parentNodeId',
      'sourceSpan',
    ])
    && isNonEmptyString(value.nodeId)
    && (value.kind === 'slide' || value.kind === 'layout_container')
    && isNonEmptyString(value.label)
    && isGeneratedLayoutBox(value.finalBox)
    && value.zIndex === -1
    && (value.parentNodeId === undefined || isNonEmptyString(value.parentNodeId))
    && (value.sourceSpan === undefined || isGeneratedLayoutSourceSpan(value.sourceSpan));
}

function isGeneratedLayoutBox(value: unknown): value is GeneratedLayoutBox {
  return isRecord(value)
    && hasOnlyKeys(value, ['x', 'y', 'w', 'h', 'unit'])
    && isFiniteNumber(value.x)
    && isFiniteNumber(value.y)
    && isFiniteNumber(value.w)
    && isFiniteNumber(value.h)
    && value.unit === 'in';
}

function isGeneratedLayoutSourceSpan(value: unknown): value is GeneratedLayoutSourceSpan {
  return isRecord(value)
    && hasOnlyKeys(value, ['startLine', 'endLine'])
    && Number.isInteger(value.startLine)
    && Number.isInteger(value.endLine)
    && typeof value.startLine === 'number'
    && typeof value.endLine === 'number'
    && value.startLine >= 1
    && value.endLine >= value.startLine;
}

function isPositionMode(value: unknown): value is 'flow' | 'absolute' {
  return value === 'flow' || value === 'absolute';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const allowed = new Set(keys);
  return Object.keys(value).every(key => allowed.has(key));
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}
