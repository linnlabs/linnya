import type { DecisionRecord } from '../../../../shared';
import { DecisionFailure } from '../definitions/decisionFailure';
import { projectDecisionRecord } from './updateDecisionRecord';
import { summarizeOptionChecks } from './summarizeOptionChecks';

/** 交付的是当前保存版，不另接一份阈值、结论或“已核验”声明。 */
export function projectDecisionDelivery(record: DecisionRecord, expectedRevision: number) {
  if (record.revision !== expectedRevision) {
    throw new DecisionFailure('revision_conflict', `Revision conflict: expected ${expectedRevision}, current ${record.revision}. Read the current record before delivery.`);
  }
  const projected = projectDecisionRecord(record);
  const recommendation = record.recommendation;
  if (!recommendation || projected.recommendationStatus !== 'current') {
    throw new DecisionFailure('delivery_not_ready', 'Save a recommendation for the current inputs and observed actions before delivery. Delivery does not re-accept an old recommendation.');
  }
  const conditional = projected.conditionalAdvice;
  return {
    kind: 'decision_delivery' as const,
    decisionId: record.id, revision: record.revision, inputRevision: record.inputRevision,
    title: record.model.title,
    // 依赖所有选项的检查，不只展示作者选中的好消息；无检查仍为未定。
    options: summarizeOptionChecks(record.model, projected.evaluation).map((option, index) => ({
      ...option,
      label: record.model.options[index].label,
      checks: projected.evaluation.checks.filter(check => check.optionId === option.optionId),
    })),
    inputs: record.model.inputs,
    actions: projected.actionStates,
    calculations: projected.evaluation.calculations,
    cashFlows: projected.evaluation.cashFlows ?? [],
    numericBasis: projected.recommendationBasis,
    conditionalAdvice: conditional,
    // 不把作者自由文字改写成程序结论；保留原文才能审计建议本身的错误。
    author: recommendation.content,
    authorization: 'not_evaluated' as const,
  };
}

export type DecisionDelivery = ReturnType<typeof projectDecisionDelivery>;
