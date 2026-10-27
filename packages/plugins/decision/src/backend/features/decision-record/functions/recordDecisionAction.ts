import type { DecisionRecord, DecisionActionPlan, DecisionActionResolution, DecisionActionWithdrawalRequest, DecisionUpdate, DecisionReportProvenance } from '../../../../shared';
import { DecisionFailure } from '../definitions/decisionFailure';
import { updateDecisionRecord } from './updateDecisionRecord';

function applyFeedback(record: DecisionRecord, update: DecisionUpdate | undefined): DecisionRecord {
  return update ? updateDecisionRecord(record, update) : {
    ...record, revision: record.revision + 1, inputRevision: record.inputRevision + 1,
  };
}

export function planDecisionAction(record: DecisionRecord, id: string, plan: DecisionActionPlan): DecisionRecord {
  if (new Set(plan.inputIds).size !== plan.inputIds.length) {
    throw new DecisionFailure('invalid_model', 'Action inputIds must not repeat.');
  }
  for (const inputId of plan.inputIds) {
    if (!record.model.inputs.some(input => input.id === inputId)) {
      throw new DecisionFailure('invalid_model', `Unknown action input: ${inputId}`);
    }
  }
  return {
    ...record,
    revision: record.revision + 1,
    reason: `Action planned: ${plan.label}`,
    actions: [...(record.actions ?? []), { id, basedOnInputRevision: record.inputRevision, plan }],
  };
}

export function resolveDecisionAction(record: DecisionRecord, actionId: string, resolution: DecisionActionResolution, provenance: DecisionReportProvenance): DecisionRecord {
  const action = record.actions?.find(item => item.id === actionId);
  if (!action) throw new DecisionFailure('not_found', 'Action not found in this decision.');
  if (action.result) throw new DecisionFailure('invalid_model', 'Action already has a result. Read its saved result instead of completing it again.');
  const { update, outcome, summary, origin, actualCost } = resolution;
  const report = { outcome, summary, origin, actualCost };
  // 结果与条件在同一版一起落库；坏模型先抛错，不能留下“已完成但条件没更新”的半条结果。
  const next = applyFeedback(record, update);
  return {
    ...next,
    reason: `Action ${report.outcome}: ${report.summary}`,
    actions: (record.actions ?? []).map(item => item.id !== actionId ? item : {
      ...item,
      result: {
        ...report,
        provenance,
        receivedAtRevision: next.revision,
        receivedAgainstInputRevision: record.inputRevision,
        resultingInputRevision: next.inputRevision,
      },
    }),
  };
}

export function withdrawDecisionActionReport(record: DecisionRecord, actionId: string, withdrawal: DecisionActionWithdrawalRequest, provenance: DecisionReportProvenance): DecisionRecord {
  const action = record.actions?.find(item => item.id === actionId);
  const report = action?.result;
  if (!action || !report) throw new DecisionFailure('not_found', 'No reported result exists for this action.');
  if (report.withdrawal) throw new DecisionFailure('invalid_model', 'Action report is already withdrawn. Read the saved history instead.');
  const { update, reason: explanation, origin } = withdrawal;
  const reason = { reason: explanation, origin };
  const next = applyFeedback(record, update);
  return {
    ...next,
    reason: `Action report withdrawn: ${reason.reason}`,
    // 撤回报告不等于现实行动从未发生，也不能猜哪些模型事实要回滚；仅执行显式update。
    actions: (record.actions ?? []).map(item => item.id !== actionId ? item : {
      ...item,
      result: {
        ...report,
        withdrawal: {
          ...reason,
          provenance,
          receivedAtRevision: next.revision,
          receivedAgainstInputRevision: record.inputRevision,
          resultingInputRevision: next.inputRevision,
        },
      },
    }),
  };
}
