import type { DecisionRecord } from '../../../../shared';
import type { DecisionItemChanges, DecisionRecommendationSummary } from '../definitions/decisionComparison';
import { DecisionFailure } from '../definitions/decisionFailure';
import { evaluateDecisionModel } from './evaluateDecisionModel';
import { collectExpressionInputs } from './evaluateDecisionExpression';
import { collectCheckInputs } from './evaluateDecisionCheck';
import { summarizeOptionChecks } from './summarizeOptionChecks';

function same(before: unknown, after: unknown): boolean { return JSON.stringify(before) === JSON.stringify(after); }

/** 比较已按schema归一化的JSON声明，保留顺序和精确结构，不猜数学等价或语义等价。 */
function changes<T extends { readonly id: string }>(before: readonly T[], after: readonly T[]): DecisionItemChanges<T> {
  const earlier = new Map(before.map(item => [item.id, item]));
  const later = new Map(after.map(item => [item.id, item]));
  return {
    added: after.filter(item => !earlier.has(item.id)),
    removed: before.filter(item => !later.has(item.id)),
    changed: after.flatMap(item => {
      const old = earlier.get(item.id);
      return old && !same(old, item) ? [{ id: item.id, before: old, after: item }] : [];
    }),
  };
}

function references(record: DecisionRecord, inputId: string) {
  return {
    calculationIds: record.model.calculations.filter(item => collectExpressionInputs(item.expression).includes(inputId)).map(item => item.id),
    checkIds: record.model.checks.filter(item => collectCheckInputs(item).includes(inputId)).map(item => item.id),
  };
}
function recommendationSummary(record: DecisionRecord): DecisionRecommendationSummary {
  const saved = record.recommendation;
  return {
    status: saved === null ? 'missing' : saved.basedOnInputRevision === record.inputRevision ? 'current' : 'needs_review',
    basedOnInputRevision: saved?.basedOnInputRevision ?? null,
    optionIds: saved?.content.optionIds ?? [],
  };
}

function analysisState(before: unknown, after: unknown) {
  return {
    beforeEnabled: before !== undefined && before !== null,
    afterEnabled: after !== undefined && after !== null,
    targetDisposition: after === undefined ? 'omitted' as const : after === null ? 'disabled' as const : 'provided' as const,
    declarationChanged: !same(before, after),
  };
}

export function compareDecisionRecords(before: DecisionRecord, after: DecisionRecord) {
  if (before.id !== after.id) throw new DecisionFailure('invalid_model', 'Compare requires two revisions of the same decision.');
  const oldEvaluation = evaluateDecisionModel(before.model);
  const newEvaluation = evaluateDecisionModel(after.model);
  const inputChanges = changes(before.model.inputs, after.model.inputs);
  const changedInputIds = [...new Set([
    ...inputChanges.added.map(item => item.id), ...inputChanges.removed.map(item => item.id), ...inputChanges.changed.map(item => item.id),
  ])];
  const inputFields = ['value', 'status', 'origin', 'kind', 'unit', 'label'] as const;
  const targetOptions = summarizeOptionChecks(after.model, newEvaluation);
  return {
    kind: 'comparison' as const, decisionId: before.id,
    fromRevision: before.revision, toRevision: after.revision,
    fromInputRevision: before.inputRevision, toInputRevision: after.inputRevision,
    changes: {
      title: before.model.title === after.model.title ? null : { before: before.model.title, after: after.model.title },
      question: before.model.question === after.model.question ? null : { before: before.model.question, after: after.model.question },
      inputs: { ...inputChanges, changed: inputChanges.changed.map(change => ({
        ...change, fields: inputFields.filter(field => !same(change.before[field], change.after[field])),
      })) },
      options: changes(before.model.options, after.model.options),
      calculations: changes(before.model.calculations, after.model.calculations),
      checks: changes(before.model.checks, after.model.checks),
    },
    effects: {
      calculations: changes(oldEvaluation.calculations, newEvaluation.calculations),
      checks: changes(oldEvaluation.checks, newEvaluation.checks),
      dependencies: changedInputIds.map(inputId => ({ inputId, before: references(before, inputId), after: references(after, inputId) })),
      // 只在目标模型上检查旧选择；不把旧偏好或旧情景强行解释为新建议。
      previousSelectionInTarget: (before.recommendation?.content.optionIds ?? []).map(optionId => ({
        optionId,
        state: targetOptions.find(option => option.optionId === optionId) ?? { optionId, status: 'removed' as const },
      })),
    },
    analysisChanges: {
      conditionalAdvice: {
        ...analysisState(before.recommendation?.content.conditionalAdvice, after.recommendation?.content.conditionalAdvice),
        cases: changes(before.recommendation?.content.conditionalAdvice?.cases ?? [], after.recommendation?.content.conditionalAdvice?.cases ?? []),
      },
      numericBasis: {
        ...analysisState(before.recommendation?.content.numericBasis, after.recommendation?.content.numericBasis),
        removedCalculationIds: (before.recommendation?.content.numericBasis?.calculationIds ?? [])
          .filter(id => !after.recommendation?.content.numericBasis?.calculationIds.includes(id)),
        addedCalculationIds: (after.recommendation?.content.numericBasis?.calculationIds ?? [])
          .filter(id => !before.recommendation?.content.numericBasis?.calculationIds.includes(id)),
        boundaries: changes(
          (before.recommendation?.content.numericBasis?.boundaries ?? []).map(item => ({ id: `${item.checkId}/${item.inputId}`, ...item })),
          (after.recommendation?.content.numericBasis?.boundaries ?? []).map(item => ({ id: `${item.checkId}/${item.inputId}`, ...item })),
        ),
      },
    },
    actionChanges: changes(before.actions ?? [], after.actions ?? []),
    recommendations: {
      from: recommendationSummary(before), to: recommendationSummary(after),
      contentChanged: !same(before.recommendation?.content, after.recommendation?.content),
    },
    notice: '只读比较两个明确保存版本。dependencies表示引用关系，effects分别列算值/检查变化；元数据变化不等于数值效应。旧选择在目标模型的检查状态不是新推荐，不证明来源、模型含义、因果归因或总体最优。',
  };
}
