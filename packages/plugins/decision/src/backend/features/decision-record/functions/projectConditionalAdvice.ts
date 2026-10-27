import type { DecisionRecord, DecisionConditionalAdvice, DecisionModel } from '../../../../shared';
import { DecisionFailure } from '../definitions/decisionFailure';
import type { ConditionalOptionState, ConditionalOutcome } from '../definitions/conditionalAdvice';
import type { evaluateDecisionModel } from './evaluateDecisionModel';
import { simulateDecisionScenarios } from './simulateDecisionScenarios';
import { summarizeOptionChecks } from './summarizeOptionChecks';

type Evaluation = ReturnType<typeof evaluateDecisionModel>;

function resolveOutcome(
  options: readonly ConditionalOptionState[],
  advice: DecisionConditionalAdvice,
  preferenceReady: boolean,
  preferenceChanged: boolean,
): ConditionalOutcome {
  if (preferenceChanged) return { status: 'preference_needs_review', optionIds: [], authorAction: advice.whenUndetermined };
  // 即使偏好尚未明确，也能报告所有候选已被声明的硬检查排除；无需凭空推荐一个。
  if (options.every(option => option.status === 'fail')) {
    return { status: 'no_option_passes', optionIds: [], authorAction: advice.whenNonePass };
  }
  if (!preferenceReady || options.some(option => option.status === 'undetermined')) {
    return { status: 'needs_information', optionIds: [], authorAction: advice.whenUndetermined };
  }
  if (!advice.preference) return { status: 'selection_required', optionIds: [] };
  const selected = advice.preference.optionOrder.find(id => options.some(option => option.optionId === id && option.status === 'pass'));
  // 顺序必须列齐候选，且上面已排除无通过项；不以fallback掩盖非法的内部调用。
  if (!selected) throw new DecisionFailure('invalid_model', 'No passing option occurs in the declared preference order.');
  return { status: 'ranked_choice', optionIds: [selected] };
}

export function validateConditionalAdvice(model: DecisionModel, advice: DecisionConditionalAdvice): void {
  const preference = advice.preference;
  if (!preference) return;
  if (new Set(preference.inputIds).size !== preference.inputIds.length) {
    throw new DecisionFailure('invalid_model', 'Duplicate preference input id.');
  }
  for (const id of preference.inputIds) {
    if (!model.inputs.some(input => input.id === id && input.kind === 'preference')) {
      throw new DecisionFailure('invalid_model', `Unknown or non-preference input: ${id}`);
    }
  }
  const order = preference.optionOrder;
  if (new Set(order).size !== order.length || order.length !== model.options.length
    || order.some(id => !model.options.some(option => option.id === id))) {
    throw new DecisionFailure('invalid_model', 'Preference order must include every option exactly once.');
  }
}

export function projectConditionalAdvice(record: DecisionRecord, evaluation: Evaluation) {
  const recommendation = record.recommendation;
  const advice = recommendation?.content.conditionalAdvice;
  if (!recommendation || !advice) return null;
  const basedOnInputRevision = recommendation.basedOnInputRevision;
  if (basedOnInputRevision !== record.inputRevision) return { status: 'needs_review', basedOnInputRevision } as const;
  validateConditionalAdvice(record.model, advice);
  const preferenceInputs = record.model.inputs.filter(input => advice.preference?.inputIds.includes(input.id));
  const preferenceReady = preferenceInputs.every(input => input.status === 'available' && input.value !== null);
  const currentOptions = summarizeOptionChecks(record.model, evaluation);
  const simulation = advice.cases ? simulateDecisionScenarios(record, record.revision, { cases: advice.cases }) : null;
  return {
    status: 'current' as const, basedOnRevision: record.revision, basedOnInputRevision,
    preference: advice.preference ? { ...advice.preference, inputs: preferenceInputs, origin: 'author_declared' as const } : null,
    baseline: { evaluation, options: currentOptions, outcome: resolveOutcome(currentOptions, advice, preferenceReady, false) },
    cases: simulation?.cases.map(scenario => {
      const options = summarizeOptionChecks(record.model, scenario.evaluation);
      const preferenceChanged = scenario.changes.some(change => advice.preference?.inputIds.includes(change.inputId) && change.from !== change.to);
      return {
        ...scenario, options,
        outcome: resolveOutcome(options, advice, preferenceReady, preferenceChanged),
        authorNextAction: advice.cases?.find(item => item.id === scenario.id)?.nextAction ?? null,
      };
    }) ?? [],
    notice: '假设清单保存在建议中，未改成当前事实；每次从同版模型独立重算。程序只依据声明的数值检查与作者给定的偏好顺序选择，行动仍属作者判断，不核实来源、模型语义或自由文字。',
  };
}
