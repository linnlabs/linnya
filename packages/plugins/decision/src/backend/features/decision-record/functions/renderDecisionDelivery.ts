import { cashFlowDirectionLabel } from '../definitions/cashFlowEvaluation';
import type { DecisionRecord } from '../../../../shared';
import { projectDecisionDelivery, type DecisionDelivery } from './projectDecisionDelivery';
import { decisionMarkdownText as text, decisionMarkdownResult as result, decisionMarkdownScalar as scalar, decisionMarkdownTable as table } from '../shared/decisionMarkdown';

const deliveryNotice = '程序复算已登记模型；输入、作者判断、履约与执行授权仍需另行确认。';

const optionStatus = { pass: '已登记条件满足', fail: '已登记条件未满足', undetermined: '需要信息或补齐检查' } as const;
const outcomeStatus = {
  ranked_choice: '按已声明偏好顺序选出', no_option_passes: '所有选项均有未满足的声明条件',
  needs_information: '需要信息', preference_needs_review: '偏好需要重新确认', selection_required: '尚未登记选择顺序',
} as const;

function calculationRows(calculations: DecisionDelivery['calculations']) {
  return calculations.map(item => [text(item.id), text(item.label), result(item.result, item.quantityType), text(item.unit)]);
}

/** 程序结果和作者判断分区交付，数字、条件分支不再经过一次自由转述。 */
function renderDetails(delivery: DecisionDelivery): string {
  const conditional = delivery.conditionalAdvice;
  const sections = [
    `# ${text(delivery.title)}`,
    `记录 ${delivery.decisionId} · revision ${delivery.revision} · inputRevision ${delivery.inputRevision}`,
    '## 当前条件与算值',
    ...delivery.options.map(option => [
      `### ${text(option.label)}：${optionStatus[option.status]}`,
      option.checks.length ? table(['检查', '左值', '右值', '结果'], option.checks.map(check => [
        text(`${check.id}：${check.label}`), result(check.left), result(check.right),
        check.passes === null ? '未定' : check.passes ? '成立' : '不成立',
      ])) : '此选项尚无已登记检查。',
    ].join('\n\n')),
    ...(delivery.calculations.length ? [table(['计算id', '含义（声明）', '程序值', '单位'], calculationRows(delivery.calculations))] : []),
    ...(conditional?.status === 'current' ? [
      `程序分支：${outcomeStatus[conditional.baseline.outcome.status]}${conditional.baseline.outcome.optionIds.length ? `（${conditional.baseline.outcome.optionIds.map(text).join('、')}）` : ''}。`,
    ] : []),
    ...(delivery.cashFlows.length ? [
      '## 付款时序',
      ...delivery.cashFlows.flatMap(flow => [
        text(flow.text),
        table(['节点', '距声明锚点的天数', '方向', '金额', '银行余额', '隔离准备', '可动用余额'], flow.entries.map((entry, index) => [
          text(entry.label), result(entry.time), cashFlowDirectionLabel[entry.direction], result(entry.result),
          flow.status === 'available' ? String(flow.balances[index].bank) : '未定',
          flow.status === 'available' ? String(flow.balances[index].reserve) : '未定',
          flow.status === 'available' ? String(flow.balances[index].balance) : '未定',
        ])),
        ...flow.timingThresholds.map(threshold => text(threshold.text)),
      ]),
    ] : []),
    ...(delivery.numericBasis?.status === 'current' && delivery.numericBasis.boundaries.length ? [
      '## 数值变化条件', ...delivery.numericBasis.boundaries.map(boundary => `- ${text(boundary.text)}`),
    ] : []),
    ...(conditional?.status === 'current' && conditional.cases.length ? [
      '## 各情景独立重算',
      ...conditional.cases.flatMap(scenario => [
        `### ${text(scenario.id)}：${text(scenario.label)}`,
        `变动输入：${scenario.changes.map(change => `${text(change.inputId)}：${change.from === null ? '未知' : scalar(change.from)} → ${change.to === null ? '未知' : scalar(change.to)}`).join('；')}。`,
        `程序分支：${outcomeStatus[scenario.outcome.status]}${scenario.outcome.optionIds.length ? `（${scenario.outcome.optionIds.map(text).join('、')}）` : ''}。`,
        table(['选项', '已登记检查结果'], scenario.options.map(option => [text(option.optionId), optionStatus[option.status]])),
        ...(scenario.evaluation.calculations.length ? [table(['计算id', '含义（声明）', '本情景程序值', '单位'], calculationRows(scenario.evaluation.calculations))] : []),
        ...((scenario.evaluation.cashFlows ?? []).map(flow => text(flow.text))),
      ]),
    ] : []),
    '## 输入身份与未知',
    table(['输入', '值', '单位', '依据类型', '状态', '出处（声明）'], delivery.inputs.map(input => [
      text(`${input.id}：${input.label}`), input.value === null ? '未知' : scalar(input.value, input.quantityType), text(input.unit ?? '未声明'),
      input.kind === 'assumption' ? '作者假设' : text(input.kind), input.status === 'withdrawn' ? '已撤回' : '已登记', text(input.origin),
    ])),
    ...(delivery.actions.length ? [
      '## 已登记行动',
      table(['行动', '计划版本', '内容（作者声明）', '状态', '计划状态'], delivery.actions.map(action => [
        text(action.plan.label), String(action.planRevision), text(action.plan.purpose), action.state, action.planStatus,
      ])),
    ] : []),
    '## 作者判断原文',
    `作者选择：${delivery.author.optionIds.map(text).join('、') || '暂未选择'}。`,
    `理由：${text(delivery.author.rationale)}`,
    `补充变化条件：${text(delivery.author.changeConditions)}`,
    `下一步：${text(delivery.author.nextAction)}`,
    ...(conditional?.status === 'current' ? [
      `基线分支建议（作者声明）：${text('authorAction' in conditional.baseline.outcome ? conditional.baseline.outcome.authorAction : '未声明')}`,
      ...conditional.cases.map(item => `情景 ${text(item.id)} 的下一步（作者声明）：${text(item.authorNextAction ?? ('authorAction' in item.outcome ? item.outcome.authorAction : '未声明'))}`),
    ] : []),
    ...(delivery.author.unresolved.length ? ['未解问题：', ...delivery.author.unresolved.map(item => `- ${text(item)}`)] : []),
  ];
  return `${sections.join('\n\n')}\n\n${deliveryNotice}\n`;
}


