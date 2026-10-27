import type { DecisionRecord, DecisionRecommendation, DecisionModel } from '../../../../shared';
import type { CheckBoundaryResult } from '../definitions/checkBoundary';
import { DecisionFailure } from '../definitions/decisionFailure';
import { evaluateDecisionModel } from './evaluateDecisionModel';
import { collectCheckInputs } from './evaluateDecisionCheck';
import { deriveCheckBoundary } from './deriveCheckBoundary';
import { projectOptionRanges } from './projectOptionRanges';

export function validateRecommendationBasis(model: DecisionModel, content: DecisionRecommendation) {
  for (const id of content.numericBasis?.calculationIds ?? []) {
    if (!model.calculations.some(item => item.id === id)) {
      throw new DecisionFailure('invalid_model', `Unknown or unrelated calculation: ${id}`);
    }
  }
  const boundaries = (content.numericBasis?.boundaries ?? []).map(binding => {
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
  const quantity = `${result.value}${unit ? ` ${unit}` : ''}`;
  return `保持“${label}”成立：${inputLabel} ${symbol} ${quantity}；${inputLabel} ${inverse} ${quantity}时该项检查不成立（其他输入固定）。`;
}

export function projectRecommendationBasis(record: DecisionRecord, evaluation: ReturnType<typeof evaluateDecisionModel>) {
  const recommendation = record.recommendation;
  if (!recommendation?.content.numericBasis) return null;
  const basedOnInputRevision = recommendation.basedOnInputRevision;
  // 旧引用可能已被删除；不在新模型上重解旧建议，历史值由历史版本读取。
  if (basedOnInputRevision !== record.inputRevision) return { status: 'needs_review', basedOnInputRevision } as const;
  const { boundaries } = validateRecommendationBasis(record.model, recommendation.content);
  const { calculationIds } = recommendation.content.numericBasis;
  return {
    status: 'current' as const,
    basedOnInputRevision,
    calculations: evaluation.calculations.filter(item => calculationIds.includes(item.id)).map(item => ({
      ...item,
      text: item.result.status === 'available' ? `${item.label}：${item.result.value} ${item.unit}`
        : `${item.label}：不可用（${item.result.reason}）。`,
    })),
    optionRanges: [...new Set(boundaries.map(binding => binding.input.id))]
      .map(inputId => projectOptionRanges(record.model, inputId)),
    boundaries: boundaries.map(({ check, input }) => {
      const result = deriveCheckBoundary(record.model, check, input.id);
      const otherInputIds = collectCheckInputs(check)
        .filter(id => id !== input.id);
      return {
        checkId: check.id, inputId: input.id, label: check.label, inputLabel: input.label, unit: input.unit, result,
        fixedInputs: record.model.inputs.filter(item => otherInputIds.includes(item.id)),
        text: boundaryText(check.label, input.label, input.unit, result),
      };
    }),
    notice: '程序只投影已声明的算式与单变量边界；其他输入保持当前值。它不核实来源、单位、模型或自由文字，不自动判定改选及全局最优。',
  };
}
