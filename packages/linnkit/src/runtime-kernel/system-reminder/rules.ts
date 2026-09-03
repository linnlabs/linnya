/**
 * @file packages/linnkit/src/runtime-kernel/system-reminder/rules.ts
 * @description SystemReminder 规则集合（注册式配置入口）
 *
 * 中文备注：
 * - 内置规则也走 trigger + template，和 host extraRules 使用同一套解释链路；
 * - spec 只引用 rule/template/trigger ID，不塞函数，保证可序列化、可回放、可审计。
 */

import type { AgentSpecSystemReminderPolicy } from '../../contracts';
import { defaultSystemReminderRegistry, type SystemReminderRegistry } from './registry';
import type { SystemReminderRule, SystemReminderRuleDefinition } from './types';

export const SYSTEM_REMINDER_RULES: ReadonlyArray<SystemReminderRuleDefinition> = [
  {
    id: 'max_steps_force_final_answer',
    trigger: { kind: 'phase-equals', value: 'force_final_answer' },
    contentTemplate: 'maxStepsForceFinalAnswer',
  },
  {
    id: 'last_steps_hint',
    trigger: { kind: 'remaining-steps-leq' },
    contentTemplate: 'lastStepsHint',
  },
  {
    id: 'tool_call_streak_every_ten',
    trigger: { kind: 'tool-call-streak', threshold: 10, moduloStep: true },
    contentTemplate: 'toolCallStreak',
  },
  {
    id: 'periodic_progress_reflection',
    trigger: { kind: 'step-count-modulo', period: 30, minStep: 30 },
    contentTemplate: 'periodicProgressReflection',
  },
];

export function createSystemReminderRules(params: {
  policy?: AgentSpecSystemReminderPolicy;
  registry?: SystemReminderRegistry;
} = {}): ReadonlyArray<SystemReminderRule> {
  const registry = params.registry ?? defaultSystemReminderRegistry;
  const definitions = applySystemReminderPolicy(SYSTEM_REMINDER_RULES, params.policy);
  const extraDefinitions = params.policy?.extraRules ?? [];

  return [...definitions, ...extraDefinitions]
    .map((definition) => registry.buildRule(definition))
    .filter((rule): rule is SystemReminderRule => !!rule);
}

function applySystemReminderPolicy(
  definitions: ReadonlyArray<SystemReminderRuleDefinition>,
  policy: AgentSpecSystemReminderPolicy | undefined,
): ReadonlyArray<SystemReminderRuleDefinition> {
  const withThresholds = definitions.map((definition) => applyThresholdOverrides(definition, policy));
  const enabledRuleIds = policy?.enabledRuleIds;
  if (Array.isArray(enabledRuleIds)) {
    const allow = new Set(enabledRuleIds);
    return withThresholds.filter((definition) => allow.has(definition.id));
  }

  const disabledRuleIds = policy?.disabledRuleIds;
  if (Array.isArray(disabledRuleIds) && disabledRuleIds.length > 0) {
    const deny = new Set(disabledRuleIds);
    return withThresholds.filter((definition) => !deny.has(definition.id));
  }

  return withThresholds;
}

function applyThresholdOverrides(
  definition: SystemReminderRuleDefinition,
  policy: AgentSpecSystemReminderPolicy | undefined,
): SystemReminderRuleDefinition {
  const thresholds = policy?.thresholds;
  if (!thresholds) return definition;

  if (definition.id === 'tool_call_streak_every_ten' && thresholds.toolCallStreak !== undefined) {
    return {
      ...definition,
      trigger: { ...definition.trigger, threshold: thresholds.toolCallStreak },
    };
  }
  const periodicReflectionPeriod = thresholds.periodicReflectionPeriod;
  if (definition.id === 'periodic_progress_reflection' && periodicReflectionPeriod !== undefined) {
    return {
      ...definition,
      trigger: {
        ...definition.trigger,
        period: periodicReflectionPeriod,
        minStep: periodicReflectionPeriod,
      },
    };
  }
  if (definition.id === 'last_steps_hint' && thresholds.lastStepsHintThreshold !== undefined) {
    return {
      ...definition,
      trigger: { ...definition.trigger, threshold: thresholds.lastStepsHintThreshold },
    };
  }
  return definition;
}
