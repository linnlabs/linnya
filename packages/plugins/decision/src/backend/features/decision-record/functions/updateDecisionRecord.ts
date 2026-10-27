import {
  DecisionModelSchema,
  type DecisionRecord,
  type DecisionUpdate,
  type DecisionRecommendation,
} from '../../../../shared';
import { evaluateDecisionModel, validateDecisionModel } from './evaluateDecisionModel';
import { DecisionFailure } from '../definitions/decisionFailure';
import { projectRecommendationBasis, validateRecommendationBasis } from './projectRecommendationBasis';
import { projectConditionalAdvice } from './projectConditionalAdvice';

export function updateDecisionRecord(record: DecisionRecord, update: DecisionUpdate): DecisionRecord {
  const replacements = new Map(update.inputs?.map(input => [input.id, input]));
  const inputs = record.model.inputs.map(input => replacements.get(input.id) ?? input);
  for (const input of replacements.values()) {
    if (!record.model.inputs.some(existing => existing.id === input.id)) inputs.push(input);
  }
  const model = DecisionModelSchema.parse({
    ...record.model,
    title: update.title ?? record.model.title,
    question: update.question ?? record.model.question,
    inputs,
    options: update.options ?? record.model.options,
    calculations: update.calculations ?? record.model.calculations,
    checks: update.checks ?? record.model.checks,
  });
  validateDecisionModel(model);
  if (JSON.stringify(model) === JSON.stringify(record.model)) {
    throw new DecisionFailure('no_changes', 'No decision conditions changed.');
  }
  // 偏好也会影响无法量化的取舍，因此任何条件版本变化都要求重新判断建议。
  return {
    ...record,
    revision: record.revision + 1,
    inputRevision: record.inputRevision + 1,
    reason: update.reason,
    model,
  };
}

export function recordDecisionRecommendation(
  record: DecisionRecord,
  content: DecisionRecommendation,
): DecisionRecord {
  const previous = record.recommendation?.content;
  const omitted = (['conditionalAdvice', 'numericBasis'] as const).filter(key => {
    const existing = previous?.[key];
    return existing !== undefined && existing !== null && content[key] === undefined;
  });
  // 不完整的新建议不能静默删除持久分析；也不能自动拼接可能已经过期的旧分析。
  if (omitted.length) {
    throw new DecisionFailure('invalid_model', `Existing analysis omitted: ${omitted.join(', ')}. Provide each explicitly reviewed replacement, or set it to null to disable it intentionally.`);
  }
  for (const optionId of content.optionIds) {
    if (!record.model.options.some(option => option.id === optionId)) {
      throw new DecisionFailure('invalid_model', `Unknown recommended option: ${optionId}`);
    }
  }
  validateRecommendationBasis(record.model, content);
  const evaluation = evaluateDecisionModel(record.model);
  const failed = evaluation.checks.find(check => (
    content.optionIds.includes(check.optionId) && check.passes === false
  ));
  if (failed) throw new DecisionFailure('constraint_failed', `Recommended option violates declared check ${failed.id}: ${failed.label}`);
  const next: DecisionRecord = {
    ...record,
    revision: record.revision + 1,
    reason: 'Recommendation reviewed for current inputs',
    recommendation: { basedOnInputRevision: record.inputRevision, content },
  };
  const conditional = projectConditionalAdvice(next, evaluation);
  if (!conditional && content.optionIds.length === 0) {
    throw new DecisionFailure('invalid_model', 'An empty selection requires explicit conditionalAdvice and a next action.');
  }
  if (conditional?.status === 'current' && conditional.baseline.outcome.status === 'ranked_choice'
    && (content.optionIds.length !== 1 || content.optionIds[0] !== conditional.baseline.outcome.optionIds[0])) {
    throw new DecisionFailure('constraint_failed', 'Saved selection conflicts with the declared preference order and passing checks.');
  }
  return next;
}

export function projectDecisionRecord(record: DecisionRecord) {
  const recommendationStatus = record.recommendation === null ? 'missing'
    : record.recommendation.basedOnInputRevision === record.inputRevision ? 'current' : 'needs_review';
  const evaluation = evaluateDecisionModel(record.model);
  return {
    record,
    evaluation,
    recommendationStatus,
    // 状态由历史报告推导，撤回后仍保留原文；reported不冒充宿主已经执行或核验。
    actionStates: (record.actions ?? []).map(action => ({
      id: action.id,
      state: action.result?.withdrawal ? 'report_withdrawn' as const
        : action.result ? action.result.outcome === 'completed' ? 'reported_completed' as const : 'reported_cancelled' as const
          : 'planned' as const,
    })),
    recommendationBasis: projectRecommendationBasis(record, evaluation),
    conditionalAdvice: projectConditionalAdvice(record, evaluation),
    notice: 'current means the author associated this recommendation with current inputs; it is not a correctness certification. Only declared arithmetic and checks are evaluated.',
  };
}
