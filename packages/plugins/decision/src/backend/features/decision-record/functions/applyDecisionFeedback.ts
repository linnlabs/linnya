import type { DecisionRecord, DecisionUpdate } from '../../../../shared';
import { updateDecisionRecord } from './updateDecisionRecord';

/** 观察本身改变决策依据；没有模型补丁也要使旧建议、研究和活动计划待复核。 */
export function applyDecisionFeedback(record: DecisionRecord, update: DecisionUpdate | undefined): DecisionRecord {
  return update ? updateDecisionRecord(record, update) : {
    ...record, revision: record.revision + 1, inputRevision: record.inputRevision + 1,
  };
}
