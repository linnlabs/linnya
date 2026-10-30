import type { DecisionRecord, DecisionOptionCheck, DecisionNumericBasis } from '../../../../shared';
import { DecisionFailure } from '../definitions/decisionFailure';
import { evaluateDecisionModel } from './evaluateDecisionModel';
import { summarizeOptionChecks } from './summarizeOptionChecks';
import { collectCheckInputs } from './evaluateDecisionCheck';
import { projectNumericBasis } from './projectNumericBasis';

/** 复核显式候选的同版声明条件，不推断执行意图或替代平台审批。 */
export function checkDecisionOptions(record: DecisionRecord, expectedRevision: number, request: DecisionOptionCheck) {
  if (record.revision !== expectedRevision) {
    throw new DecisionFailure('revision_conflict', `Revision conflict: expected ${expectedRevision}, current ${record.revision}. Read the current record before checking.`);
  }
  if (new Set(request.optionIds).size !== request.optionIds.length) throw new DecisionFailure('invalid_model', 'Duplicate optionIds in check.');
  const evaluation = evaluateDecisionModel(record.model);
  const summaries = summarizeOptionChecks(record.model, evaluation);
  const options = request.optionIds.map(id => {
    const summary = summaries.find(item => item.optionId === id);
    if (!summary) throw new DecisionFailure('invalid_model', `Unknown option: ${id}`);
    return { ...summary, checks: evaluation.checks.filter(check => check.optionId === id) };
  });
  // 只依据调用者选中的既有检查建立预览引用；不新增经济门槛或推断偏好。
  const numericBasis: DecisionNumericBasis = {
    calculationIds: record.model.calculations.map(calculation => calculation.id),
    boundaries: record.model.checks.filter(check => request.optionIds.includes(check.optionId) && check.operator !== 'is' && check.operator !== 'cash_flow_funded')
      .flatMap(check => {
        const inputIds = collectCheckInputs(check, record.model);
        return record.model.inputs.filter(input => inputIds.includes(input.id) && (typeof input.value === 'number' || input.value === null))
          .map(input => ({ checkId: check.id, inputId: input.id }));
      }),
  };
  return {
    kind: 'option_check' as const, decisionId: record.id,
    basedOnRevision: record.revision, basedOnInputRevision: record.inputRevision,
    persisted: false, authorization: 'not_evaluated' as const,
    overall: options.some(option => option.status === 'fail') ? 'blocked' as const
      : options.some(option => option.status === 'undetermined') ? 'undetermined' as const : 'declared_checks_pass' as const,
    numericBasis,
    numericPreview: {
      basedOnRevision: record.revision, basedOnInputRevision: record.inputRevision,
      ...projectNumericBasis(record.model, numericBasis, evaluation),
      inputs: record.model.inputs,
      ...(evaluation.cashFlows ? { cashFlows: evaluation.cashFlows.filter(flow => request.optionIds.includes(flow.optionId)) } : {}),
    },
    options,
    notice: 'Only declared checks were evaluated. Passing does not establish source truth, real-world feasibility, preference or execution authorization.',
  };
}
