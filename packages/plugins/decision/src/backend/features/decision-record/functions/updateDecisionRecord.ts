import {
  DecisionModelSchema,
  type DecisionRecord,
  type DecisionUpdate,
  type DecisionRecommendation,
} from '../../../../shared';
import { evaluateDecisionModel, validateDecisionModel } from './evaluateDecisionModel';
import { DecisionFailure } from '../definitions/decisionFailure';

export function updateDecisionRecord(record: DecisionRecord, update: DecisionUpdate): DecisionRecord {
  const replacements = new Map(update.inputs?.map(input => [input.id, input]));
  const inputs = record.model.inputs.map(input => replacements.get(input.id) ?? input);
  for (const input of replacements.values()) {
    if (!record.model.inputs.some(existing => existing.id === input.id)) inputs.push(input);
  }
  const model = DecisionModelSchema.parse({
    ...record.model,
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
  for (const optionId of content.optionIds) {
    if (!record.model.options.some(option => option.id === optionId)) {
      throw new DecisionFailure('invalid_model', `Unknown recommended option: ${optionId}`);
    }
  }
  const failed = evaluateDecisionModel(record.model).checks.find(check => (
    content.optionIds.includes(check.optionId) && check.passes === false
  ));
  if (failed) throw new DecisionFailure('constraint_failed', `Recommended option violates declared check ${failed.id}: ${failed.label}`);
  return {
    ...record,
    revision: record.revision + 1,
    reason: 'Recommendation reviewed for current inputs',
    recommendation: { basedOnInputRevision: record.inputRevision, content },
  };
}

export function projectDecisionRecord(record: DecisionRecord) {
  const recommendationStatus = record.recommendation === null ? 'missing'
    : record.recommendation.basedOnInputRevision === record.inputRevision ? 'current' : 'needs_review';
  return {
    record,
    evaluation: evaluateDecisionModel(record.model),
    recommendationStatus,
    notice: 'current means the author associated this recommendation with current inputs; it is not a correctness certification. Only declared arithmetic and checks are evaluated.',
  };
}
