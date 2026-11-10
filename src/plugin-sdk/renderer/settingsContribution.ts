import { shallowRef } from 'vue';
import type { AppearanceSectionContribution, SettingsContribution } from '@linnya/plugin-host-contract/renderer/settingsContribution';

export type {
  SettingsContribution,
  SettingsContributionGroup,
  AppearanceSectionContribution,
} from '@linnya/plugin-host-contract/renderer/settingsContribution';

const settingsContributions = new Map<string, SettingsContribution>();

export function registerSettingsContribution(contribution: SettingsContribution): void {
  assertNonEmpty(contribution.id, 'id');
  assertNonEmpty(contribution.title, 'title');

  if (settingsContributions.has(contribution.id)) {
    throw new Error(`[settingsContribution] 设置项重复注册: ${contribution.id}`);
  }

  settingsContributions.set(contribution.id, contribution);
}

export function unregisterSettingsContribution(id: string): void {
  settingsContributions.delete(id);
}

export function listSettingsContributions(): readonly SettingsContribution[] {
  return Array.from(settingsContributions.values())
    .filter((contribution) => contribution.isAvailable?.() ?? true)
    .sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));
}

export function clearSettingsContributionsForTest(): void {
  settingsContributions.clear();
}

function assertNonEmpty(value: string, field: string): void {
  if (!value.trim()) {
    throw new Error(`[settingsContribution] ${field} 不能为空`);
  }
}

// 使用浅响应式集合，使晚于设置页挂载的插件激活/停用可立即更新该节。
const appearanceSections = shallowRef<readonly AppearanceSectionContribution[]>([]);

export function registerAppearanceSection(contribution: AppearanceSectionContribution): void {
  assertNonEmpty(contribution.pluginId, 'pluginId');
  assertNonEmpty(contribution.id, 'id');
  assertNonEmpty(contribution.title, 'title');
  if (appearanceSections.value.some(section => section.pluginId === contribution.pluginId && section.id === contribution.id)) {
    throw new Error(`[settingsContribution] 外观分节重复注册: ${contribution.pluginId}/${contribution.id}`);
  }
  appearanceSections.value = [...appearanceSections.value, contribution];
}

export function unregisterAppearanceSection(pluginId: string, id: string): void {
  appearanceSections.value = appearanceSections.value.filter(section => section.pluginId !== pluginId || section.id !== id);
}

export function listAppearanceSections(): readonly AppearanceSectionContribution[] {
  return appearanceSections.value.filter(section => section.isAvailable?.() !== false)
    .sort((a, b) => a.order - b.order || a.pluginId.localeCompare(b.pluginId) || a.id.localeCompare(b.id));
}

export function clearAppearanceSectionsForTest(): void {
  appearanceSections.value = [];
}
