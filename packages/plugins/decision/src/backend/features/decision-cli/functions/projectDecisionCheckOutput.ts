import type { checkDecisionOptions } from '../../decision-record';

/** CLI只投影交付体积；完整求值和版本／权限合同仍由记录能力拥有。 */
export function projectDecisionCheckOutput(result: ReturnType<typeof checkDecisionOptions>, full: boolean) {
  if (full) return result;
  return {
    kind: result.kind, decisionId: result.decisionId,
    basedOnRevision: result.basedOnRevision, basedOnInputRevision: result.basedOnInputRevision,
    persisted: result.persisted, authorization: result.authorization,
    overall: result.overall,
    options: result.options.map(option => ({ optionId: option.optionId, status: option.status,
      failedCheckIds: option.failedCheckIds, unknownCheckIds: option.unknownCheckIds })),
    changeConditions: result.numericPreview.changeConditions,
    calculations: result.numericPreview.calculations.map(calculation => calculation.text),
    numericBasis: result.numericBasis,
    notice: result.notice,
  };
}
