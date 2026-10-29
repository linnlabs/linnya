import type { DecisionModel } from '../../../../shared';
import type { CheckBoundaryResult } from '../definitions/checkBoundary';
import type { NumericRegion, OptionState, OptionRangeRow, OptionBoundaries, OptionCheckStatus } from '../definitions/optionRange';
import { deriveCheckBoundary } from './deriveCheckBoundary';
import { DecisionFailure } from '../definitions/decisionFailure';
import { partitionNumericRegions } from './partitionNumericRegions';

function containsRegion(bound: Extract<CheckBoundaryResult, { status: 'available' }>, region: NumericRegion): boolean {
  if (bound.operator === 'lte') return region.upper !== null && region.upper <= bound.value;
  if (bound.operator === 'gte') return region.lower !== null && region.lower >= bound.value;
  return region.lower === bound.value && region.upper === bound.value;
}

function optionStatus(option: OptionBoundaries, region: NumericRegion): OptionCheckStatus {
  if (option.checks.length === 0) return 'undetermined';
  let unknown = false;
  for (const { result } of option.checks) {
    if (result.status === 'unavailable') unknown = true;
    else if (result.status === 'independent') {
      if (!result.passes) return 'fail';
    } else if (!containsRegion(result, region)) return 'fail';
  }
  return unknown ? 'undetermined' : 'pass';
}

/** 每个范围都考虑全部候选的全部检查；独立的失败不能因切换查看变量而消失。 */
export function projectOptionRanges(model: DecisionModel, inputId: string) {
  const input = model.inputs.find(item => item.id === inputId);
  if (!input) throw new DecisionFailure('invalid_model', `Unknown range input: ${inputId}`);
  const boundaries: OptionBoundaries[] = model.options.map(option => ({
    optionId: option.id,
    checks: model.checks.filter(check => check.optionId === option.id).map(check => ({
      checkId: check.id, result: deriveCheckBoundary(model, check, inputId),
    })),
  }));
  const endpoints = [...new Set(boundaries.flatMap(option => option.checks.flatMap(check => (
    check.result.status === 'available' ? [check.result.value] : []
  ))))].sort((a, b) => a - b);
  const atoms = partitionNumericRegions(endpoints);
  const rows: OptionRangeRow[] = [];
  for (const atom of atoms) {
    const options: OptionState[] = boundaries.map(option => ({ optionId: option.optionId, status: optionStatus(option, atom) }));
    const last = rows[rows.length - 1];
    // 按边界与等号划分的原子区间无遗漏；只在整个状态向量相同时合并。
    if (last && last.options.every((option, index) => option.status === options[index]?.status)) {
      rows[rows.length - 1] = { ...last, upper: atom.upper, upperInclusive: atom.upperInclusive };
    } else rows.push({ ...atom, options });
  }
  return {
    input,
    fixedInputIds: model.inputs.filter(input => input.id !== inputId).map(input => input.id),
    boundaries, rows,
  };
}
