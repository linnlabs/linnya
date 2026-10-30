import type { DecisionRecord, DecisionScenarios } from '../../../../shared';
import { DecisionFailure } from '../definitions/decisionFailure';
import { evaluateDecisionModel } from './evaluateDecisionModel';
import { collectCheckInputs } from './evaluateDecisionCheck';

/** 一批假设都从同一冻结记录出发；不调用update，不增加版本或改变建议状态。 */
export function simulateDecisionScenarios(record: DecisionRecord, expectedRevision: number, scenarios: DecisionScenarios) {
  if (record.revision !== expectedRevision) {
    throw new DecisionFailure('revision_conflict', `Revision conflict: expected ${expectedRevision}, current ${record.revision}. Read the current record before simulating.`);
  }
  const caseIds = scenarios.cases.map(item => item.id);
  if (new Set(caseIds).size !== caseIds.length) throw new DecisionFailure('invalid_model', 'Duplicate scenario id.');
  const baseline = evaluateDecisionModel(record.model);
  const references = record.model.inputs.map(input => ({
    inputId: input.id,
    calculationIds: baseline.calculations.filter(item => item.inputIds.includes(input.id)).map(item => item.id),
    checkIds: record.model.checks.filter(item => (
      collectCheckInputs(item, record.model).includes(input.id)
    )).map(item => item.id),
  }));
  return {
    kind: 'simulation' as const,
    decisionId: record.id,
    basedOnRevision: record.revision,
    basedOnInputRevision: record.inputRevision,
    persisted: false,
    baseline,
    cases: scenarios.cases.map(scenario => {
      const inputIds = scenario.inputs.map(item => item.inputId);
      if (new Set(inputIds).size !== inputIds.length) throw new DecisionFailure('invalid_model', `Duplicate input in scenario: ${scenario.id}`);
      const changes = scenario.inputs.map(change => {
        const input = record.model.inputs.find(item => item.id === change.inputId);
        if (!input) throw new DecisionFailure('invalid_model', `Unknown scenario input: ${change.inputId}`);
        return { inputId: input.id, label: input.label, unit: input.unit, quantityType: input.quantityType, status: input.status, from: input.value, to: change.value };
      });
      const replacements = new Map(scenario.inputs.map(item => [item.inputId, item]));
      const model = {
        ...record.model,
        inputs: record.model.inputs.map(input => {
          const replacement = replacements.get(input.id);
          return replacement ? { ...input, value: replacement.value } : input;
        }),
      };
      // 未引用是依赖事实，不是业务错误：偏好和范围外输入可以合法不参与四则式。
      const changedReferences = references.filter(item => inputIds.includes(item.inputId));
      return {
        id: scenario.id, label: scenario.label, changes,
        references: changedReferences,
        unreferencedInputIds: changedReferences.filter(item => item.calculationIds.length === 0 && item.checkIds.length === 0)
          .map(item => item.inputId),
        evaluation: evaluateDecisionModel(model),
      };
    }),
    notice: '这些是假设值下的同版模型结果，未保存为用户事实或新建议；未引用输入只表示未进入数值模型。试算不核验模型语义，也不自动决定改选。',
  };
}
