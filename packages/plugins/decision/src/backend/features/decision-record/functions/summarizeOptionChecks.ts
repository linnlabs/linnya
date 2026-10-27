import type { DecisionModel } from '../../../../shared';
import type { ConditionalOptionState } from '../definitions/conditionalAdvice';
import type { evaluateDecisionModel } from './evaluateDecisionModel';

/** 未定与已失败分开；空检查集合不能借every的空真值变成“可行”。 */
export function summarizeOptionChecks(model: DecisionModel, evaluation: ReturnType<typeof evaluateDecisionModel>): ConditionalOptionState[] {
  return model.options.map(option => {
    const checks = evaluation.checks.filter(check => check.optionId === option.id);
    const failedCheckIds = checks.filter(check => check.passes === false).map(check => check.id);
    const unknownCheckIds = checks.filter(check => check.passes === null).map(check => check.id);
    return {
      optionId: option.id, failedCheckIds, unknownCheckIds,
      status: failedCheckIds.length ? 'fail' : checks.length === 0 || unknownCheckIds.length ? 'undetermined' : 'pass',
    };
  });
}
