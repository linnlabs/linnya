/**
 * @file availability.ts
 * @description Skill 可用性规则注册表。
 *
 * 中文说明：
 * - Skill discovery 只负责发现文件，不负责判断运行期插件是否启用；
 * - app host 通过这里注册窄规则，catalog / skill 工具统一复用；
 * - 规则保持只读、无副作用，避免把 Skill 系统变成插件状态管理入口。
 */

import type { SkillMetadata } from './types';

export type SkillAvailabilityRule = (skill: SkillMetadata) => boolean;

const rulesById = new Map<string, SkillAvailabilityRule>();

export function registerSkillAvailabilityRule(id: string, rule: SkillAvailabilityRule): void {
  const normalizedId = id.trim();
  if (!normalizedId) {
    throw new Error('[SkillAvailability] rule id 不能为空');
  }
  if (rulesById.has(normalizedId)) return;
  rulesById.set(normalizedId, rule);
}

export function isSkillAvailable(skill: SkillMetadata): boolean {
  for (const rule of rulesById.values()) {
    if (!rule(skill)) return false;
  }
  return true;
}

export function filterAvailableSkills(skills: readonly SkillMetadata[]): SkillMetadata[] {
  return skills.filter(isSkillAvailable);
}

export function clearSkillAvailabilityRulesForTests(): void {
  rulesById.clear();
}
