import {
  countToolCallsInCurrentRequest,
  readNonEmptyStrings,
  toDisplayStep,
} from './helpers';
import type { SystemReminderContentTemplate } from './types';

export const maxStepsForceFinalAnswerTemplate: SystemReminderContentTemplate = () => [
  '你已进入步数预算收尾阶段：本轮工具已被禁用。',
  '你必须立刻给出最终答案，不要再尝试调用任何工具。',
  '若信息不完整，请明确说明关键假设和缺口，并给出当前最好的可用回答。',
].join('\n');

export const lastStepsHintTemplate: SystemReminderContentTemplate = (ctx) => {
  const el = ctx.executorLocal;
  if (!el) return '';
  const maxSteps = el.maxSteps;
  const stepCount = el.stepCount;
  const remainingSteps = el.remainingSteps;
  if (typeof maxSteps !== 'number' || typeof stepCount !== 'number' || typeof remainingSteps !== 'number') {
    return '';
  }

  const displayMaxSteps = toDisplayStep(maxSteps);
  const displayStepCount = toDisplayStep(stepCount);
  const displayRemainingSteps = toDisplayStep(remainingSteps);
  const finalStepPolicy = el.finalStepPolicy ?? 'final_answer';

  if (finalStepPolicy === 'force_tools') {
    const forcedTools = readNonEmptyStrings(el.finalStepForcedTools);
    const toolsText = forcedTools.length > 0 ? forcedTools.join(', ') : '(未配置 forcedTools)';
    return [
      `步数提醒：你当前处于第 ${displayStepCount}/${displayMaxSteps} 步，还剩 ${displayRemainingSteps} 步。`,
      `进入收尾阶段时，你必须立刻调用工具：${toolsText}（系统将只保留这些工具）。`,
      'Runtime 会为最终 ToolNode 预留执行节点；不要在收尾阶段调用其他工具。',
    ].join('\n');
  }

  return [
    `步数提醒：你当前处于第 ${displayStepCount}/${displayMaxSteps} 步，还剩 ${displayRemainingSteps} 步。`,
    '建议你结束无关推理/无关工具调用，确保在步数耗尽前完成任务。',
  ].join('\n');
};

export const toolCallStreakTemplate: SystemReminderContentTemplate = (ctx) => {
  const count = countToolCallsInCurrentRequest(ctx.history);
  return [
    `你已连续执行了 ${count} 次工具调用。`,
    '如果问题比较复杂，考虑把工作拆成更小的执行单元，降低上下文占用。',
    '如果问题即将解决，请忽略本条提醒。',
  ].join('\n');
};

export const periodicProgressReflectionTemplate: SystemReminderContentTemplate = (ctx) => {
  const stepCount = ctx.executorLocal?.stepCount ?? 0;
  const displayStep = toDisplayStep(stepCount);
  return [
    `你已执行了 ${displayStep} 步。请暂停当前工作，花一步反思和整理：`,
    '1. 核对当前目标、关键约束、已完成事项和下一步是否一致。',
    '2. 如果当前流程已经偏离目标，请先收敛计划，再继续执行。',
    '3. 如果宿主提供了状态或检查点能力，请在确有需要时更新。',
    '完成整理后继续执行任务。',
  ].join('\n');
};

function readHostReminderText(args: Record<string, unknown> | undefined): string {
  const body = args?.body;
  if (typeof body === 'string' && body.trim().length > 0) {
    return body.trim();
  }

  const lines = args?.lines;
  if (!Array.isArray(lines)) {
    return '';
  }
  return lines
    .map((line) => (typeof line === 'string' ? line.trimEnd() : ''))
    .filter((line) => line.length > 0)
    .join('\n')
    .trim();
}

export const hostReminderTextTemplate: SystemReminderContentTemplate = (_ctx, args) => readHostReminderText(args);

export const BUILTIN_SYSTEM_REMINDER_TEMPLATES: Record<string, SystemReminderContentTemplate> = {
  maxStepsForceFinalAnswer: maxStepsForceFinalAnswerTemplate,
  lastStepsHint: lastStepsHintTemplate,
  toolCallStreak: toolCallStreakTemplate,
  periodicProgressReflection: periodicProgressReflectionTemplate,
  hostReminderText: hostReminderTextTemplate,
};
