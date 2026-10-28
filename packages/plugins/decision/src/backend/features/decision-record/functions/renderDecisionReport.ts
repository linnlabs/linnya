import type { DecisionExpression, DecisionRecord } from '../../../../shared';
import type { DecisionReport } from '../definitions/decisionReport';
import type { CheckValueResult } from '../definitions/decisionEvaluation';
import { projectDecisionRecord } from './updateDecisionRecord';
import { evaluateExpression } from './evaluateDecisionExpression';
import { evaluateDecisionCheck } from './evaluateDecisionCheck';
import { DecisionFailure } from '../definitions/decisionFailure';

/** 声明文字只能作为数据出现，不能借换行、表格或HTML冒充程序章节。 */
function text(value: string): string {
  return value.replace(/[\r\n\u2028\u2029]+/g, ' ').replace(/&/g, '&amp;').replace(/([\\`*_{}[\]<>|])/g, '\\$1');
}

function expression(value: DecisionExpression): string {
  if ('input' in value) return value.input;
  if ('literal' in value) return String(value.literal);
  const symbol = { add: '+', subtract: '−', multiply: '×', divide: '÷' }[value.op];
  return `(${expression(value.left)} ${symbol} ${expression(value.right)})`;
}

function result(value: CheckValueResult): string {
  return value.status === 'available' ? scalar(value.value) : `不可用：${text(value.reason)}`;
}

function scalar(value: string | number | boolean): string {
  // 离散检查不强转类型，报告同样保留字符串引号，避免把"false"显示成布尔false。
  return text(typeof value === 'string' ? JSON.stringify(value) : String(value));
}

function table(headers: readonly string[], rows: readonly (readonly string[])[]): string {
  return [headers.join(' | '), headers.map(() => '---').join(' | '), ...rows.map(row => row.join(' | '))].join('\n');
}

/** 同一保存版生成确定的原件；只复用既有求值，不从作者文字猜公式或修正其判断。 */
export function renderDecisionReport(record: DecisionRecord, expectedRevision: number): DecisionReport {
  if (record.revision !== expectedRevision) throw new DecisionFailure('revision_conflict', `Revision conflict: expected ${expectedRevision}, current ${record.revision}. Read the current record before exporting.`);
  const projected = projectDecisionRecord(record);
  const { recommendationBasis: basis } = projected;
  const saved = record.recommendation;
  const sections = [
    '# 决策记录快照',
    `记录 ${record.id} · revision ${record.revision} · inputRevision ${record.inputRevision}`,
    `题目（作者声明）：${text(record.model.title)}\n\n问题（作者声明）：${text(record.model.question)}`,
    '这是生成时版本的固定快照，不随以后条件变化更新。当前状态用 linnya-decision read 查看。程序计算已声明算式和检查；名称、单位、来源说明、模型语义和建议均未被认证。本报告不授予执行权限。完整情景与历史仍从记录读取。',
    '## 已登记输入（用户或作者声明）',
    table(['id', '名称', '值', '单位', '类型', '来源状态', '出处说明'], record.model.inputs.map(input => [
      text(input.id), text(input.label), input.value === null ? '未知（null）' : scalar(input.value), text(input.unit ?? '未声明'),
      input.kind, input.status, text(input.origin),
    ])),
    '## 程序执行的算式',
    table(['id', '名称（作者声明）', '公式（输入id）', '算值', '单位（作者声明）'], record.model.calculations.map(calculation => [
      text(calculation.id), text(calculation.label), text(expression(calculation.expression)), result(evaluateExpression(calculation.expression, record.model)), text(calculation.unit),
    ])),
    '## 全部声明检查',
    table(['id / 选项', '检查名称（作者声明）', '声明关系', '实际左值', '实际右值', '结果'], record.model.checks.map(check => {
      const evaluated = evaluateDecisionCheck(check, record.model);
      const relation = check.operator === 'is' ? `${text(check.inputId)} = ${scalar(check.value)}`
        : text(`${expression(check.left)} ${check.operator === 'lte' ? '≤' : check.operator === 'gte' ? '≥' : '='} ${expression(check.right)}`);
      return [text(`${check.id} / ${check.optionId}`), text(check.label), relation, result(evaluated.left), result(evaluated.right),
        evaluated.passes === null ? '未定' : evaluated.passes ? '成立' : '不成立'];
    })),
    '检查成立只表示该项声明关系成立，不等于方案整体可行、值得选择或已获授权。',
    '## 当前建议引用的程序边界',
    basis === null ? '未声明 numericBasis。'
      : basis.status === 'needs_review' ? '旧建议待复核，不在本版输入上重建旧建议的数值依据；原值请读对应历史版。'
        : [
          `依据 inputRevision ${basis.basedOnInputRevision}；保持其余输入在本版取值。`,
          ...basis.boundaries.map(boundary => `- ${text(boundary.checkId)} / ${text(boundary.inputId)}：${text(boundary.text)}`),
        ].join('\n'),
    '## 当前行动（保存声明与报告状态）',
    projected.actionStates.length ? table(['行动id', '计划版', '计划内容（作者声明）', '预计成本', '报告状态', '计划状态 / 接续'], projected.actionStates.map(action => [
      action.id, String(action.planRevision), text(`${action.plan.label}：${action.plan.purpose}`), text(action.plan.estimatedCost), action.state,
      `${action.planStatus} / ${action.continuation}`,
    ])) : '尚未登记行动。',
    '行动状态不证明真实执行；旧报告及逐次实际成本从记录历史读取。',
    '## 作者保存的建议原文（未经语义认证）',
    `生成时建议状态：${projected.recommendationStatus}；行动依据：${projected.recommendationContext.actionBasis.status}。current仅表示版本相符。`,
    saved ? [
      `原建议依据 inputRevision ${saved.basedOnInputRevision}，选项id：${text(saved.content.optionIds.join(', ') || '暂未选择')}。`,
      `理由：${text(saved.content.rationale)}`, `补充变化条件（作者原文）：${text(saved.content.changeConditions)}`, `下一步：${text(saved.content.nextAction)}`,
      '未解问题：', ...saved.content.unresolved.map(item => `- ${text(item)}`),
      '以上为保存的作者原文，可能与程序结果矛盾；导出不自动修正或重新认证建议。',
    ].join('\n\n') : '尚未保存建议。',
  ];
  return { kind: 'decision_report', decisionId: record.id, revision: record.revision, inputRevision: record.inputRevision,
    markdown: `${sections.join('\n\n')}\n` };
}
