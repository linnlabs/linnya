import type { DecisionModel, DecisionNumericBasis } from '../../../../shared';
import type { CheckBoundaryResult } from '../definitions/checkBoundary';
import { DecisionFailure } from '../definitions/decisionFailure';
import { evaluateDecisionModel } from './evaluateDecisionModel';
import { collectExpressionInputs, evaluateExpression } from './evaluateDecisionExpression';
import { collectCheckInputs } from './evaluateDecisionCheck';
import { deriveCheckBoundary } from './deriveCheckBoundary';
import { projectOptionRanges } from './projectOptionRanges';
import { formatDecisionQuantity } from './formatDecisionQuantity';

export function validateNumericBasis(model: DecisionModel, basis: DecisionNumericBasis) {
  for (const id of basis.calculationIds) {
    if (!model.calculations.some(item => item.id === id)) {
      throw new DecisionFailure('invalid_model', `Unknown or unrelated calculation: ${id}`);
    }
  }
  const boundaries = (basis.boundaries).map(binding => {
    const check = model.checks.find(item => item.id === binding.checkId);
    const input = model.inputs.find(item => item.id === binding.inputId);
    const inputIds = check ? collectCheckInputs(check) : [];
    if (!check || !input || !inputIds.includes(input.id)) {
      throw new DecisionFailure('invalid_model', `Unknown or unrelated check/input: ${binding.checkId}/${binding.inputId}`);
    }
    return { check, input };
  });
  return { boundaries };
}

function boundaryText(label: string, inputLabel: string, unit: string | undefined, result: CheckBoundaryResult): string {
  if (result.status === 'unavailable') return `${label}：边界不可用（${result.reason}）。`;
  if (result.status === 'independent') {
    return `${label}：在其他输入固定时，此检查与${inputLabel}无关，检查${result.passes ? '成立' : '不成立'}。`;
  }
  const symbol = result.operator === 'lte' ? '≤' : result.operator === 'gte' ? '≥' : '=';
  const inverse = result.operator === 'lte' ? '>' : result.operator === 'gte' ? '<' : '≠';
  const quantity = formatDecisionQuantity(result.value, unit);
  return `保持“${label}”成立：${inputLabel} ${symbol} ${quantity}；${inputLabel} ${inverse} ${quantity}时该项检查不成立（其他输入固定）。`;
}

/** 同一个边界点重算全部相关算式，避免把基线算值和边界输入拼成一个情景。 */
function projectBoundaryPoint(model: DecisionModel, inputId: string, value: number) {
  const pointModel: DecisionModel = {
    ...model,
    inputs: model.inputs.map(input => input.id === inputId ? { ...input, value } : input),
  };
  return {
    inputId, value,
    fixedInputIds: model.inputs.filter(input => input.id !== inputId).map(input => input.id),
    calculations: model.calculations.flatMap(calculation => {
      const inputIds = collectExpressionInputs(calculation.expression);
      if (!inputIds.includes(inputId)) return [];
      const result = evaluateExpression(calculation.expression, pointModel);
      return [{ id: calculation.id, label: calculation.label, unit: calculation.unit, inputIds, result,
        text: result.status === 'available' ? `${calculation.label}：${formatDecisionQuantity(result.value, calculation.unit)}`
          : `${calculation.label}：不可用（${result.reason}）。` }];
    }),
  };
}

/** 不依赖建议状态的同版数值投影，供写前check与保存后建议共同使用。 */
export function projectNumericBasis(model: DecisionModel, basis: DecisionNumericBasis, evaluation: ReturnType<typeof evaluateDecisionModel>) {
  const bindings = validateNumericBasis(model, basis).boundaries;
  const boundaries = bindings.map(({ check, input }) => {
    const result = deriveCheckBoundary(model, check, input.id);
    const otherInputIds = collectCheckInputs(check).filter(id => id !== input.id);
    const atBoundary = result.status === 'available' ? projectBoundaryPoint(model, input.id, result.value) : null;
    const pointText = atBoundary ? `取${input.label} = ${formatDecisionQuantity(atBoundary.value, input.unit)}时，${atBoundary.calculations.length
      ? atBoundary.calculations.map(calculation => calculation.text).join('；') : '没有引用此输入的已登记计算'}（仅该点，其他输入固定）。` : '';
    return {
      checkId: check.id, inputId: input.id, label: check.label, inputLabel: input.label, unit: input.unit, result,
      fixedInputs: model.inputs.filter(item => otherInputIds.includes(item.id)), atBoundary,
      text: `${boundaryText(check.label, input.label, input.unit, result)}${pointText ? ` ${pointText}` : ''}`,
    };
  });
  return {
    // 把可直接交付的同点文字放在前面，调用方无需再跨字段配对或手填第二份数值条件。
    changeConditions: boundaries.map(boundary => boundary.text),
    calculations: evaluation.calculations.filter(item => basis.calculationIds.includes(item.id)).map(item => ({
      ...item,
      text: item.result.status === 'available' ? `${item.label}：${formatDecisionQuantity(item.result.value, item.unit)}`
        : `${item.label}：不可用（${item.result.reason}）。`,
    })),
    boundaries,
    optionRanges: [...new Set(bindings.map(binding => binding.input.id))].map(inputId => projectOptionRanges(model, inputId)),
  };
}
