import type { DecisionRecord, DecisionAction } from '../../../../shared';

/** 原计划是第1版；每次明确复核追加一版，报告始终指向当时的计划。 */
export function currentDecisionActionPlan(action: DecisionAction) {
  const review = action.reviews?.[action.reviews.length - 1];
  return {
    plan: review ? review.plan : action.plan,
    planRevision: 1 + (action.reviews?.length ?? 0),
    basedOnInputRevision: review ? review.basedOnInputRevision : action.basedOnInputRevision,
  };
}

export function projectDecisionActions(record: DecisionRecord) {
  return (record.actions ?? []).map(action => {
    const current = currentDecisionActionPlan(action);
    const unavailableInputIds = current.plan.inputIds.filter(id => {
      const input = record.model.inputs.find(item => item.id === id);
      return !input || input.status === 'withdrawn';
    });
    const planStatus = action.result ? 'closed' as const
      : current.basedOnInputRevision !== record.inputRevision || unavailableInputIds.length ? 'needs_review' as const : 'current' as const;
    const activeReports = (action.progressReports ?? []).filter(report => !report.withdrawal);
    return {
      id: action.id,
      state: action.result?.withdrawal ? 'report_withdrawn' as const
        : action.result ? action.result.outcome === 'completed' ? 'reported_completed' as const : 'reported_cancelled' as const
          : activeReports.length ? 'reported_in_progress' as const
            : action.progressReports?.length ? 'progress_withdrawn' as const : 'planned' as const,
      planStatus, continuation: action.result ? 'closed' as const : planStatus === 'needs_review' ? 'review_required' as const : 'open' as const,
      ...current, unavailableInputIds,
      activeProgressReportIds: activeReports.map(report => report.id),
      reportSource: action.result ? action.result.provenance?.kind ?? 'unbound' : null,
      withdrawalSource: action.result?.withdrawal ? action.result.withdrawal.provenance?.kind ?? 'unbound' : null,
    };
  });
}
