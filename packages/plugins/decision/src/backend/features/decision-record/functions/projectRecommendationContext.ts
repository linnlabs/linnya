import { createHash } from 'node:crypto';
import type { DecisionAction, DecisionRecord, DecisionRecommendation } from '../../../../shared';
import { DecisionFailure } from '../definitions/decisionFailure';
import { projectDecisionActions } from './projectDecisionActions';

function fingerprint(action: DecisionAction): string {
  // action来自同一严格schema的固定字段序列；仅比较保存声明，不猜语义等价。
  return createHash('sha256').update(JSON.stringify(action)).digest('hex');
}

export function observeRecommendationActions(record: DecisionRecord, content: DecisionRecommendation) {
  if (!content.actionBasis) return undefined;
  const ids = content.actionBasis.actionIds;
  if (new Set(ids).size !== ids.length) throw new DecisionFailure('invalid_model', 'Duplicate recommendation action id.');
  return ids.map(actionId => {
    const action = record.actions?.find(item => item.id === actionId);
    if (!action) throw new DecisionFailure('invalid_model', `Unknown recommendation action: ${actionId}`);
    return { actionId, fingerprint: fingerprint(action) };
  });
}

/** 输入与显式行动依据共同决定建议是否仍适用；旧记录不补造观察。 */
export function projectRecommendationContext(record: DecisionRecord) {
  const saved = record.recommendation;
  const inputStatus = !saved ? 'missing' as const
    : saved.basedOnInputRevision === record.inputRevision && record.model.options.every(option => option.obligationIds !== null) ? 'current' as const : 'needs_review' as const;
  const basis = saved?.content.actionBasis;
  if (!basis) return { status: inputStatus, inputStatus, actionBasis: { status: 'not_observed' as const } };
  const states = projectDecisionActions(record);
  const actions = basis.actionIds.map(actionId => {
    const observation = saved.actionObservations?.find(item => item.actionId === actionId);
    const action = record.actions?.find(item => item.id === actionId);
    return {
      actionId,
      status: !observation ? 'not_observed' as const
        : !action ? 'missing' as const : observation.fingerprint === fingerprint(action) ? 'unchanged' as const : 'changed' as const,
      current: states.find(item => item.id === actionId) ?? null,
    };
  });
  const status = actions.every(action => action.status === 'unchanged') ? 'current' as const : 'needs_review' as const;
  return {
    status: inputStatus === 'current' && status === 'current' ? 'current' as const : 'needs_review' as const,
    inputStatus, actionBasis: { status, actions },
  };
}