/** 摘要与完整原件来自同一投影；保留作者原句，不用程序另猜一份建议。 */
export function renderDecisionDelivery(record: DecisionRecord, expectedRevision: number) {
  const delivery = projectDecisionDelivery(record, expectedRevision);
  const labels = (ids: readonly string[]) => delivery.options.filter(item => ids.includes(item.optionId)).map(item => text(item.label)).join('、');
  const conditional = delivery.conditionalAdvice;
  const sections = [
    `# ${text(delivery.title)}`,
    `**当前建议：${labels(delivery.author.optionIds) || '暂未选择'}。**`,
    `理由（作者判断）：${text(delivery.author.rationale)}`,
    `下一步（作者建议）：${text(delivery.author.nextAction)}`,
    '## 关键数字与当前检查',
    ...delivery.options.map(option => `- ${text(option.label)}：${optionStatus[option.status]}。`),
    ...delivery.calculations.map(item => `- ${text(item.label)}：${result(item.result, item.quantityType)} ${text(item.unit)}。`),
    ...delivery.cashFlows.map(flow => `- ${text(flow.text)}`),
    '## 什么会改变建议',
    ...(delivery.numericBasis?.status === 'current' ? delivery.numericBasis.boundaries.map(boundary => `- ${text(boundary.text)}`) : []),
    ...delivery.cashFlows.flatMap(flow => [...flow.releaseConditions, ...flow.timingThresholds.map(threshold => threshold.text)].map(condition => `- ${text(condition)}`)),
    ...(conditional?.status === 'current' && conditional.cases.length ? conditional.cases.flatMap(scenario => [
      `### ${text(scenario.label)}`,
      `假设变动：${scenario.changes.map(change => `${text(change.label)}：${change.from === null ? '未知' : scalar(change.from, change.quantityType)} → ${change.to === null ? '未知' : scalar(change.to, change.quantityType)} ${text(change.unit ?? '')}`).join('；')}。`,
      `程序分支：${outcomeStatus[scenario.outcome.status]}${scenario.outcome.optionIds.length ? `（${labels(scenario.outcome.optionIds)}）` : ''}。`,
      ...scenario.options.map(option => `- ${labels([option.optionId])}：${optionStatus[option.status]}。`),
      ...scenario.evaluation.calculations.map(item => `- ${text(item.label)}：${result(item.result, item.quantityType)} ${text(item.unit)}。`),
      ...(scenario.evaluation.cashFlows ?? []).map(flow => `- ${text(flow.text)}`),
      `下一步（作者建议）：${text(scenario.authorNextAction ?? ('authorAction' in scenario.outcome ? scenario.outcome.authorAction : '未声明'))}`,
    ]) : ['本记录尚未登记条件情景。']),
    ...(delivery.author.unresolved.length ? ['## 仍待确认', ...delivery.author.unresolved.map(item => `- ${text(item)}`)] : []),
    deliveryNotice,
  ];
  // 原件保存检查、输入、情景变更与作者自由条件，短交付不再把自由条件冒充算值。
  return { ...delivery, markdown: `${sections.join('\n\n')}\n`, originalMarkdown: renderDetails(delivery) };
}
